#!/usr/bin/env node
/**
 * A BLOCKED index and a CHANGED markup must not produce the same sentence.
 *
 * Until 2026-09-23, scrapers/ialqarawi/run.py's fetch_index() `continue`d on any non-200 and
 * DISCARDED the status code. crawl() then raised one fixed string:
 *
 *     "index returned no cards in <section class=\"cards\"> — blocked or the markup changed"
 *
 * That names two causes with opposite fixes and says which one it is: neither. It sat on a P0
 * silent_scraper_death for two days — 2026-09-22 and 2026-09-23, both at the 04:24 cron slot,
 * each run dying in 3-4 seconds — and two separate engineer runs each spent a CI dispatch to
 * answer a question the run had the facts to answer. (The dispatch on 2026-09-23 at 23:18Z came
 * back ok=true with 2,644 cards seen and 2,568 upserted from the same unchanged selector, which
 * is what proved the markup was never the cause.)
 *
 * This check EXECUTES the real shipped fetch_index() and index_failure_note() against a stub
 * session, rather than reading the source for a promising-looking string. That distinction is the
 * whole point: every barrier this repo has been burned by was a source-TEXT tripwire that passed
 * for the entire time its defect was live.
 *
 * Five cases, and they pull in different directions so a lazy repair cannot satisfy them all:
 *   1. all 66 requests 403        -> names BLOCKED, must NOT implicate the markup
 *   2. all 66 return 200, 0 cards -> names MARKUP CHANGED, must NOT say blocked
 *   3. mixed (some 403, some 200-
 *      with-no-cards)             -> names MIXED, refuses to pick
 *   4. transport exception        -> tallied and named, never a traceback, never silence
 *   5. NEGATIVE CONTROL: a page
 *      that really does carry a
 *      card                       -> cards come back and nothing is reported lost
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const HARNESS = String.raw`
import sys, types, json
sys.path.insert(0, ${JSON.stringify(ROOT)})

# curl_cffi is a scraper-runtime dependency and this check must run in the hermetic suite, so the
# module is stubbed at import time. Only cc.Session's NAME is needed here -- the stub session
# below is what actually answers, and it is not a curl_cffi object.
if 'curl_cffi.requests' not in sys.modules:
    cc = types.ModuleType('curl_cffi.requests')
    class _S:  # noqa: D401
        def __init__(self, *a, **k): self.headers = {}
        def get(self, *a, **k): raise AssertionError('the real session must never be used here')
    cc.Session = _S
    parent = types.ModuleType('curl_cffi'); parent.requests = cc
    sys.modules['curl_cffi'] = parent
    sys.modules['curl_cffi.requests'] = cc

from scrapers.ialqarawi import run as R          # the SHIPPED module, not a copy

class Resp:
    def __init__(self, code, text=''): self.status_code, self.text = code, text

class Stub:
    """Answers every index request the same way, so the tally is unambiguous."""
    def __init__(self, mode): self.mode, self.n = mode, 0
    def get(self, url, **k):
        self.n += 1
        if self.mode == 'blocked':
            return Resp(403, 'Forbidden')
        if self.mode == 'empty200':
            return Resp(200, '<html><section class="cards"></section></html>')
        if self.mode == 'mixed':
            return Resp(403, 'x') if self.n % 2 else Resp(
                200, '<html><section class="cards"></section></html>')
        if self.mode == 'transport':
            raise ConnectionResetError('connection reset by peer')
        if self.mode == 'real':
            # One genuine card in the shape the shipped regex expects. Built from the module's own
            # pattern so this control cannot silently rot into a no-op if the selector changes.
            return Resp(200,
                '<html><section class="cards">'
                '<h5 class="card-title text-end">'
                '<a href="index.php?router=card&amp;id=99001&amp;catid=45">'
                'فيلا للبيع في الرياض</a></h5>'
                '</section></html>')
        raise AssertionError('unknown mode')

def sweep(mode):
    out = {}
    cards = R.fetch_index(Stub(mode), outcomes=out)
    return cards, out, R.index_failure_note(out)

result = {}
for mode in ('blocked', 'empty200', 'mixed', 'transport', 'real'):
    cards, out, note = sweep(mode)
    result[mode] = {'cards': len(cards), 'outcomes': out, 'note': note}
print(json.dumps(result, ensure_ascii=False))
`;

type Case = { cards: number; outcomes: Record<string, number>; note: string };

let raw: string;
try {
  raw = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
} catch (e: unknown) {
  const err = e as { stderr?: string; message?: string };
  console.error('✗ could not execute fetch_index() from the shipped module');
  console.error(err.stderr || err.message);
  process.exit(1);
}

const got = JSON.parse(raw.trim().split('\n').at(-1)!) as Record<string, Case>;
const problems: string[] = [];
const N_REQUESTS = 66; // 22 categories x 3 deal types, as fetch_index's own docstring states

// 1. BLOCKED: every request refused. The note must say so, must give the code, and must
//    explicitly NOT send the reader at the parser.
const blocked = got.blocked;
if (blocked.cards !== 0) problems.push(`blocked sweep returned ${blocked.cards} cards`);
if (blocked.outcomes.http_403 !== N_REQUESTS) {
  problems.push(`blocked sweep tallied ${JSON.stringify(blocked.outcomes)}, expected http_403=${N_REQUESTS}`);
}
if (!/BLOCKED/.test(blocked.note)) problems.push(`blocked note does not say BLOCKED: ${blocked.note}`);
if (!/403/.test(blocked.note)) problems.push(`blocked note does not carry the status code: ${blocked.note}`);
if (/MARKUP CHANGED/.test(blocked.note)) {
  problems.push(`blocked note implicates the markup, which is the ambiguity this guards: ${blocked.note}`);
}

// 2. MARKUP CHANGED: every request answered 200 and carried nothing.
const empty = got.empty200;
if (empty.cards !== 0) problems.push(`empty-200 sweep returned ${empty.cards} cards`);
if (empty.outcomes.ok_no_cards !== N_REQUESTS) {
  problems.push(`empty-200 sweep tallied ${JSON.stringify(empty.outcomes)}, expected ok_no_cards=${N_REQUESTS}`);
}
if (!/MARKUP CHANGED/.test(empty.note)) {
  problems.push(`200-with-no-cards note does not say MARKUP CHANGED: ${empty.note}`);
}
if (/BLOCKED/.test(empty.note)) {
  problems.push(`200-with-no-cards note says BLOCKED, the inverse error: ${empty.note}`);
}

// 3. The two notes must actually DIFFER. A repair that made both branches emit one richer-looking
//    sentence would satisfy every individual assertion above and restore the original defect.
if (blocked.note === empty.note) {
  problems.push('blocked and markup-changed produce the SAME note — the defect is back');
}

// 4. MIXED: refuses to pick a cause.
const mixed = got.mixed;
if (!/MIXED/.test(mixed.note)) problems.push(`mixed sweep does not report MIXED: ${mixed.note}`);
if (/^.*\b(BLOCKED|MARKUP CHANGED)\b/.test(mixed.note)) {
  problems.push(`mixed sweep picks a cause it cannot know: ${mixed.note}`);
}

// 5. TRANSPORT: an exception is tallied, not raised past the sweep and not silently dropped.
const trans = got.transport;
if (trans.outcomes.transport_ConnectionResetError !== N_REQUESTS) {
  problems.push(`transport failures not tallied: ${JSON.stringify(trans.outcomes)}`);
}
if (!/ConnectionResetError/.test(trans.note)) {
  problems.push(`transport note does not name the error: ${trans.note}`);
}

// 6. NEGATIVE CONTROL. Without this, a fetch_index() that reported every sweep as blocked would
//    pass cases 1-5. A page carrying a real card must yield a card and report nothing lost.
const real = got.real;
if (real.cards < 1) {
  problems.push('negative control: a page carrying a real card produced no card — the stub or the '
    + 'shipped card regex has drifted, so cases 1-5 prove nothing');
}
if (real.outcomes.ok_cards !== N_REQUESTS) {
  problems.push(`negative control tallied ${JSON.stringify(real.outcomes)}, expected ok_cards=${N_REQUESTS}`);
}
const lostOnHealthy = Object.keys(real.outcomes).filter(k => /^(http_|transport_)/.test(k));
if (lostOnHealthy.length) {
  problems.push(`negative control reports lost requests on a healthy sweep: ${lostOnHealthy.join(',')}`);
}

if (problems.length) {
  console.error('✗ ialqarawi index failures do not name their own cause:');
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

console.log('✓ ialqarawi-index-failure-names-its-cause: blocked / markup-changed / mixed / '
  + 'transport each named distinctly by the SHIPPED fetch_index(), negative control intact.');
