// The monitoring sweep must never again fail silently, and its command must never be rewritten blind.
//
// THE INCIDENT (2026-08-22, senior run #35). pg_cron job `mon-detectors-and-dispatch` (jobid 38) —
// the job that runs EVERY barrier twice an hour — failed 6 times over 2026-08-20..22 with
// `canceling statement due to statement timeout`, and nothing alerted. Two independent reasons:
//
//   1. THE SWEEP GREW INTO ITS CEILING. Average successful runtime went 23s (08-12) → 180s (08-22),
//      max 274s, against a hard `set statement_timeout to '300s'` in the job's own command. pg_cron
//      runs that command in ONE transaction, so a timeout does not lose one detector: it rolls back
//      every alert the sweep already raised and skips mon_dispatch_alerts() entirely. Each failure
//      was a half-hour of total blindness leaving no trace outside cron.job_run_details.
//
//   2. NOTHING COULD SEE IT. mon_detect_cron_health() read the most recent run row per job — which,
//      for the job it is running INSIDE, is that job's own in-flight row (status 'running'). Not
//      'failed', so jobid 38 fell to the else branch, which RESOLVED its own alert. It had raised
//      cron_fail for jobids 22/34/50/63 and never once for 38. mon_watchdog_detector_job() is scoped
//      to "no success in 70 minutes" and so — correctly, by its own contract — stayed silent through
//      an intermittent failure that always succeeded again within the window.
//
// This guard is OFFLINE (tracked repo files only), like the other verifiers in `npm test`. The LIVE
// halves are mon_detect_cron_health() (raises cron_fail / cron_flapping) and
// mon_detect_detector_sweep_budget() (raises while the sweep still has headroom, not after it is
// blind). What was missing was anything that stops the two fixes being quietly undone.
//
// Run: node --experimental-strip-types scripts/verify-monitoring-sweep-is-guarded.ts
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const CRON_HEALTH_FIX = '20260822061419_cron_health_cannot_see_the_job_it_runs_inside.sql';
const SWEEP_BUDGET_FIX = '20260822061643_detector_sweep_runtime_budget_barrier_and_headroom.sql';
const SWEEP_JOB = 'mon-detectors-and-dispatch';

// Migrations that already write the sweep's command as a hand-written literal. Grandfathered by
// exact filename — a record of what predates the rule, never a template. A NEW entry here is the
// very thing this guard exists to prevent.
const GRANDFATHERED = new Set([
  // 2026-08-10: wired mon_reconcile_dangling_scrape_runs() in and set the 300s ceiling, by pasting
  // the whole four-statement command. It happened to keep every statement — but nothing checked,
  // and that same pasted ceiling is what the sweep grew into twelve days later.
  '20260810130112_mon_reconcile_dangling_scrape_runs_proactive.sql',
]);

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check(files.length > 100, `scanned ${files.length} migrations`,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

const read = (f: string) => (files.includes(f) ? readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8') : '');

// 1. Any migration that rewrites the sweep's command must DERIVE it from the live command instead of
//    hand-writing one. That command holds the entire monitoring pipeline — reconcile, the 88-detector
//    roster, and dispatch — so a pasted replacement silently drops whatever the author's copy
//    predates, exactly like the roster class this repo has been bitten by seven times.
const rewriters = files.filter((f) => {
  if (GRANDFATHERED.has(f) || f === SWEEP_BUDGET_FIX) return false;
  const sql = readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8');
  if (!sql.includes(SWEEP_JOB)) return false;
  if (!/alter_job|cron\.schedule/i.test(sql)) return false;
  if (!/command\s*(?:=>|:=)/i.test(sql)) return false;
  const derived = /\breplace\s*\(/i.test(sql) && /from\s+cron\.job\b/i.test(sql);
  return !derived;
});
check(rewriters.length === 0,
  `no migration hand-writes the ${SWEEP_JOB} command`,
  `these migrations replace the monitoring sweep's command with a hand-written literal, which ` +
  `silently drops any statement the author's copy predates — derive it from cron.job.command with ` +
  `replace() instead: ${rewriters.join(', ')}`);

// 2. The grandfather list is a record, not a loophole: it may only name files that exist.
const stale = [...GRANDFATHERED].filter((f) => !files.includes(f));
check(stale.length === 0,
  `grandfather list matches the tree (${GRANDFATHERED.size} historical literal rewrite)`,
  `grandfathered files no longer exist — the list has drifted from the tree: ${stale.join(', ')}`);

// 3. cron_health must keep the fix that let it see a failure at all.
const health = read(CRON_HEALTH_FIX);
check(health.length > 0, `${CRON_HEALTH_FIX} is present`,
  `${CRON_HEALTH_FIX} is missing — the cron_health blind spot has been reverted out of the tree`);
check(/status in \('succeeded','failed'\)/.test(health),
  'cron_health reads the last COMPLETED run, so an in-flight row cannot mask a failure',
  `${CRON_HEALTH_FIX} no longer excludes 'running' rows — jobid 38 goes back to being structurally ` +
  `unable to report its own failure`);
check(health.includes('cron_flapping'),
  'cron_health still detects intermittent failure (>= 2 failed runs in 24h)',
  `${CRON_HEALTH_FIX} dropped the flapping condition — a job that fails a few runs a day and ` +
  `succeeds in between looks green at every point-in-time check, which is how 6 blind sweeps hid`);
check(/mon_resolve_key\s*\(\s*'cron_health'/.test(health),
  'cron_health clears its own kind via mon_resolve_key',
  `${CRON_HEALTH_FIX} resolves cron_health by hand-rolled UPDATE — mon_detect_unresolvable_alert_` +
  `kinds() requires a literal mon_resolve_key('cron_health' call, so every alert it raises would be ` +
  `reported as an unclearable ratchet`);

// 4. The budget barrier must keep watching the distance to the ceiling, and must read that ceiling
//    from the job itself — a hardcoded number is a second place for the truth to drift.
const budget = read(SWEEP_BUDGET_FIX);
check(budget.length > 0, `${SWEEP_BUDGET_FIX} is present`,
  `${SWEEP_BUDGET_FIX} is missing — nothing warns before the sweep runs out of budget again`);
check(budget.includes('mon_detect_detector_sweep_budget'),
  'the sweep budget detector is defined',
  `${SWEEP_BUDGET_FIX} no longer defines mon_detect_detector_sweep_budget`);
check(/substring\(v_cmd from 'statement_timeout/.test(budget),
  'the budget is read out of the sweep job\'s own command, not hardcoded',
  `${SWEEP_BUDGET_FIX} stopped reading statement_timeout from cron.job.command — the barrier and ` +
  `the ceiling it guards can now drift apart`);
check(budget.includes('pg_get_functiondef') && /\breplace\s*\(/.test(budget),
  'the detector is rostered by a guarded needle-edit of the live roster body',
  `${SWEEP_BUDGET_FIX} no longer splices into the live mon_run_all_detectors body — a pasted roster ` +
  `drops every detector its copy predates`);
check(/0\.6 \* 300/.test(budget),
  'the migration carries a mutation proof against the ceiling that actually failed (300s)',
  `${SWEEP_BUDGET_FIX} dropped its mutation proof — the threshold arithmetic ships unproven, and a ` +
  `barrier that has never been shown to fire is decoration`);

// 5. This guard is worthless if nothing runs it.
const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-monitoring-sweep-is-guarded'),
  'npm test runs this guard',
  'package.json no longer runs verify-monitoring-sweep-is-guarded.ts — the guard is inert');

console.log('monitoring-sweep-is-guarded: the sweep must fail loudly, and its command must not be pasted\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the monitoring sweep can go blind unreported.`);
  process.exit(1);
}
console.log('\n✅ monitoring-sweep-is-guarded: passed.');
