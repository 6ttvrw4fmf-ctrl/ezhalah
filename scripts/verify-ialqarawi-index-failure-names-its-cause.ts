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
 * The verdict is the pure function `noteProblems(observed)`, so the mutation proofs at the bottom
 * can hand it the sweep results of a DELIBERATELY BROKEN copy of the real shipped module — not a
 * fixture this barrier invented for itself (BARRIER_ENGINEER.md R1).
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
const N_REQUESTS = 66; // 22 categories x 3 deal types, as fetch_index's own docstring states

const HARNESS = String.raw`
import sys, os, types, json
ROOT = ${JSON.stringify(ROOT)}
sys.path.insert(0, ROOT)

# curl_cffi is a scraper-runtime dependency. Only cc.Session's NAME is needed here -- the stub
# session below is what actually answers, and it is not a curl_cffi object.
if 'curl_cffi.requests' not in sys.modules:
    cc = types.ModuleType('curl_cffi.requests')
    class _S:
        def __init__(self, *a, **k): self.headers = {}
        def get(self, *a, **k): raise AssertionError('the real session must never be used here')
    cc.Session = _S
    parent = types.ModuleType('curl_cffi'); parent.requests = cc
    sys.modules['curl_cffi'] = parent
    sys.modules['curl_cffi.requests'] = cc

SRC_PATH = os.path.join(ROOT, 'scrapers', 'ialqarawi', 'run.py')
src = open(SRC_PATH, encoding='utf-8').read()

# MUTATE applies [find, replace] pairs to the REAL shipped source before it is loaded, so every
# proof below runs against a broken copy of the code that actually ships -- never a stand-in.
mut = os.environ.get('MUTATE')
if mut:
    for find, repl in json.loads(mut):
        if find not in src:
            print(json.dumps({'error': 'mutation target not found: %r' % find})); sys.exit(0)
        src = src.replace(find, repl, 1)

R = types.ModuleType('ialqarawi_under_test')
R.__file__ = SRC_PATH          # run.py derives the repo root from __file__
exec(compile(src, SRC_PATH, 'exec'), R.__dict__)

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
            # One genuine card in the shape the SHIPPED _CARD_RE expects. The negative control
            # rejected an earlier fixture that did not match it at all, which is the only reason
            # cases 1-4 mean anything.
            return Resp(200,
                '<html><section class="cards">'
                '<h5 class="card-title text-end">'
                '<a href="index.php?router=card&amp;id=99001&amp;catid=45">'
                'فيلا للبيع في الرياض</a></h5>'
                '</section></html>')
        raise AssertionError('unknown mode')

result = {}
for mode in ('blocked', 'empty200', 'mixed', 'transport', 'real'):
    try:
        out = {}
        cards = R.fetch_index(Stub(mode), outcomes=out)
        result[mode] = {'cards': len(cards), 'outcomes': out,
                        'note': R.index_failure_note(out)}
    except Exception as e:
        # A mutant that crashes is a mutant this barrier must still refuse, so the crash is
        # reported as data rather than aborting the sweep.
        result[mode] = {'cards': -1, 'outcomes': {},
                        'note': 'RAISED %s: %s' % (type(e).__name__, e)}
print(json.dumps(result, ensure_ascii=False))
`;

type Case = { cards: number; outcomes: Record<string, number>; note: string };
type Observed = Record<string, Case>;

/**
 * THE VERDICT, as a pure function of the five sweeps. Returns one string per violation, empty when
 * the module under test distinguishes its own failure causes.
 */
function noteProblems(got: Observed): string[] {
  const p: string[] = [];
  const need = (m: string): Case | null => {
    const c = got[m];
    if (!c) { p.push(`sweep "${m}" produced no result at all`); return null; }
    return c;
  };

  // 1. BLOCKED: every request refused. The note must say so, must give the code, and must
  //    explicitly NOT send the reader at the parser.
  const blocked = need('blocked');
  if (blocked) {
    if (blocked.cards !== 0) p.push(`blocked sweep returned ${blocked.cards} cards`);
    if (blocked.outcomes.http_403 !== N_REQUESTS) {
      p.push(`blocked sweep tallied ${JSON.stringify(blocked.outcomes)}, expected http_403=${N_REQUESTS}`);
    }
    if (!/BLOCKED/.test(blocked.note)) p.push(`blocked note does not say BLOCKED: ${blocked.note}`);
    if (!/403/.test(blocked.note)) p.push(`blocked note does not carry the status code: ${blocked.note}`);
    if (/MARKUP CHANGED/.test(blocked.note)) {
      p.push(`blocked note implicates the markup, the ambiguity this guards: ${blocked.note}`);
    }
  }

  // 2. MARKUP CHANGED: every request answered 200 and carried nothing.
  const empty = need('empty200');
  if (empty) {
    if (empty.cards !== 0) p.push(`empty-200 sweep returned ${empty.cards} cards`);
    if (empty.outcomes.ok_no_cards !== N_REQUESTS) {
      p.push(`empty-200 sweep tallied ${JSON.stringify(empty.outcomes)}, expected ok_no_cards=${N_REQUESTS}`);
    }
    if (!/MARKUP CHANGED/.test(empty.note)) {
      p.push(`200-with-no-cards note does not say MARKUP CHANGED: ${empty.note}`);
    }
    if (/BLOCKED/.test(empty.note)) {
      p.push(`200-with-no-cards note says BLOCKED, the inverse error: ${empty.note}`);
    }
  }

  // 3. The two notes must actually DIFFER. A repair that made both branches emit one richer-looking
  //    sentence would satisfy every individual assertion above and restore the original defect.
  if (blocked && empty && blocked.note === empty.note) {
    p.push('blocked and markup-changed produce the SAME note — the defect is back');
  }

  // 4. MIXED: refuses to pick a cause it cannot know.
  const mixed = need('mixed');
  if (mixed) {
    if (!/MIXED/.test(mixed.note)) p.push(`mixed sweep does not report MIXED: ${mixed.note}`);
    if (/\b(BLOCKED|MARKUP CHANGED)\b/.test(mixed.note)) {
      p.push(`mixed sweep picks a cause it cannot know: ${mixed.note}`);
    }
  }

  // 5. TRANSPORT: an exception is tallied, not raised past the sweep and not silently dropped.
  const trans = need('transport');
  if (trans) {
    if (trans.outcomes.transport_ConnectionResetError !== N_REQUESTS) {
      p.push(`transport failures not tallied: ${JSON.stringify(trans.outcomes)}`);
    }
    if (!/ConnectionResetError/.test(trans.note)) {
      p.push(`transport note does not name the error: ${trans.note}`);
    }
  }

  // 6. NEGATIVE CONTROL. Without this, a fetch_index() that reported every sweep as blocked would
  //    pass cases 1-5. A page carrying a real card must yield a card and report nothing lost.
  const real = need('real');
  if (real) {
    if (real.cards < 1) {
      p.push('negative control: a page carrying a real card produced no card — the stub or the '
        + 'shipped card regex has drifted, so cases 1-5 prove nothing');
    }
    if (real.outcomes.ok_cards !== N_REQUESTS) {
      p.push(`negative control tallied ${JSON.stringify(real.outcomes)}, expected ok_cards=${N_REQUESTS}`);
    }
    const lost = Object.keys(real.outcomes).filter(k => /^(http_|transport_)/.test(k));
    if (lost.length) p.push(`negative control reports lost requests on a healthy sweep: ${lost.join(',')}`);
  }

  return p;
}

function sweep(mutate?: [string, string][]): Observed & { error?: string } {
  let raw: string;
  try {
    raw = execFileSync('python3', ['-c', HARNESS], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      env: mutate ? { ...process.env, MUTATE: JSON.stringify(mutate) } : process.env,
    });
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return { error: err.stderr || err.message || 'python3 failed' } as Observed & { error: string };
  }
  return JSON.parse(raw.trim().split('\n').at(-1)!) as Observed & { error?: string };
}

// ── the real, shipped module ───────────────────────────────────────────────────────────────────
const real = sweep();
if (real.error) {
  console.error('✗ could not execute fetch_index() from the shipped module');
  console.error(real.error);
  process.exit(1);
}
const problems = noteProblems(real);
for (const p of problems) console.error(`FAIL  ${p}`);
if (!problems.length) console.log('PASS  the shipped fetch_index() names each failure cause distinctly');

// ── mutation proofs: rebuild each defect out of the REAL source and watch this barrier fail ─────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const flagged = (mutate: [string, string][]): boolean => {
  const got = sweep(mutate);
  // A mutation whose target no longer exists is NOT a catch — it is a proof that has quietly
  // stopped testing anything, which is the exact shape this repo keeps getting burned by. The
  // harness reports it as {"error": "mutation target not found: ..."} and it must be fatal, never
  // counted as the mutant being refused. (Proven by deliberately breaking one target during
  // development: it printed TARGET MISSING and the run went red, instead of passing quietly.)
  if (got.error) {
    if (/mutation target not found/.test(got.error)) {
      console.error(`FAIL  (mutation) TARGET MISSING — this proof tests nothing: ${got.error}`);
      return false;
    }
    return true;   // a mutant whose source will not even load IS refused
  }
  return noteProblems(got).length > 0;
};

// M1 — the defect verbatim: one fixed sentence for every cause, which is what shipped for two days.
mustCatch('the original single ambiguous sentence restored for every cause', flagged([[
  '    if not outcomes:\n',
  '    if True:\n'
  + '        return "index returned no cards in <section class=\\"cards\\"> — blocked or the markup changed"\n'
  + '    if not outcomes:\n',
]]));

// M2 — the mechanism of the defect: the status code discarded on a non-200, exactly as before.
//      Tellingly this also makes the MIXED case claim MARKUP CHANGED — the false confidence again.
mustCatch('a non-200 continue that discards the status code', flagged([[
  '                tally[f"http_{r.status_code}"] = tally.get(f"http_{r.status_code}", 0) + 1\n'
  + '                continue',
  '                continue',
]]));

// M3 — the near-miss this barrier actually caught during development: MARKUP CHANGED claimed on a
//      HALF-BLOCKED sweep, because `ok_no_cards == ok` is true of one too. The `lost == 0` guard is
//      the whole difference between "the parser is wrong" and "we never got in".
mustCatch('MARKUP CHANGED claimed on a half-blocked sweep (the lost-request guard removed)', flagged([[
  '    if lost == 0 and outcomes.get("ok_no_cards", 0) == ok:',
  '    if outcomes.get("ok_no_cards", 0) == ok:',
]]));

// M4 — the transport half: an exception propagating again, so a block arrives as a crash with no
//      tally at all.
mustCatch('a transport exception left to propagate instead of being tallied', flagged([[
  '            except Exception as e:                      # noqa: BLE001 — tally, never swallow',
  '            except ZeroDivisionError as e:',
]]));

if (problems.length || mutFail) {
  console.error(`\n✗ ialqarawi index failures do not name their own cause `
    + `(${problems.length} assertion failure(s), ${mutFail} blind mutation(s))`);
  process.exit(1);
}

console.log('✓ ialqarawi-index-failure-names-its-cause: blocked / markup-changed / mixed / '
  + 'transport each named distinctly by the SHIPPED fetch_index(), negative control intact, '
  + '4 mutation proofs.');
