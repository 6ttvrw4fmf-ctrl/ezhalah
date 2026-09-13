// THE TEST RUNNER MUST BOUND EACH CHECK, AND A TIMEOUT MUST NAME THE CHECK THAT HUNG.
//
// WHY THIS EXISTS (ops_incident #222, routed to routine #10 by routine #2 on 2026-09-12 while
// driving PR #2365 to green).
//
// scripts/run-tests.mjs called spawnSync with NO `timeout` option. One hung check therefore
// consumed the ENTIRE 25-minute budget of full-verification-ci.yml, and the job died as a GitHub
// Actions job-level timeout — which names nothing. The suite streams child output with
// stdio:'inherit', so the last thing in the log is a check that STARTED, and the failure is
// attributed to "the suite" rather than to the check that hung. Every subsequent check in the run
// never executed at all, and nothing said so.
//
// Note what was NOT broken: the runner already treated a signal-killed child (`status === null`) as
// a failure rather than a skip, which is the harder half to get right. The gap was that nothing ever
// SENT that signal, so the correct handling was unreachable.
//
// WHAT THIS PINS, and why each half matters:
//
//   1. THE BOUND EXISTS and is passed to spawnSync. A runner that lost its `timeout` option would
//      look identical in every other test — the regression is invisible until a check hangs.
//   2. THE BOUND IS ABOVE THE SLOWEST REAL CHECK. A too-tight bound is the Prohibition-1 failure in
//      reverse: it would fail legitimate slow checks, and the pressure would then be to remove the
//      bound rather than to fix anything. The constant is documented against a real measurement of
//      all 452 checks; this asserts the headroom is still multiples, not margin.
//   3. EVERY CHILD RESULT SHAPE IS CLASSIFIED CORRECTLY, by executing childOutcome() against each —
//      above all that a TIMEOUT is reported as a timeout and not merely as "signal SIGTERM", since
//      naming the diagnosis is the entire deliverable of #222.
//   4. THE KILL SIGNAL STAYS SIGTERM. Several barriers mutate PRODUCT SOURCE in place and restore it
//      from a signal handler — a contract pinned by verify-in-place-mutators-restore-on-signal.ts.
//      SIGKILL cannot be caught, so bounding the runner with it would leave a mutated source file on
//      disk and poison every later check in the run. The fix for one hang would become a corrupted
//      tree. This is asserted as the ABSENCE of an explicit killSignal override.
//
//   node --experimental-strip-types scripts/verify-run-tests-bounds-each-check.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { childOutcome, outcomeIsPass, PER_CHECK_TIMEOUT_MS } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'scripts', 'run-tests.mjs');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  mutation caught: ${label}`);
  if (!caught) failed++;
};

console.log('\nThe test runner bounds each check, and a timeout names the check that hung\n');

// Strip comments at the READER, so the runner's own explanation of the bound cannot stand in for
// the bound. This file's header describes the defect; describing it must not satisfy the check.
const src = readFileSync(RUNNER, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

// ── 1. THE BOUND IS ACTUALLY PASSED TO spawnSync ────────────────────────────────────────────────
check('run-tests.mjs passes a timeout to spawnSync',
  /spawnSync\([\s\S]{0,400}?timeout:\s*PER_CHECK_TIMEOUT_MS/.test(src),
  'the runner spawns each check without a `timeout:` option — one hung check silently consumes the '
  + 'whole CI budget and the job dies as a timeout that names nothing (ops_incident #222)');

// ── 4. THE KILL SIGNAL STAYS CATCHABLE ──────────────────────────────────────────────────────────
// An explicit killSignal is the regression: the default (SIGTERM) is what lets an in-place mutator
// restore the product source it borrowed before the process dies.
check('the runner does NOT override killSignal (SIGTERM must stay catchable)',
  !/killSignal/.test(src),
  'an explicit killSignal appears in run-tests.mjs. If it is SIGKILL, a bounded check that mutates '
  + 'product source in place can no longer restore it, and every later check runs against a '
  + 'corrupted tree — see verify-in-place-mutators-restore-on-signal.ts');

// ── 2. THE BOUND HAS REAL HEADROOM OVER THE SLOWEST MEASURED CHECK ──────────────────────────────
// Measured 2026-09-13 across all 452 checks; the slowest drives a virtual clock and is a genuine
// outlier (the next is 30,038 ms and everything else is under 5,500 ms).
const SLOWEST_MEASURED_MS = 142_323;
check(`the bound clears the slowest measured check with multiples to spare `
  + `(${PER_CHECK_TIMEOUT_MS}ms vs ${SLOWEST_MEASURED_MS}ms = ${(PER_CHECK_TIMEOUT_MS / SLOWEST_MEASURED_MS).toFixed(1)}x)`,
  PER_CHECK_TIMEOUT_MS >= SLOWEST_MEASURED_MS * 3,
  'the per-check bound is close to a real check\'s runtime. A bound that fails legitimate checks '
  + 'creates pressure to REMOVE the bound, which is how this class comes back.');

// ...and it must stay well inside the CI job budget, or bounding each check achieves nothing.
const ciYml = readFileSync(join(ROOT, '.github/workflows/full-verification-ci.yml'), 'utf8');
const budgetMin = Math.max(...[...ciYml.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1])));
check(`the bound leaves the CI job room to report it (${PER_CHECK_TIMEOUT_MS}ms vs a ${budgetMin}min job budget)`,
  Number.isFinite(budgetMin) && budgetMin > 0 && PER_CHECK_TIMEOUT_MS < budgetMin * 60_000 * 0.75,
  'a per-check bound at or above the job budget can never fire before the job itself dies — the '
  + 'failure would still be attributed to nothing.');

// ── 3. EVERY RESULT SHAPE IS CLASSIFIED, BY EXECUTION ───────────────────────────────────────────
// The classifier is run against each shape spawnSync really produces, not grepped for.
check('a clean zero exit is the ONLY pass',
  childOutcome({ status: 0 }) === 'ok' && outcomeIsPass('ok'));

mustCatch('a TIMEOUT reported as anything other than a timeout (the #222 diagnosis itself)',
  childOutcome({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }) === 'timeout');

mustCatch('a signal-killed child (status null) read as a pass — how an OOM reads as green',
  !outcomeIsPass(childOutcome({ status: null, signal: 'SIGKILL' })));

mustCatch('a non-zero exit read as a pass',
  !outcomeIsPass(childOutcome({ status: 1 })));

// The ordering rule, stated as a proof: a timed-out child is ALSO signal-killed, so a classifier
// that tested `status === null` first would report every timeout as a generic signal death and the
// operator would be back to guessing. This is the exact mistake the fix had to avoid.
mustCatch('a timeout being demoted to a generic signal death because signal was checked first',
  childOutcome({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } }) !== 'signal');

// A non-timeout spawn error (ENOENT: the interpreter is missing) must NOT be called a timeout.
mustCatch('an unrelated spawn error mislabelled as a timeout',
  childOutcome({ status: null, signal: null, error: { code: 'ENOENT' } }) === 'signal');

// ── NEGATIVE CONTROLS — the predicate is not vacuously red ──────────────────────────────────────
check('a successful run is NOT reported as a failure (not vacuous)',
  outcomeIsPass(childOutcome({ status: 0, signal: null, error: null })));
check('the SHIPPED runner passes every structural assertion above (not vacuously red)',
  /timeout:/.test(src) && !/killSignal/.test(src));

console.log(failed === 0
  ? '\n✅ every check is time-bounded, and a hang is named rather than anonymous\n'
  : `\n❌ ${failed} failure(s)\n`);
process.exit(failed === 0 ? 0 : 1);
