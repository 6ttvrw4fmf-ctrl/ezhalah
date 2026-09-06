// UNKNOWN IS NOT DEAD — sanadak's deactivation path, executed rather than read.
//
// THE HARDEST OF THE FIVE, AND WHY
// --------------------------------
// Aqargate says «expired» out loud and raghdan answers 404, so on those platforms a removal is
// self-describing. Sanadak never says anything at all. Measured against the live source 2026-09-06:
//
//     live listing   -> HTTP 200, ~258-272KB RSC flight payload containing its OWN
//                       advertisementNumber with isPublished=true
//     removed row    -> HTTP 200, ~70-80KB payload, no listing object, NO error message anywhere
//     bogus id       -> HTTP 200, byte-comparable payload, indistinguishable from the removed row
//
// There is no «not found» text to key on. The only signal is the ABSENCE of a listing object — and
// absence of content is precisely what a backend blip, a truncated stream or a half-rendered shell
// also produce. Treating it as death unconditionally is the dealapp-shell trap: it would deactivate
// live inventory every time sanadak hiccups.
//
// So this oracle may only conclude death when TWO things hold together: the shell rendered
// COMPLETELY (the footer's commercial-register number is present, so the response is not truncated)
// AND this run's in-run canary control passed (listings the source served us minutes ago still come
// back alive). Either one missing ⇒ unknown ⇒ the strike is held and nothing is deactivated.
//
// The one case sanadak DOES state a removal — its own listing object present with
// isPublished=false — is affirmative and needs no control. That asymmetry is asserted below.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RUN_PY = join(ROOT, 'scrapers', 'sanadak', 'run.py');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
console.log('verify-sanadak-absence-cannot-deactivate: no listing object is not, by itself, a death.');

const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.sanadak.run as run

fn = run.sanadak_verdict
mut = os.environ.get("MUTATE")
if mut:
    find, repl = json.loads(mut)
    src = textwrap.dedent(inspect.getsource(run.sanadak_verdict))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    ns = dict(run.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    fn = ns["sanadak_verdict"]

URL = "https://sanadak.sa/property-details/شقة-للإيجار-في-الرياض-النرجس-3-غرفة-7201059740"
AD  = "7201059740"
SHELL = "4030464127"      # the footer register number: proof the RSC shell rendered completely

def payload(**kw):
    """A flight body carrying the page's OWN listing object, shaped like the real one."""
    obj = {"advertisementNumber": AD}; obj.update(kw)
    return SHELL + " " + json.dumps(obj, ensure_ascii=False)

FULL_SHELL_NO_LISTING = SHELL + " (nav, footer, no listing object)"
TRUNCATED             = "(stream cut before the footer rendered)"
OTHER_LISTING_ONLY    = SHELL + " " + json.dumps({"advertisementNumber": "9999999999",
                                                  "isPublished": True})

def v(status, body, canary=True):
    return fn(status, body, URL, canary_ok=canary)[0]

out = {"table": {
  "network_error":        v(None, ""),
  "401":                  v(401, ""),
  "403":                  v(403, ""),
  "429":                  v(429, ""),
  "500":                  v(500, ""),
  "503":                  v(503, ""),
  "302":                  v(302, ""),
  "200_truncated_shell":  v(200, TRUNCATED),
  "200_empty_body":       v(200, ""),
  # A carousel card for a DIFFERENT listing must not be mistaken for this page's own object.
  "200_other_listing":    v(200, OTHER_LISTING_ONLY),
  "200_isPublished_null": v(200, payload(isPublished=None)),
  # Affirmative limbs.
  "200_published":        v(200, payload(isPublished=True)),
  "200_unpublished":      v(200, payload(isPublished=False)),
  "200_no_listing":       v(200, FULL_SHELL_NO_LISTING),
}, "gated": {
  # THE GATE: identical death-shaped input on an unproven environment.
  "no_listing_no_canary":     v(200, FULL_SHELL_NO_LISTING, canary=False),
  # Affirmative removal needs no control — the source stated it.
  "unpublished_no_canary":    v(200, payload(isPublished=False), canary=False),
  # Nor does an affirmative life answer.
  "published_no_canary":      v(200, payload(isPublished=True), canary=False),
  # A truncated shell stays unknown whatever the control says.
  "truncated_with_canary":    v(200, TRUNCATED, canary=True),
}}
print(json.dumps(out))
`;

type R = { table?: Record<string, string>; gated?: Record<string, string>; error?: string };
const run = (mutate?: [string, string]): R => JSON.parse(
  execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  }).trim().split('\n').pop() as string);

const UNKNOWN = ['network_error', '401', '403', '429', '500', '503', '302',
  '200_truncated_shell', '200_empty_body', '200_other_listing', '200_isPublished_null'];

const base = run();
check(!base.error, 'the shipped oracle imports and runs', base.error ?? '');
for (const k of UNKNOWN) {
  check(base.table?.[k] !== 'gone', `${k} is NOT death`,
    `returned ${JSON.stringify(base.table?.[k])} — an UNKNOWN read must never deactivate`);
}
check(base.table?.['200_other_listing'] === 'unknown',
  "a carousel card for a DIFFERENT listing is not this page's own answer",
  'the RSC payload embeds ~5 similar-listing cards; matching the wrong one is the exact bug ' +
  '_extract_obj_for_url was written to fix (the 2026-07-14 price-fidelity incident)');
check(base.table?.['200_published'] === 'live', 'own object with isPublished=true is ALIVE');
check(base.table?.['200_unpublished'] === 'gone',
  'own object with isPublished=false IS an affirmative removal');
check(base.table?.['200_no_listing'] === 'gone',
  'a fully-rendered shell with no listing object is a removal ONCE the canaries pass');

// ── The gate, and its deliberate asymmetry ──────────────────────────────────────────────────────
check(base.gated?.['no_listing_no_canary'] === 'unknown',
  'no listing object on an UNPROVEN environment degrades to unknown',
  `returned ${JSON.stringify(base.gated?.['no_listing_no_canary'])} — without this, a sanadak ` +
  'backend blip deactivates live inventory, which is the dealapp-shell trap');
check(base.gated?.['truncated_with_canary'] === 'unknown',
  'a TRUNCATED shell stays unknown even when the canaries passed',
  'the control proves the source is honest, not that THIS response was complete — both are needed');
check(base.gated?.['unpublished_no_canary'] === 'gone',
  'an affirmative isPublished=false removal is NOT gated by the control',
  'the source stated it; gating a self-describing removal would leave dead inventory served');
check(base.gated?.['published_no_canary'] === 'live',
  'an affirmative life answer is NOT gated by the control (DELETION_SAFETY.md §2.4)');

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────────
const src = readFileSync(RUN_PY, 'utf8');
check(/db\.prune_unseen\([\s\S]{0,240}?verify_gone=verify_gone/.test(src),
  'prune_unseen is called WITH the oracle');
check(/InRunCanary\(_sanadak_is_alive/.test(src) && /canary\.offer\(/.test(src),
  'the canary control is constructed from listings this run proved live');

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutate: [string, string], probe: (r: R) => boolean) => {
  const r = run(mutate);
  if (r.error) { check(false, `(mutation) ${what}`, r.error); return; }
  check(probe(r), `(mutation) catches ${what}`,
    'MUTANT SURVIVED — an assertion above is blind to the defect it exists to catch');
};

// The gate removed: every sanadak hiccup becomes a mass deactivation.
mustCatch('the canary gate removed, so an unproven run kills on absent content',
  ['    if not canary_ok:', '    if False:'],
  (r) => r.gated?.['no_listing_no_canary'] === 'gone');
// The completeness check removed: a truncated stream reads as "no listing".
mustCatch('the shell-completeness check removed, so a truncated stream reads as a removal',
  ['    if _SHELL_MARKER not in body:', '    if False:'],
  (r) => r.table?.['200_truncated_shell'] === 'gone' || r.gated?.['truncated_with_canary'] === 'gone');
// A non-200 read as death.
mustCatch('a blocked/throttled read treated as death',
  ['        return "unknown", f"HTTP {status} is about our read, not the listing"',
   '        return "gone", "mutant"'],
  (r) => ['401', '403', '429', '500'].some((k) => r.table?.[k] === 'gone'));
// A transport failure read as death.
mustCatch('a network error resolving to a verdict',
  ['        return "unknown", "no answer from the source (transport/5xx after retries)"',
   '        return "gone", "mutant"'],
  (r) => r.table?.['network_error'] === 'gone');
// isPublished neither true nor false (a schema change) guessed instead of held.
mustCatch('an unrecognised isPublished value guessed instead of held',
  ['        return "unknown", f"own listing object present but isPublished={published!r}"',
   '        return "gone", "mutant"'],
  (r) => r.table?.['200_isPublished_null'] === 'gone');
// The opposite failure: the affirmative removal stops working and dead ads stay served.
mustCatch('the affirmative isPublished=false removal no longer deactivating',
  ['            return "gone", "own listing object present with isPublished=false"',
   '            return "unknown", "mutant"'],
  (r) => r.table?.['200_unpublished'] !== 'gone');

console.log(failed === 0
  ? '\n✅ verify-sanadak-absence-cannot-deactivate: a complete shell AND a proven run, or no kill.'
  : `\n❌ verify-sanadak-absence-cannot-deactivate: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
