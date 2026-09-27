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
// THE PROOF IS EXECUTED, NOT DESCRIBED (§MUTATIONS at the bottom). Every mutation below re-breaks
// the REAL migration source IN MEMORY and re-runs this file's own predicate against it. Nothing is
// written to disk: a mutant that cannot be left behind cannot be committed by a concurrent session
// in this shared working directory. M5 is the reason the checks are scoped to each function's own
// BODY — it survived the first version of this barrier, because a whole-file text match was
// satisfied by the PREDICATE's mention of the coverage key after the CONTRACT had stopped
// publishing it. A surviving mutant found a real hole in the barrier before it merged.

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

// Executable SQL only. The rationale comments in these migrations quote the clause text constantly
// — matching raw file text would let a barrier be satisfied by a COMMENT describing the fix while
// the code no longer does it. That is the "a pointer reads as coverage" shape AGENTS.md records,
// so the strip is load-bearing rather than tidiness.
function executable(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
}

// SCOPE EACH CHECK TO ITS OWN FUNCTION BODY (see M5 in the header). The predicate and the contract
// ship in the same migration, so a whole-file match leaks between them.
// BLIND-GUARD REPAIR, 2026-09-24 (routine-10-barrier). This used to assume the closing tag was the
// literal `$function$`, and when it could not find one it returned `rest` — THE WHOLE REST OF THE
// FILE. A definition written with the ordinary `$$` (the style most hand-written migrations in this
// tree use) therefore un-scoped both symbols and let the predicate's text satisfy the contract's
// assertions and vice versa, which is the exact leak this function's own header says it prevents.
// The identical idiom in scripts/verify-nonprice-price-monitor.ts was REPRODUCED the same day: with
// the P0 phone/ID-price guard deleted from the winning body, that barrier printed PASS on every
// check. Now the tag is READ rather than assumed, and an unreadable body returns '' — which fails
// every assertion — instead of the file.
function bodyOf(sql: string, symbol: string): string {
  const start = sql.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${symbol}\\b`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
  if (!tag) return '';                                     // no dollar-quoted body: UNKNOWN, not OK
  const openAt = tag.index + tag[0].length;
  const closeAt = rest.indexOf(tag[0], openAt);
  if (closeAt < 0) return '';                              // unterminated: UNKNOWN, not the file
  return executable(rest.slice(0, closeAt + tag[0].length));
}

/**
 * THE RULE, as one pure function over the migration's source text.
 *
 * Returns the labels of every property that is VIOLATED — empty means the exemption is
 * evidence-backed, fail-safe and proven both ways. The real run reports these as check failures;
 * §MUTATIONS re-runs this same function against deliberately broken source and asserts it speaks
 * up. One implementation, so the mutation proof is a statement about the code that actually
 * decides, not about a copy of it.
 */
function problems(migrationSql: string): string[] {
  const out: string[] = [];
  const bad = (s: string) => out.push(s);

  const predCode = bodyOf(migrationSql, PREDICATE);
  const contractCode = bodyOf(migrationSql, CONTRACT);

  if (predCode.length === 0) bad(`${PREDICATE}() is not defined here`);
  if (contractCode.length === 0) bad(`${CONTRACT}() is not defined here`);
  if (predCode.includes(`function public.${CONTRACT}`)
      || contractCode.includes(`function public.${PREDICATE}`)) {
    bad('the two function bodies could not be isolated from each other');
  }
  if (predCode.length === 0 || contractCode.length === 0) return out;

  // --- 1. The evidence clause itself.
  if (!predCode.includes(EVIDENCE_KEY)) {
    bad(`the predicate consults ${EVIDENCE_KEY} (evidence), not only the membership proxy`);
  }
  if (!/not\s*\(\s*p_contract\s*\?\s*'lane_sweep_coverage_ratio'\s*\)/.test(predCode)) {
    bad('a missing coverage key FAILS SAFE (an unreadable contract raises)');
  }

  // --- 2. The threshold, and the constants it must not be traded against.
  const thresholdMatch = predCode.match(
    new RegExp(`${EVIDENCE_KEY}'\\s*\\)\\s*::numeric\\s*<\\s*([0-9.]+)`),
  );
  if (thresholdMatch === null || Number(thresholdMatch[1]) < MIN_COVERAGE_THRESHOLD) {
    bad('the starvation threshold is present and has not been widened toward zero');
  }
  if (!new RegExp(`\\+\\s*${FILING_OVERHEAD_S}\\s*>\\s*${SLO_SECONDS}\\b`).test(predCode)) {
    bad(`condition (1) still charges the sweep against the ${SLO_SECONDS}s SLO `
      + `with ${FILING_OVERHEAD_S}s overhead`);
  }

  // --- 3. The pre-existing exemption branches must survive. This change ADDS a reason to raise; it
  //        must never become the only one, which would drop the off-lane-detector guard of
  //        20260901104521.
  for (const [label, needle] of [
    ['an inactive lane still raises', "'lane_active'"],
    ['a lane with no runs still raises', "'lane_runs_24h'"],
  ] as const) {
    if (!predCode.includes(needle)) bad(label);
  }
  if (!/p_contract\s+is\s+null/.test(predCode)) bad('a null contract still raises');

  // The off-lane-detector guard is asserted as the actual SET COMPARISON, not as the presence of
  // the key name. Caught by mutation M10 on the day this shipped: swapping the iterated array for
  // `'[]'::jsonb` neuters the guard completely while both key names survive elsewhere in the body
  // (in the jsonb_typeof shape checks), so a token test read the defect as healthy. The guard is
  // what 20260901104521 shipped; this change adds a reason to raise and must not cost that one.
  const offLane =
    /jsonb_array_elements_text\(\s*p_contract->'p0_capable_detectors'\s*\)\s+d[\s\S]{0,120}?not\s*\(\s*p_contract->'lane_detectors'\s*\?\s*d\s*\)/;
  if (!offLane.test(predCode)) {
    bad('a P0-capable detector off the lane still raises (the real set comparison, not a mention '
      + 'of the key)');
  }

  // --- 4. Same signature — a CREATE OR REPLACE with a different argument list is a NEW OVERLOAD,
  //        which leaves the old (silent) predicate live and callable alongside it.
  if (!/p_max_sweep_s\s+numeric/.test(predCode) || !/p_contract\s+jsonb/.test(predCode)) {
    bad('the predicate keeps its (numeric, jsonb) signature — no accidental second overload');
  }

  // --- 5. The contract must publish what the predicate reads, or the predicate sits permanently in
  //        its fail-safe branch and the limb becomes a stuck-open alert — which, per mon_raise()'s
  //        dedup, is itself a disabled barrier.
  if (!contractCode.includes(`'${EVIDENCE_KEY}'`)) bad(`${CONTRACT}() publishes ${EVIDENCE_KEY}`);
  if (!contractCode.includes("'lane_runs_inside_sweeps'")
      || !contractCode.includes("'lane_runs_expected_inside_sweeps'")) {
    bad('the contract publishes both terms of the ratio, so a human can audit it');
  }
  if (!/jobname\s*=\s*'mon-detectors-and-dispatch'/.test(contractCode)) {
    bad('the sweep job is resolved by NAME, not a hardcoded jobid');
  }

  // --- 6. The apply-time EXECUTED proof inside the migration itself.
  const proof = migrationSql.match(/do \$verify\$[\s\S]*?end \$verify\$/)?.[0] ?? '';
  if (proof.length === 0 || !proof.includes(`${PREDICATE}(`)) {
    bad('the migration carries an apply-time block that EXECUTES the predicate');
  }
  if (!/if\s+public\.mon_p0_sweep_exposure_should_raise\([^)]*healthy\s*\)\s*then/.test(proof)) {
    bad('the proof asserts the EXEMPT direction (a healthy, sweep-covering lane must not raise)');
  }
  if (!/if\s+not\s+public\.mon_p0_sweep_exposure_should_raise\([^)]*starved\s*\)\s*then/.test(proof)) {
    bad('the proof asserts the RAISE direction (a starved lane defeats the exemption)');
  }
  if (!/mon_p0_sweep_exposure_should_raise\(\s*100\s*,/.test(proof)) {
    bad('the proof pins condition (1) — a fast sweep cannot breach however starved the lane is');
  }
  if (!proof.includes(`${CONTRACT}()`) || !proof.includes(EVIDENCE_KEY)) {
    bad('the proof checks the LIVE contract really carries the key');
  }

  return out;
}

// --- the real tree -------------------------------------------------------------------------------
const predFile = newestDefining(PREDICATE);
const contractFile = newestDefining(CONTRACT);
check(`a committed migration defines ${PREDICATE}()`, predFile !== null,
  'the predicate decides whether the P0 delivery forecast can fire at all; it cannot live only in '
  + 'production (migration-drift condition 1)');
check(`a committed migration defines ${CONTRACT}()`, contractFile !== null);

if (predFile === null || contractFile === null) {
  console.error('\n✗ cannot continue without both definitions\n');
  process.exit(1);
}
// Both objects ship in one migration by design (they are one contract); if that ever splits, the
// newest definition of each is what production holds, and both must satisfy the rule.
const REAL = predFile.file === contractFile.file
  ? predFile.sql
  : `${predFile.sql}\n${contractFile.sql}`;

const found = problems(REAL);
check('the exemption is evidence-backed, fail-safe and both-ways proven',
  found.length === 0,
  found.length > 0
    ? `violated:\n      - ${found.join('\n      - ')}\n      `
      + 'Fix the PATH, never this barrier: slim the sweep, or ask the OWNER for a re-slot '
      + '(cron schedule changes are owner-only).'
    : '');

// --- §MUTATIONS — executed, not described --------------------------------------------------------
// Each re-breaks the REAL source in memory and asserts this file's own rule speaks up. `false` is a
// polarity flag: these are differential proofs, and the negative control below pins that the rule
// is not simply always-complaining.
function mutation(label: string, mutate: (s: string) => string, expectCaught = true): void {
  const mutated = mutate(REAL);
  if (mutated === REAL) {
    check(`MUTATION anchor found: ${label}`, false,
      'the mutation changed nothing — the anchor moved, so this proof silently stopped proving '
      + 'anything. Update it deliberately.');
    return;
  }
  const caught = problems(mutated).length > 0;
  check(`MUTATION ${expectCaught ? 'caught' : 'ignored (negative control)'}: ${label}`,
    caught === expectCaught,
    expectCaught
      ? 'the barrier stayed GREEN against a mutant it must catch'
      : 'the barrier fired on a change that is not a defect — it is over-broad');
}

mutation('the evidence clause removed (THE ORIGINAL DEFECT restored)', (s) =>
  s.replace(/\s*or not \(p_contract \? 'lane_sweep_coverage_ratio'\)[\s\S]*?\n         \)\n/,
    '\n'));
mutation('only the missing-key fail-safe removed', (s) =>
  s.replace("      or not (p_contract ? 'lane_sweep_coverage_ratio')\n", ''));
mutation('the coverage threshold widened toward zero', (s) =>
  s.replace('::numeric < 0.5', '::numeric < 0.01'));
mutation('the 300s SLO widened', (s) => s.replace('+ 40 > 300', '+ 40 > 900'));
mutation('the 40s filing overhead widened', (s) => s.replace('+ 40 > 300', '+ 90 > 300'));
mutation('the contract stops publishing the coverage key', (s) =>
  s.replace("'lane_sweep_coverage_ratio', (select case", "'lane_sweep_coverage_DISABLED', (select case"));
mutation('a ratio term dropped, so the number cannot be audited', (s) =>
  s.replace("'lane_runs_inside_sweeps',      (select inside_n", "'lane_runs_inside_X',      (select inside_n"));
mutation('the sweep resolved by hardcoded jobid instead of name', (s) =>
  s.replace("where jobname = 'mon-detectors-and-dispatch'", 'where jobid = 38'));
mutation('the predicate re-declared with a different argument list (a NEW overload)', (s) =>
  s.replace('p_max_sweep_s numeric,', 'p_max_sweep_seconds double precision,'));
mutation('the off-lane-detector guard dropped from the exemption', (s) =>
  s.replace(/from jsonb_array_elements_text\(p_contract->'p0_capable_detectors'\) d/g,
    "from jsonb_array_elements_text('[]'::jsonb) d"));
mutation('the apply-time proof block deleted', (s) =>
  s.replace(/do \$verify\$[\s\S]*?end \$verify\$;/, ''));
mutation('the apply-time proof keeps only the RAISE direction', (s) =>
  s.replace(/  if public\.mon_p0_sweep_exposure_should_raise\(700, healthy\) then[\s\S]*?end if;\n/,
    ''));

// NEGATIVE CONTROL. A comment edit inside the migration must NOT trip the rule, or this barrier is
// just a file-hash and would fire on every unrelated touch — the failure mode that gets a real
// barrier weakened out of annoyance.
mutation('a comment reworded (must be ignored)', (s) =>
  s.replace('-- Systems Seam Engineer, 2026-09-21.',
    '-- Systems Seam Engineer, 2026-09-21. (reworded)'), false);

console.log(
  failures === 0
    ? '\n✓ p0-sweep-exposure-evidence: evidence-backed, fail-safe, and mutation-proven by execution\n'
    : `\n✗ ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
