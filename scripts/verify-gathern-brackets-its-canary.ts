// A POSITIVE CONTROL MAY OVERRIDE A PROXY ONLY WHILE IT COVERS THE WHOLE RUN.
//
// THE CHANGE THIS GUARDS (ops_incident #183, 2026-09-11)
// -----------------------------------------------------
// gathern's run-level trust gate used the aggregate alive-rate to answer "is this environment
// answering truthfully?". That rate is a PROXY for the question the canary asks directly, and it
// has one structural flaw: it cannot separate "the source is lying to us" from "this cohort is
// genuinely dead", because both look like a low alive-rate. The worklist is selected by
// --min-stale-days, i.e. deliberately built from the rows most likely to be gone.
//
// Measured in one production run, both signals present and flatly contradicting each other:
//
//     canary   10/10 known-alive controls -> HTTP 200   (the source is answering perfectly)
//     worklist 1,469 of 1,500 -> 404, alive_rate 2.1%   (this stale cohort really is dead)
//     verdict  TRUST-QUARANTINED "the source is not answering this run reliably"   <- wrong
//
// It worsened with scale — 8.3% at n=60, 6.0% at n=150, 2.1% at n=1500 — because the worklist is
// ordered oldest-stale-first. The more complete and more honest the run, the more certainly it
// condemned itself; only a PARTIAL run could ever clear the floor.
//
// So a passing control now supersedes the rate. That is safe ONLY under one condition, and this
// barrier exists to keep that condition true.
//
// THE CONDITION: THE RUN MUST BE BRACKETED
// ----------------------------------------
// An opening canary proves the environment at run START. The failure the rate gate was built for
// (2026-09-01) looked healthy early and was blocked by the end — so an opening-only control would
// supersede the rate gate while reproducing exactly the hole it was built to close. gathern
// therefore re-probes the SAME control set after the worklist and requires BOTH ends:
//
//     canary_ok = opening AND closing        (never OR, never opening alone)
//
// Delete the closing probe, or relax the AND to an OR, and the supersession becomes unsafe while
// every test above it still passes. That is the decay this file is here to catch.
//
// NOTHING IS LOOSENED. MIN_ALIVE_RATE_FOR_TRUST, MIN_PROBES_FOR_TRUST, MIN_CANARIES,
// MIN_CANARY_ALIVE_RATE, the 3-strike grace and the anomaly cap are all untouched, and the
// fail-closed branches are EXECUTED below rather than asserted.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const GATHERN = join(ROOT, 'scrapers', 'gathern', 'liveness.py');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  // String concatenation, not template literals, throughout — the mutation-proof ratchet strips
  // quoted spans and a stray backtick can desynchronise it and hide every mustCatch( below.
  if (ok) { console.log('  ok  ' + what); return; }
  failed += 1;
  console.log('FAIL  ' + what + (detail ? '\n      ' + detail : ''));
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PART 1 — the predicate itself, EXECUTED. liveness_trust is pure, so it runs with no stubs.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const PRED = String.raw`
import json, os, sys
sys.path.insert(0, os.getcwd())
from scrapers.common.liveness_trust import (
    environment_is_trustworthy as t, canary_environment_ok as c,
    MIN_ALIVE_RATE_FOR_TRUST, MIN_PROBES_FOR_TRUST,
)
print(json.dumps({
  "real_run_with_bracket":      t(31, 1500, canary_ok=True),
  "real_run_without_bracket":   t(31, 1500),
  "failed_control_high_rate":   t(900, 1000, canary_ok=False),
  "failed_control_all_dead":    t(0, 500, canary_ok=False),
  "degenerate_zero_probes":     t(0, 0, canary_ok=True),
  "degenerate_negative_alive":  t(-1, 100, canary_ok=True),
  "healthy_default_unchanged":  t(30, 100),
  "thin_default_unchanged":     t(4, 25),
  "canary_floor_exact":         c(6, 10),
  "canary_floor_below":         c(5, 10),
  "canary_floor_too_few":       c(4, 4),
  "rate_const":                 MIN_ALIVE_RATE_FOR_TRUST,
  "probes_const":               MIN_PROBES_FOR_TRUST,
}))
`;
const pred = JSON.parse(execFileSync('python3', ['-c', PRED], { cwd: ROOT, encoding: 'utf8' }));

check(pred.real_run_with_bracket === true,
  'a bracketed control trusts the real 1,469-dead-of-1,500 run');
check(pred.real_run_without_bracket === false,
  'the same run WITHOUT a control is still refused — the proxy still governs when alone');
check(pred.failed_control_high_rate === false,
  'a FAILED control is never rescued by a healthy-looking rate');
check(pred.failed_control_all_dead === false,
  'a failed control is not read as the listings being alive');
check(pred.degenerate_zero_probes === false && pred.degenerate_negative_alive === false,
  'degenerate input still fails CLOSED even with a passing control');
check(pred.healthy_default_unchanged === true && pred.thin_default_unchanged === false,
  'the default (no-canary) path is unchanged — dealapp is unaffected');
check(pred.canary_floor_exact === true && pred.canary_floor_below === false
      && pred.canary_floor_too_few === false,
  'the control has its own floor: 60% of at least MIN_CANARIES, failing closed');
check(pred.rate_const === 0.2 && pred.probes_const === 25,
  'no constant was loosened (rate 0.20, probes 25)');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PART 2 — the WIRING, read from the syntax tree of the shipped file. Asked of source rather than
// imports so a mutant can be applied in memory: this barrier never rewrites a tracked file, so a
// timeout cannot leave a mutant on disk in a working tree AGENTS.md says is shared.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const WIRING = String.raw`
import ast, json, sys
src = sys.stdin.read()
try:
    tree = ast.parse(src)
except SyntaxError as exc:
    print(json.dumps({"error": "mutant does not parse: %s" % exc})); raise SystemExit(0)

# Count control probes ONLY inside the function that holds the trust gate. Counting them
# file-wide is too weak to be worth anything: liveness.py has a separate _run_canary call in the
# resurrection pass, so deleting the CLOSING probe from the kill pass still left two in the file
# and the mutant survived. That false pass is why this is scoped — the barrier was asserting less
# than it read, the same authoring trap #2271 recorded.
canary_calls = 0          # probes of the control set inside the kill pass
ok_is_and = False         # canary_ok computed as a boolean AND of two names
passes_canary_ok = False  # ...and actually handed to the trust gate

def _holds_trust_gate(fn):
    for n in ast.walk(fn):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) \
           and n.func.id == "environment_is_trustworthy":
            return True
    return False

for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
    if not _holds_trust_gate(fn):
        continue
    for n in ast.walk(fn):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_run_canary":
            canary_calls += 1

for node in ast.walk(tree):
    if isinstance(node, ast.Assign):
        for tgt in node.targets:
            if isinstance(tgt, ast.Name) and tgt.id == "canary_ok":
                v = node.value
                inner = v.args[0] if (isinstance(v, ast.Call) and isinstance(v.func, ast.Name)
                                      and v.func.id == "bool" and v.args) else v
                if isinstance(inner, ast.BoolOp) and isinstance(inner.op, ast.And):
                    ok_is_and = True
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
       and node.func.id == "environment_is_trustworthy":
        for kw in node.keywords:
            if kw.arg == "canary_ok":
                passes_canary_ok = True
print(json.dumps({"canary_calls": canary_calls, "ok_is_and": ok_is_and,
                  "passes_canary_ok": passes_canary_ok}))
`;
const readWiring = (src: string) =>
  JSON.parse(execFileSync('python3', ['-c', WIRING], { cwd: ROOT, input: src, encoding: 'utf8' }));

const SHIPPED = readFileSync(GATHERN, 'utf8');
const w = readWiring(SHIPPED);

const LAWS: Array<[string, (r: any) => boolean]> = [
  ['the run probes its control set at BOTH ends', (r) => r.canary_calls >= 2],
  ['canary_ok is an AND of the two ends, never an OR', (r) => r.ok_is_and === true],
  ['canary_ok is actually handed to the trust gate', (r) => r.passes_canary_ok === true],
];
const TOTAL = LAWS.length;
const lawsHeld = (r: any) => LAWS.filter(([, f]) => { try { return f(r); } catch { return false; } });
for (const [what, f] of LAWS) check(f(w), what);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real way this could decay, applied to the SHIPPED source and
// re-read. A mutant that leaves every law standing means this barrier asserts nothing.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, from: string, to: string) => {
  if (!SHIPPED.includes(from)) {
    check(false, '(mutation) ' + what, 'anchor not found in shipped source: ' + from);
    return;
  }
  const r = readWiring(SHIPPED.split(from).join(to));
  if (r.error) { check(true, '(mutation) catches ' + what + ' (mutant refused to parse)'); return; }
  check(lawsHeld(r).length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every law still held with the defect present, so this barrier is ' +
    'asserting the bug rather than the rule');
};

// The decay that matters most: drop the closing probe, keep the supersession. Opening-only control
// reopens the 2026-09-01 mid-run-degradation hole while looking entirely healthy.
mustCatch('the closing canary being removed (opening-only control)',
  'p_ok, p_alive, p_probed, p_hist = _run_canary(s, client, args.canaries)',
  'p_ok, p_alive, p_probed, p_hist = True, 0, 0, "skipped"');

// Relax the bracket to an OR and a blocked finish stops mattering.
mustCatch('the bracket being relaxed from AND to OR',
  'canary_ok = bool(c_ok and p_ok)', 'canary_ok = bool(c_ok or p_ok)');

// Trust the opening end alone.
mustCatch('the bracket collapsing to the opening end only',
  'canary_ok = bool(c_ok and p_ok)', 'canary_ok = bool(c_ok)');

// Compute the bracket correctly and then never hand it over: the gate silently reverts to the
// proxy, and the honest runs go back to condemning themselves.
mustCatch('canary_ok being computed but not passed to the trust gate',
  'environment_is_trustworthy(alive, seen, canary_ok=canary_ok)',
  'environment_is_trustworthy(alive, seen)');

console.log(failed === 0
  ? '\n✅ verify-gathern-brackets-its-canary: the control supersedes the proxy only while it ' +
    'covers the whole run; nothing was loosened.'
  : '\n❌ verify-gathern-brackets-its-canary: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
