// USER-FACING SEARCH LATENCY IS WATCHED CONTINUOUSLY, AND THE WATCHER CAN ATTRIBUTE.
// Offline contract barrier (§33, §19/§26 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md).
//
// WHAT THIS EXISTS FOR (2026-09-04). "Is monitoring starving Search?" was asked as a P1-shaped
// question and NOTHING in the system could answer it. Establishing the answer took a live
// investigation, and the first two answers were both wrong:
//
//   1. "Two detector sweeps are running concurrently." They were not. The query that produced that
//      reading matched `mon_dispatch_p0_fast`, which appears in the command of BOTH job 38
//      (mon-detectors-and-dispatch, :29/:59) and job 86 (mon-p0-fast-lane, every ~2-3 min). Two
//      different jobs, one function name. Job 38 cannot overlap itself: 166-207 s typical against a
//      1800 s interval, under a 900 s statement_timeout.
//   2. "The wider 31→36 table scope made search slow." It did not. Measured server-side and warm,
//      OLD 31 tables ran 135-142 ms and NEW 36 tables 136-194 ms — both inside the 255 ms baseline.
//      The elevated numbers came from timing HTTP through this container's MITM egress proxy and
//      comparing it against a SERVER-SIDE baseline. Apples to oranges.
//
// The real cause, once measured properly: 3.22 searches/second of concurrent QA/harness traffic
// from the parallel engineering routines, against a §40.1 safe envelope of 1.5/s, with cron busy
// for ZERO seconds of the sample window. Self-inflicted load, not monitoring, and not the query.
//
// So the gap was never a missing lock. It was that `mon_detect_search_performance_regression` is
// gated to ~once per 20 h and therefore structurally cannot see a degradation that comes and goes
// within the hour — it sampled 07:29 that day, recorded 0, and certified healthy while real traffic
// averaged ~2 s. This barrier pins the replacement: a continuous, zero-added-load sampler over
// pg_stat_statements, and a detector that says WHICH of the three causes it is.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const MIG = join(root, 'supabase/migrations');
const sqlOf = (needle: string) => {
  const f = readdirSync(MIG).filter((x) => x.endsWith('.sql'))
    .filter((x) => readFileSync(join(MIG, x), 'utf8').includes(needle)).sort().pop();
  return f ? readFileSync(join(MIG, f), 'utf8') : '';
};
// Read by NAME, newest wins, so a later hardening pass need not edit this barrier to stay green.
const sampler = sqlOf('create or replace function public.mon_sample_search_latency');
const detector = sqlOf('create or replace function public.mon_detect_search_latency_degraded');

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) { failures++; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`);
};

console.log('search latency barrier — contract');

// ── 1. THE SAMPLER MEASURES REAL TRAFFIC AND ADDS NO LOAD ────────────────────────────────────────
// A synthetic prober would add load to the exact path it is protecting, on a 2-vCPU instance where
// the measured problem IS load. It must read statistics, never issue searches.
check('samples pg_stat_statements, not synthetic searches',
  /pg_stat_statements/.test(sampler) && !/location_search_candidates_ar\s*\(/.test(sampler));
check('schema-qualifies pg_stat_statements (it lives in `extensions`, not `public`)',
  /extensions\.pg_stat_statements/.test(sampler));
check('keeps the SECURITY DEFINER search_path pinned to public rather than widening it',
  /security definer set search_path to 'public'/.test(sampler) && !/search_path to 'public, ?extensions'/.test(sampler));
check('a missing extension degrades to no-sample instead of aborting the sweep transaction',
  /exception when undefined_table or insufficient_privilege then/.test(sampler));
check('discards a counter reset rather than reporting a miraculous speedup',
  /v_calls >= v_prev\.calls_total and v_ms >= v_prev\.exec_ms_total/.test(sampler));
check('records concurrent cron seconds, clipped to the sample interval',
  /least\(coalesce\(d\.end_time, now\(\)\), now\(\)\)/.test(sampler)
  && /greatest\(d\.start_time, v_prev\.sampled_at\)/.test(sampler));

// ── 2. THE DETECTOR HAS BOTH LIMBS AND CANNOT BASELINE AWAY A REGRESSION ─────────────────────────
check('absolute limb (a bad mean is bad on its own)', /c_abs_ms\s+constant numeric\s*:=/.test(detector));
check('relative limb (a regression below the absolute ceiling still fires)',
  /c_rel_factor\s+constant numeric\s*:=/.test(detector));
check('the trailing baseline EXCLUDES the recent window, so a sustained regression cannot become its own baseline',
  /between now\(\) - interval '7 days' and now\(\) - interval '1 hour'/.test(detector));
check('refuses to judge a window nobody searched in', /c_min_calls/.test(detector));
check('stands down when healthy (a detector that only accumulates is the 2026-08-10 failure)',
  /mon_resolve_key\('search_latency_degraded', 'search_latency_degraded'\)/.test(detector));

// ── 3. IT ATTRIBUTES — THE WHOLE POINT ───────────────────────────────────────────────────────────
// Without attribution this is just another "search is slow" alarm, and the next investigation
// repeats the two wrong answers above by hand.
check('distinguishes SELF-INFLICTED QA load via searches/second against the §40.1 envelope',
  /c_safe_qps/.test(detector) && /SELF-INFLICTED QA\/HARNESS LOAD/.test(detector));
check('distinguishes monitoring/cron load via busy-seconds per second',
  /cron_busy_seconds_per_second/.test(detector));
check('names the residual case (plan/index/organic) instead of implying one of the first two',
  /neither QA load nor cron explains it/.test(detector));
check('forbids the correctness-destroying "fixes" (§33: correctness outranks latency)',
  /NEVER fix this by narrowing the search predicate/.test(detector));

// ── 4. IT IS REACHABLE AND SCHEDULED ─────────────────────────────────────────────────────────────
check('rostered in mon_run_all_detectors in the SAME migration',
  /mon_detect_search_latency_degraded/.test(detector) && /mon_run_all_detectors/.test(detector));
check('the roster edit is a guarded needle-edit, never a hand-pasted rebuild',
  /roster anchor missing — refusing to guess at the array shape/.test(detector));
check('the sampler is scheduled on its own cadence, off the :00/:15/:20 slots and off :29/:59',
  /cron\.schedule\('mon-search-latency-sample'/.test(detector)
  && /'2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*'/.test(detector));
check('this barrier is discovered by npm test', npmTestRuns(root, 'verify-search-latency-barrier'));

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
const mutations: [string, string, string, () => boolean][] = [
  ['sampler starts issuing real searches instead of reading statistics',
    'extensions.pg_stat_statements', 'location_search_candidates_ar(',
    () => /extensions\.pg_stat_statements/.test(mut)],
  ['search_path widened instead of schema-qualifying',
    "security definer set search_path to 'public'", "security definer set search_path to 'public, extensions'",
    () => /security definer set search_path to 'public'/.test(mut) && !/search_path to 'public, ?extensions'/.test(mut)],
  ['counter-reset guard removed',
    'v_calls >= v_prev.calls_total and v_ms >= v_prev.exec_ms_total', 'true',
    () => /v_calls >= v_prev\.calls_total and v_ms >= v_prev\.exec_ms_total/.test(mut)],
  ['missing-extension guard removed (would abort the whole detector sweep)',
    'exception when undefined_table or insufficient_privilege then', 'exception when division_by_zero then',
    () => /exception when undefined_table or insufficient_privilege then/.test(mut)],
];
let mut = '';
console.log('  mutation proof — sampler:');
for (const [label, from, to, stillHolds] of mutations) {
  if (!sampler.includes(from)) { failures++; console.error(`  ✗ mutation anchor missing: ${label}`); continue; }
  mut = sampler.replaceAll(from, to);
  check(`    caught: ${label}`, !stillHolds());
}

const detMutations: [string, string, string, () => boolean][] = [
  ['baseline stops excluding the recent window (regression becomes its own baseline)',
    "between now() - interval '7 days' and now() - interval '1 hour'", "> now() - interval '7 days'",
    () => /between now\(\) - interval '7 days' and now\(\) - interval '1 hour'/.test(mut)],
  ['QA-load attribution dropped — the 2026-09-04 cause becomes invisible again',
    'SELF-INFLICTED QA/HARNESS LOAD', 'load',
    () => /SELF-INFLICTED QA\/HARNESS LOAD/.test(mut)],
  ['stand-down removed — the alarm can only ever accumulate',
    "mon_resolve_key('search_latency_degraded', 'search_latency_degraded')", 'null',
    () => /mon_resolve_key\('search_latency_degraded', 'search_latency_degraded'\)/.test(mut)],
  ['sampler schedule dropped — the detector reads a table nothing fills',
    "cron.schedule('mon-search-latency-sample'", 'select (',
    () => /cron\.schedule\('mon-search-latency-sample'/.test(mut)],
];
console.log('  mutation proof — detector:');
for (const [label, from, to, stillHolds] of detMutations) {
  if (!detector.includes(from)) { failures++; console.error(`  ✗ mutation anchor missing: ${label}`); continue; }
  mut = detector.replaceAll(from, to);
  check(`    caught: ${label}`, !stillHolds());
}

if (failures) {
  console.error(`\n✗ search latency barrier: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ search latency barrier contract intact');
