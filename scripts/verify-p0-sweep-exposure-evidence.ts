// Barrier: THE LIMB 4 P0 SWEEP-EXPOSURE EXEMPTION MUST CARRY EVIDENCE, NEVER A PROXY.
// Systems Seam Engineer, 2026-09-21. Offline, deterministic, wired into `npm test` by discovery.
//
// WHAT THIS GUARDS. mon_detect_detector_sweep_budget() LIMB 4 (`detector_sweep_vs_p0_slo`) is the
// FORECAST that the twice-hourly detector sweep has grown long enough to blow the owner's 300s P0
// delivery SLO. Whether it raises at all is delegated to the pure predicate
// mon_p0_sweep_exposure_should_raise(numeric, jsonb). On 2026-09-01 that predicate gained an
// exemption (migration 20260901104521): if every P0-capable detector also appears in
// mon_run_p0_detectors()'s list, a P0 is assumed to be born in the fast lane's own 45s transaction,
// so sweep duration is "no longer a term in its delivery latency at all" and the limb goes quiet.
//
// THAT EXEMPTION WAS A SET-MEMBERSHIP PROXY, AND PRODUCTION FALSIFIED IT (2026-09-21). The sweep
// still runs every one of those detectors too, so the raise is won by whichever caller first
// observes the condition true — mon_raise() dedups, first observer wins. Measured on the live
// instance that day:
//   * 48 sweeps in 24h totalling 12,823s = 14.8% of the day. Fast-lane runs that STARTED inside a
//     sweep window: ZERO, against 82.5 expected from the lane's own cadence. Coverage ratio 0.000.
//     (7-day view: 312 long sweeps, 824 slots expected inside them, 10 actual — 1.2%.) pg_cron will
//     not start the lane while the sweep's backend holds the scheduler, which is the same mechanism
//     mon_detect_cron_starvation_risk() reports.
//   * Of P0s raised since the 2026-08-30 decoupling: 58 born in the lane, 0 breaches, worst 249s.
//     3 born in the sweep; the 2 that outlived their sweep (1166 at 371s, 4392 at 665s) BOTH
//     breached the 300s SLO — and LIMB 4 read green through both, because the proxy said the lane
//     covered them.
//
// So the exemption must rest on the MEASURED fact it was standing in for: does the lane actually
// execute while the sweep holds the scheduler? ops_p0_lane_contract() now publishes
// `lane_sweep_coverage_ratio`, and the predicate withdraws the exemption when the lane is starved.
//
// WHY THIS FILE EXISTS AT ALL. Before it, the exemption — the single clause that can make a P0
// delivery forecast permanently silent — had NO repo-side guard of any kind. A revert of the
// predicate is the one direction that fails OPEN: drop the contract key and the predicate's
// fail-safe branch raises, but drop the clause and the limb simply goes quiet again, exactly as it
// did for three weeks.
//
// MUTATION-PROVEN offline (each of these turns this check RED, verified 2026-09-21):
//   - the evidence clause removed from the predicate (the original defect, restored and watched)
//   - the missing-key fail-safe branch removed (a stale contract would silently disable the limb)
//   - the coverage threshold widened toward 0 (quieting the limb instead of fixing the path)
//   - the 300s SLO or the 40s filing overhead widened in condition (1)
//   - ops_p0_lane_contract() no longer publishing the coverage key
//   - the apply-time both-direction proof block deleted
//   - the predicate re-declared with a different argument list (a new overload, not a replacement)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const PREDICATE = 'mon_p0_sweep_exposure_should_raise';
const CONTRACT = 'ops_p0_lane_contract';
const EVIDENCE_KEY = 'lane_sweep_coverage_ratio';
const SLO_SECONDS = 300;
const FILING_OVERHEAD_S = 40;
// Measured 0.000 on the day this shipped; a lane that genuinely covers the sweep window sits near
// 1.0. Anything at or below this is "the lane is not running during sweeps". Lowering it toward 0
// is the widen-the-threshold move this barrier exists to stop.
const MIN_COVERAGE_THRESHOLD = 0.5;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
}

console.log('\nThe LIMB 4 P0 sweep-exposure exemption must carry evidence, not a proxy\n');

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

// Resolve by CONTENT and take the NEWEST definition, never a hardcoded filename: the server mints
// migration versions, so a name pinned here breaks the moment the object is redefined. The newest
// definition is the one production actually holds.
function newestDefining(symbol: string): { file: string; sql: string } | null {
  const owning = files
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }))
    .filter(({ sql }) =>
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${symbol}\\b`, 'i').test(sql))
    .sort((a, b) => a.file.localeCompare(b.file));
  return owning.length > 0 ? owning[owning.length - 1] : null;
}

const predFile = newestDefining(PREDICATE);
check(
  `a committed migration defines ${PREDICATE}()`,
  predFile !== null,
  'the predicate decides whether the P0 delivery forecast can fire at all; it cannot live only in '
    + 'production (migration-drift condition 1)',
);

const contractFile = newestDefining(CONTRACT);
check(
  `a committed migration defines ${CONTRACT}()`,
  contractFile !== null,
);

if (predFile === null || contractFile === null) {
  console.error('\n✗ cannot continue without both definitions\n');
  process.exit(1);
}

// Executable SQL only. The rationale comments in these migrations quote the clause text constantly
// — matching raw file text would let a barrier be satisfied by a COMMENT describing the fix while
// the code no longer does it. That is the exact "a pointer reads as coverage" shape AGENTS.md
// records, so the strip is load-bearing rather than tidiness.
function executable(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
}

// SCOPE EACH CHECK TO ITS OWN FUNCTION BODY. Caught by mutation M5 on the day this shipped: the
// predicate and the contract are defined in the SAME migration, so a whole-file `includes()` for
// the coverage key was satisfied by the PREDICATE's mention of it even after the CONTRACT had
// stopped publishing it — the barrier stayed green over a contract that would have pinned the
// predicate permanently into its fail-safe branch. This is the same lesson
// verify-p0-delivery-sla.ts records about its $wire$ block: a barrier satisfied by a token in a
// different block is not checking what it claims to.
function bodyOf(sql: string, symbol: string): string {
  const start = sql.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${symbol}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  // Function bodies here are dollar-quoted with $function$; take up to the closing delimiter.
  const end = rest.indexOf('$function$', rest.indexOf('$function$') + 1);
  return executable(end < 0 ? rest : rest.slice(0, end + '$function$'.length));
}

const predCode = bodyOf(predFile.sql, PREDICATE);
const contractCode = bodyOf(contractFile.sql, CONTRACT);
check(
  'both function bodies were isolated for checking (not whole-file text)',
  predCode.length > 0 && contractCode.length > 0
    && !predCode.includes(`function public.${CONTRACT}`)
    && !contractCode.includes(`function public.${PREDICATE}`),
  'the two objects ship in one migration; checks must not leak across them',
);

// ---------------------------------------------------------------------------------------------
// 1. The evidence clause itself.
check(
  `the predicate consults ${EVIDENCE_KEY} (evidence), not only the detector-membership proxy`,
  predCode.includes(EVIDENCE_KEY),
  'the exemption is back to asserting that lane MEMBERSHIP implies lane COVERAGE. It does not: the '
    + 'sweep runs the same detectors and wins the raise whenever it observes the condition first. '
    + 'Measured 2026-09-21: 2 of 2 sweep-born P0s breached while this limb read green.',
);

check(
  'a missing coverage key FAILS SAFE (an unreadable contract raises, never silently exempts)',
  /not\s*\(\s*p_contract\s*\?\s*'lane_sweep_coverage_ratio'\s*\)/.test(predCode),
  'every other unreadable branch in this predicate raises; this one must too, or a contract that '
    + 'loses the key disables the forecast instead of tripping it',
);

// ---------------------------------------------------------------------------------------------
// 2. The threshold, and the constants it must not be traded against.
const thresholdMatch = predCode.match(
  new RegExp(`${EVIDENCE_KEY}'\\s*\\)\\s*::numeric\\s*<\\s*([0-9.]+)`),
);
check(
  'the starvation threshold is present and has not been widened toward zero',
  thresholdMatch !== null && Number(thresholdMatch[1]) >= MIN_COVERAGE_THRESHOLD,
  thresholdMatch
    ? `found ${thresholdMatch[1]}, expected >= ${MIN_COVERAGE_THRESHOLD}. Lowering this quiets the `
      + 'limb without making a single P0 arrive sooner. Fix the PATH: slim the sweep, or ask the '
      + 'OWNER for a re-slot (cron schedule changes are owner-only).'
    : 'the numeric comparison against the coverage ratio is gone',
);

check(
  `condition (1) still charges the sweep against the ${SLO_SECONDS}s SLO with ${FILING_OVERHEAD_S}s overhead`,
  new RegExp(`\\+\\s*${FILING_OVERHEAD_S}\\s*>\\s*${SLO_SECONDS}\\b`).test(predCode),
  'the owner set the 300s SLO and forbade widening it to match a slower reality; the 40s filing '
    + 'overhead is the other half of the same forecast',
);

// ---------------------------------------------------------------------------------------------
// 3. The pre-existing exemption branches must survive. This change ADDS a reason to raise; it must
//    never become the only reason, which would silently drop the off-lane-detector guard that
//    20260901104521 shipped.
for (const [label, needle] of [
  ['an inactive lane still raises', "'lane_active'"],
  ['a lane with no runs still raises', "'lane_runs_24h'"],
  ['a P0-capable detector off the lane still raises', "'p0_capable_detectors'"],
  ['the lane detector list is still compared', "'lane_detectors'"],
] as const) {
  check(label, predCode.includes(needle));
}

check(
  'a null contract still raises (fail-safe on a totally unreadable contract)',
  /p_contract\s+is\s+null/.test(predCode),
);

// ---------------------------------------------------------------------------------------------
// 4. Same signature — a CREATE OR REPLACE with a different argument list is a NEW OVERLOAD, not a
//    replacement, and would leave the old (silent) predicate live and callable alongside it.
check(
  'the predicate keeps its (numeric, jsonb) signature — no accidental second overload',
  /p_max_sweep_s\s+numeric/.test(predCode) && /p_contract\s+jsonb/.test(predCode),
);

// ---------------------------------------------------------------------------------------------
// 5. The contract must actually publish what the predicate reads, or the predicate sits permanently
//    in its fail-safe branch and the limb becomes a stuck-open alert — which, per mon_raise()'s
//    dedup, is itself a disabled barrier.
check(
  `${CONTRACT}() publishes ${EVIDENCE_KEY}`,
  contractCode.includes(`'${EVIDENCE_KEY}'`),
);
check(
  'the contract measures lane runs that started INSIDE a sweep window',
  contractCode.includes("'lane_runs_inside_sweeps'")
    && contractCode.includes("'lane_runs_expected_inside_sweeps'"),
  'the ratio is only trustworthy if both of its terms are published for a human to audit',
);
check(
  'the sweep job is resolved by NAME, not a hardcoded jobid',
  /jobname\s*=\s*'mon-detectors-and-dispatch'/.test(contractCode),
  'a re-created sweep job gets a new jobid; a hardcoded one would silently measure nothing and '
    + 'report perfect coverage',
);

// ---------------------------------------------------------------------------------------------
// 6. The apply-time EXECUTED proof. This repo's standing lesson is that a source-text tripwire
//    passes for exactly as long as the defect is live, so the migration must RUN the predicate
//    against synthetic contracts in both directions rather than merely containing the clause.
const proof = predFile.sql.match(/do \$verify\$[\s\S]*?end \$verify\$/)?.[0] ?? '';
check(
  'the migration carries an apply-time proof block that EXECUTES the predicate',
  proof.length > 0 && proof.includes(`${PREDICATE}(`),
);
check(
  'the proof asserts the EXEMPT direction (a healthy, sweep-covering lane must not raise)',
  /if\s+public\.mon_p0_sweep_exposure_should_raise\([^)]*healthy\s*\)\s*then/.test(proof),
  'without this, a predicate hard-wired to "always raise" would pass — and a permanently-true '
    + 'barrier is a disabled barrier (mon_raise returns 0 on an already-open key)',
);
check(
  'the proof asserts the RAISE direction (a starved lane must defeat the exemption)',
  /if\s+not\s+public\.mon_p0_sweep_exposure_should_raise\([^)]*starved\s*\)\s*then/.test(proof),
  'this is the defect the migration fixes; it must be executed, not described',
);
check(
  'the proof pins condition (1) — a fast sweep cannot breach however starved the lane is',
  /mon_p0_sweep_exposure_should_raise\(\s*100\s*,/.test(proof),
);
check(
  'the proof checks the LIVE contract really carries the key',
  proof.includes(`${CONTRACT}()`) && proof.includes(EVIDENCE_KEY),
);

console.log(
  failures === 0
    ? '\n✓ p0-sweep-exposure-evidence: the exemption is evidence-backed, fail-safe and both-ways proven\n'
    : `\n✗ ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
