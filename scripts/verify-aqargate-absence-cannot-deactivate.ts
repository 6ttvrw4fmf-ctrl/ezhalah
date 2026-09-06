// UNKNOWN IS NOT DEAD — aqargate's deactivation path, executed rather than read.
//
// THE DEFECT THIS EXISTS TO PREVENT
// --------------------------------
// Until 2026-09-06 scrapers/aqargate/run.py called db.prune_unseen() with NO source oracle, under a
// comment that said the quiet part out loud: "we fetched the COMPLETE catalog, so any Aqargate row
// not seen this run is gone". That is exactly the inference docs/ops/LISTING_LIVENESS.md §1-§3
// forbids — absence from a crawl is EvidenceKind.ABSENCE, a candidate signal and never a verdict,
// because a throttled run, a partial page or a source-side index gap is indistinguishable from a
// removal. It produced a standing P1 `unknown_treated_as_dead` (7 rows deactivated inside 48h with
// no source verdict recorded anywhere), and what waits at the end of that road is a permanent,
// unrecoverable delete.
//
// WHY THIS BARRIER EXECUTES THE FUNCTION INSTEAD OF GREPPING IT
// ------------------------------------------------------------
// AGENTS.md: every one of the five defects of 2026-09-04 had a barrier over the exact line, and
// every one of those barriers was a source-TEXT tripwire that stayed green for as long as the defect
// was live — two of them pinned the defective line as CORRECT. So this file imports the REAL
// `_gone_verdict` / `_verify_gone` out of the shipped module and runs them. The only text assertion
// here is the one thing that cannot be executed without a network: that the prune call site actually
// passes the oracle.
//
// THE TRAP SPECIFIC TO THIS PLATFORM, and why "404 ⇒ gone" is not good enough. aqargate usually does
// NOT delete a lapsed post: it flips the WordPress status from `publish` to `expired` and keeps
// serving HTTP 200. A naive 200⇒live oracle would call every expired ad alive (abeea's oracle made
// exactly that mistake and 9 rows were wrongly restored). It *also* sometimes hard-deletes, which
// answers 404 with `rest_post_invalid_id`. Both limbs are affirmative and both are asserted below.
// Conversely a 404 the API does NOT attribute to the post id is not a not-found — LISTING_LIVENESS.md
// §5.4 measured gathern expressing BLOCKING as its own 404, a 100% false-death rate.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RUN_PY = join(ROOT, 'scrapers', 'aqargate', 'run.py');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

console.log('verify-aqargate-absence-cannot-deactivate: only an affirmative source answer may kill.');

// ── The harness: runs the REAL functions and prints a JSON verdict table ─────────────────────────
// `MUTATE` (optional) is a JSON [find, replace] applied to the source of the decision function
// before it is re-defined — that is how the mutation proofs below re-introduce real defects and
// watch this barrier's own assertions go red.
const HARNESS = String.raw`
import json, os, sys, inspect, textwrap
sys.path.insert(0, os.getcwd())
import scrapers.aqargate.run as run

gv = run._gone_verdict
mut = os.environ.get("MUTATE")
if mut:
    find, repl = json.loads(mut)
    src = textwrap.dedent(inspect.getsource(run._gone_verdict))
    if find not in src:
        print(json.dumps({"error": "mutation target not found: %r" % find})); sys.exit(0)
    ns = dict(run.__dict__)
    exec(compile(src.replace(find, repl), "<mutant>", "exec"), ns)
    gv = ns["_gone_verdict"]

# (verdict, reason) or None ("no answer yet — retry"). None is never death.
def v(status, payload):
    r = gv(status, payload, "49797")
    return None if r is None else r[0]

PUB  = {"id": "49797", "status": "publish"}
EXP  = {"id": "49797", "status": "expired"}

table = {
  # Every UNKNOWN shape the contract enumerates. None here means "retry", which the caller
  # turns into 'unknown'; what matters is that NONE of them is 'gone'.
  "network_error":        v(None, None),
  "401_unauthorised":     v(401, None),
  "403_blocked":          v(403, None),
  "408_timeout":          v(408, None),
  "429_throttled":        v(429, None),
  "500_server":           v(500, None),
  "503_server":           v(503, None),
  "302_unresolved":       v(302, None),
  "404_no_code":          v(404, None),
  "404_blocked_as_404":   v(404, {"code": "rest_forbidden"}),
  "200_unparseable":      v(200, None),
  "200_id_mismatch":      v(200, {"id": "11111", "status": "publish"}),
  "200_no_status":        v(200, {"id": "49797"}),
  "200_novel_status":     v(200, {"id": "49797", "status": "brand_new_state"}),
  # The two affirmative DEAD limbs this platform actually uses.
  "200_expired":          v(200, EXP),
  "404_post_deleted":     v(404, {"code": "rest_post_invalid_id"}),
  "200_draft":            v(200, {"id": "49797", "status": "draft"}),
  "200_trash":            v(200, {"id": "49797", "status": "trash"}),
  # The affirmative ALIVE limb.
  "200_publish":          v(200, PUB),
}

# The real _verify_gone, executed against an injected transport: no network, no clock.
class _Stub:
    def __init__(self, seq): self.seq = list(seq)
    def get(self, url, timeout=None):
        item = self.seq.pop(0)
        if isinstance(item, Exception): raise item
        class R:
            status_code = item[0]
            def json(_s):
                if item[1] is None: raise ValueError("not json")
                return item[1]
        return R()

run._throttle = lambda: None
import time; time.sleep = lambda *_a, **_k: None
if mut: run._gone_verdict = gv

def vg(seq):
    run._oracle_session = lambda: _Stub(seq)
    return run._verify_gone("AG49797")[0]

wired = {
  "blocked_twice":        vg([(403, None), (403, None)]),
  "timeout_twice":        vg([OSError("reset"), OSError("reset")]),
  "5xx_twice":            vg([(500, None), (503, None)]),
  "transient_then_live":  vg([(500, None), (200, PUB)]),
  "transient_then_gone":  vg([OSError("reset"), (200, EXP)]),
  "hard_deleted":         vg([(404, {"code": "rest_post_invalid_id"})]),
}
print(json.dumps({"table": table, "wired": wired}))
`;

type Result = { table?: Record<string, string | null>; wired?: Record<string, string>; error?: string };

const runHarness = (mutate?: [string, string]): Result => {
  const out = execFileSync('python3', ['-c', HARNESS], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(mutate ? { MUTATE: JSON.stringify(mutate) } : {}) },
  });
  return JSON.parse(out.trim().split('\n').pop() as string) as Result;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE LAW, EXECUTED. Nothing that is not an affirmative source answer may be 'gone'.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const UNKNOWN_SHAPES = [
  'network_error', '401_unauthorised', '403_blocked', '408_timeout', '429_throttled',
  '500_server', '503_server', '302_unresolved', '404_no_code', '404_blocked_as_404',
  '200_unparseable', '200_id_mismatch', '200_no_status', '200_novel_status',
];
const GONE_SHAPES = ['200_expired', '404_post_deleted', '200_draft', '200_trash'];

// `assertAll` returns the list of assertions that HOLD, so a mutation proof can watch it shrink.
const lawHolds = (r: Result): string[] => {
  const t = r.table ?? {};
  const held: string[] = [];
  for (const k of UNKNOWN_SHAPES) if (t[k] !== 'gone') held.push(`unknown:${k}`);
  for (const k of GONE_SHAPES) if (t[k] === 'gone') held.push(`gone:${k}`);
  if (t['200_publish'] === 'live') held.push('live:200_publish');
  return held;
};
const TOTAL = UNKNOWN_SHAPES.length + GONE_SHAPES.length + 1;

const base = runHarness();
check(!base.error, 'the shipped oracle imports and runs', base.error ?? '');

for (const k of UNKNOWN_SHAPES) {
  check(base.table?.[k] !== 'gone',
    `${k} is NOT death`,
    `_gone_verdict returned ${JSON.stringify(base.table?.[k])} — an UNKNOWN read must never deactivate`);
}
for (const k of GONE_SHAPES) {
  check(base.table?.[k] === 'gone',
    `${k} IS an affirmative source removal`,
    `returned ${JSON.stringify(base.table?.[k])} — this platform's real death signal must still kill, ` +
    'or the oracle degrades into "never deactivate anything" and dead inventory stays searchable');
}
check(base.table?.['200_publish'] === 'live', '200 + wp status=publish is ALIVE');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE WHOLE FUNCTION, EXECUTED against an injected transport (retries included).
// ─────────────────────────────────────────────────────────────────────────────────────────────
for (const k of ['blocked_twice', 'timeout_twice', '5xx_twice']) {
  check(base.wired?.[k] === 'unknown',
    `_verify_gone: ${k} exhausts its retries as 'unknown'`,
    `returned ${JSON.stringify(base.wired?.[k])} — a source we could not reach is not a dead listing`);
}
check(base.wired?.transient_then_live === 'live',
  "_verify_gone: a transient 5xx followed by a live read is 'live' (retries work)");
check(base.wired?.transient_then_gone === 'gone',
  "_verify_gone: a dropped connection followed by an expired read is 'gone'");
check(base.wired?.hard_deleted === 'gone', "_verify_gone: a deleted wp post is 'gone'");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. THE WIRING. An oracle nothing calls is decoration — and this is the exact regression that
//    would silently restore the original defect (absence alone deactivating).
// ─────────────────────────────────────────────────────────────────────────────────────────────
const src = readFileSync(RUN_PY, 'utf8');
check(/db\.prune_unseen\([\s\S]{0,200}?verify_gone=_verify_gone/.test(src),
  'prune_unseen is called WITH verify_gone=_verify_gone',
  'the oracle exists but nothing passes it to prune_unseen — absence would deactivate again');
check(!/any Aqargate row not seen this run\s*\n?\s*#?\s*is gone/.test(src),
  'the "not seen this run ⇒ gone" rationale is gone from the prune comment');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real defect, re-introduced into the SHIPPED source and
// executed. A mutant that leaves `lawHolds()` complete means the assertions above are blind.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutate: [string, string]) => {
  const r = runHarness(mutate);
  if (r.error) { check(false, `(mutation) ${what}`, r.error); return; }
  const held = lawHolds(r);
  check(held.length < TOTAL, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — every assertion above still passed with the defect present, so this barrier ' +
    'is asserting the bug rather than the rule');
};

// The original defect, in its purest form: treat any non-answer as a removal.
mustCatch('a blocked/throttled read being treated as death',
  ['if status != 200:\n        return None', 'if status != 200:\n        return "gone", "mutant"']);
// The gathern trap (LISTING_LIVENESS.md §5.4): a bare 404 read as a not-found.
mustCatch('a 404 the API does not attribute to the post id being read as a not-found',
  ['return "unknown", f"404 without rest_post_invalid_id (code={code!r})"',
   'return "gone", "mutant"']);
// A 200 whose body we cannot read is not an answer.
mustCatch('an unparseable 200 body being resolved instead of held',
  ['return "unknown", "200 with unparseable body"', 'return "gone", "mutant"']);
// A status string nobody has seen before must hold, not guess — the open-world case.
mustCatch('an unrecognised wp status defaulting to gone',
  ['return "unknown", f"unrecognised wp status={st!r}"', 'return "gone", "mutant"']);
// The opposite failure, which is how an oracle silently stops protecting anything: if the real
// death signal stops killing, aqargate keeps serving expired ads and the barrier must say so.
mustCatch('the real `expired` death signal no longer deactivating',
  ['if st in GONE_STATUSES:\n        return "gone", f"wp status={st}"',
   'if st in GONE_STATUSES:\n        return "unknown", "mutant"']);
// A network error is the one shape that must never even reach a verdict.
mustCatch('a network error resolving to a verdict instead of a retry',
  ['if status is None:\n        return None', 'if status is None:\n        return "gone", "mutant"']);

console.log(failed === 0
  ? '\n✅ verify-aqargate-absence-cannot-deactivate: absence selects candidates; only the source kills.'
  : `\n❌ verify-aqargate-absence-cannot-deactivate: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
