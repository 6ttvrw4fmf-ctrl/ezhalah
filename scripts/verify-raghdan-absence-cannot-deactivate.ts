// UNKNOWN IS NOT DEAD — raghdan's deactivation path, executed rather than read.
//
// THE DEFECT THIS EXISTS TO PREVENT
// --------------------------------
// Until 2026-09-06 scrapers/raghdan/run.py called db.prune_unseen() with NO source oracle, so three
// missed crawls deactivated a listing with no affirmative answer from the source — EvidenceKind.
// ABSENCE deciding a listing's fate, which docs/ops/LISTING_LIVENESS.md §1-§3 forbids. It was one of
// the five platforms carrying a standing P1 `unknown_treated_as_dead`.
//
// WHY "404 MEANS GONE" IS AN ASSUMPTION UNTIL YOU PROVE IT
// -------------------------------------------------------
// LISTING_LIVENESS.md §5.4 measured gathern answering a THROTTLED client with its own
// application-rendered 404: one listing returned 200 to the oracle at 10:51 and 404 to a datacenter
// probe minutes later, and a 12-row control returned 404 on 12/12 rows the oracle had just verified
// alive — a 100% false-death rate. A bare status code is not a not-found.
//
// So raghdan's 404 was CONTROL-VALIDATED against the test that actually distinguishes the two, a
// BOGUS id that never existed (measured 2026-09-06, same minute):
//
//     8/8 known-active   -> 200, ~134-155KB, JSON-LD RealEstateListing present
//     5/5 rows we killed -> 404, ~39.1KB, no JSON-LD, bare brand <title>
//     3/3 bogus ids      -> 404, ~39.1KB, IDENTICAL to the killed rows
//
// A never-existed id and a removed listing are answered the same way, while real listings are
// answered differently in the same minute. That is what makes 404 a genuine not-found here — and
// the in-run canary control re-establishes it on EVERY run, so the day raghdan starts answering us
// the way gathern did, the deaths stop instead of landing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RUN_PY = join(ROOT, 'scrapers', 'raghdan', 'run.py');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
console.log('verify-raghdan-absence-cannot-deactivate: only a proven source answer may kill.');

const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.raghdan.run as run

fn = run.raghdan_verdict
mut = os.environ.get("MUTATE")
if mut:
    find, repl = json.loads(mut)
    src = textwrap.dedent(inspect.getsource(run.raghdan_verdict))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    ns = dict(run.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    fn = ns["raghdan_verdict"]

LIVE_BODY = '<html><script type="application/ld+json">{"@type":"RealEstateListing"}</script></html>'
NF_BODY   = '<html><title>رغدان للعقارات</title></html>'

def v(status, body, canary=True):
    return fn(status, body, canary_ok=canary)[0]

out = {"table": {
  # Every UNKNOWN shape. None of these may ever be 'gone'.
  "network_error":      v(None, ""),
  "401":                v(401, ""),
  "403":                v(403, ""),
  "408":                v(408, ""),
  "429":                v(429, ""),
  "500":                v(500, ""),
  "503":                v(503, ""),
  "302_unresolved":     v(302, ""),
  "200_unrecognised":   v(200, NF_BODY),          # rendered, but not a listing page
  "200_empty":          v(200, ""),
  # The affirmative limbs.
  "404_with_canary":    v(404, NF_BODY),
  "410_with_canary":    v(410, NF_BODY),
  "200_listing":        v(200, LIVE_BODY),
}, "gated": {
  # THE CANARY GATE: the identical death-shaped input, on an unproven environment.
  "404_no_canary":      v(404, NF_BODY, canary=False),
  "410_no_canary":      v(410, NF_BODY, canary=False),
  # A live answer needs no control — a block cannot manufacture a listing page.
  "200_listing_no_canary": v(200, LIVE_BODY, canary=False),
}}
print(json.dumps(out))
`;

type R = { table?: Record<string, string>; gated?: Record<string, string>; error?: string };
const run = (mutate?: [string, string]): R => JSON.parse(
  execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  }).trim().split('\n').pop() as string);

const UNKNOWN = ['network_error', '401', '403', '408', '429', '500', '503', '302_unresolved',
  '200_unrecognised', '200_empty'];

const base = run();
check(!base.error, 'the shipped oracle imports and runs', base.error ?? '');
for (const k of UNKNOWN) {
  check(base.table?.[k] !== 'gone', `${k} is NOT death`,
    `returned ${JSON.stringify(base.table?.[k])} — an UNKNOWN read must never deactivate`);
}
check(base.table?.['404_with_canary'] === 'gone',
  '404 IS a removal once the canaries have verified alive',
  'the real death signal must still kill, or the oracle degrades into "never deactivate" and dead ' +
  'inventory stays searchable — the owner rule cuts both ways');
check(base.table?.['410_with_canary'] === 'gone', '410 likewise');
check(base.table?.['200_listing'] === 'live', '200 with JSON-LD RealEstateListing is ALIVE');

// ── The canary gate: the property this platform's safety actually rests on ──────────────────────
check(base.gated?.['404_no_canary'] === 'unknown',
  'a 404 on an UNPROVEN environment degrades to unknown (the gathern blocking-as-404 case)',
  `returned ${JSON.stringify(base.gated?.['404_no_canary'])} — this is the 100% false-death shape`);
check(base.gated?.['410_no_canary'] === 'unknown', 'a 410 likewise degrades to unknown');
check(base.gated?.['200_listing_no_canary'] === 'live',
  'a LIVE answer is NOT gated by the control',
  'restorative evidence must stay ungated (DELETION_SAFETY.md §2.4): a block cannot manufacture a ' +
  'live listing page, and gating it would let a degraded run suppress a self-heal');

// ── Wiring: an oracle nothing calls is decoration ────────────────────────────────────────────────
const src = readFileSync(RUN_PY, 'utf8');
check(/db\.prune_unseen\([\s\S]{0,240}?verify_gone=verify_gone/.test(src),
  'prune_unseen is called WITH the oracle');
check(/InRunCanary\(_raghdan_is_alive/.test(src) && /canary\.offer\(/.test(src),
  'the canary control is constructed from listings this run proved live');

// ── MUTATION PROOF — real defects, re-introduced into the shipped source and executed ───────────
const mustCatch = (what: string, mutate: [string, string], probe: (r: R) => boolean) => {
  const r = run(mutate);
  if (r.error) { check(false, `(mutation) ${what}`, r.error); return; }
  check(probe(r), `(mutation) catches ${what}`,
    'MUTANT SURVIVED — an assertion above is blind to the defect it exists to catch');
};

// The whole point of the control: removing it lets a blocked run kill.
mustCatch('the canary gate removed, so a blocked run\'s 404s kill',
  ['        if not canary_ok:', '        if False:'],
  (r) => r.gated?.['404_no_canary'] === 'gone');
// The original defect shape: any non-answer read as a removal.
mustCatch('a blocked/throttled read treated as death',
  ['    return "unknown", f"HTTP {status} is about our read, not the listing"',
   '    return "gone", "mutant"'],
  (r) => ['401', '403', '429'].some((k) => r.table?.[k] === 'gone'));
// A 200 we cannot recognise is not an empty page.
mustCatch('an unrecognised 200 resolved instead of held',
  ['        return "unknown", "200 without a RealEstateListing block (unrecognised page)"',
   '        return "gone", "mutant"'],
  (r) => r.table?.['200_unrecognised'] === 'gone');
// A transport failure must never even reach a verdict.
mustCatch('a network error resolving to a verdict',
  ['        return "unknown", "no answer from the source (transport/5xx after retries)"',
   '        return "gone", "mutant"'],
  (r) => r.table?.['network_error'] === 'gone');
// The opposite failure: the real death signal silently stops working and dead ads stay served.
mustCatch('the real 404 death signal no longer deactivating',
  ['        return "gone", f"source returned {status} while known-live canaries verified alive"',
   '        return "unknown", "mutant"'],
  (r) => r.table?.['404_with_canary'] !== 'gone');
// And the alive marker inverted — a not-found page read as a live listing.
mustCatch('the alive marker inverted (a not-found page read as live)',
  ['        if _ALIVE_MARKER in body:', '        if _ALIVE_MARKER not in body:'],
  (r) => r.table?.['200_unrecognised'] === 'live' || r.table?.['200_listing'] !== 'live');

console.log(failed === 0
  ? '\n✅ verify-raghdan-absence-cannot-deactivate: absence selects; a proven source answer kills.'
  : `\n❌ verify-raghdan-absence-cannot-deactivate: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
