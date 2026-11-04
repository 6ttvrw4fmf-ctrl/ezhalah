// A BUNDLED CRON STEP MUST FAIL AS LOUDLY AS THE JOB IT REPLACED, AND THE STARVATION ALARM MUST BE TRUE.
//
// 2026-11-04 (owner: «do whatever u can to fix all problems», answering "may I combine the many small
// cron monitor/dispatch jobs into fewer jobs so the schedule fits?"). cron_minute_collision had been
// open since 2026-09-18: the busiest hour started 146 jobs and at most 94 others fit beside
// mon-p0-fast-lane at <= 2 per minute. Migration 20261104043631 turned 33 small jobs into steps of four
// bundle jobs run by public.ops_run_cron_bundle(). A bundle is dangerous in three quiet ways, and this
// file pins each one at review time (production has no other per-PR check):
//
//   1. A failing step must not hide. The runner gives each step its OWN subtransaction and raises P1
//      cron_health 'cron_bundle_step_fail:<bundle>:<fn>' — without that, cron.job_run_details says
//      "succeeded" for a bundle whose detector threw. It must NOT catch query_canceled, so a statement
//      timeout still fails the whole job where cron_health / cron_timeout_headroom see it. It must
//      restore lock_timeout after every step (rebuild_age_producer sets one with set_config(..., true)).
//   2. No single-writer function may be a step: two writers in one transaction, or a writer moved
//      off its own instant, is invisible to limb 2 of the collision detector.
//   3. Every step stays a literal `select public.fn(...)` in the cron command, so
//      mon_orphaned_detectors() and the writer scan still read it.
//
// cron_starvation_risk claimed "pg_cron does not start a job while another job's backend is active".
// Measured over 7 days the only flagged victim (mon-p0-fast-lane) started 168/168 at every flagged
// minute, 168 of them during a run of mon-detectors-and-dispatch. The detector now clears a pair only on
// that evidence (scripts/lib/cronSlots.ts provenAlongsideHog mirrors the SQL); a missed start or no
// observed co-run keeps it raised. cron_grace_tight compared a grace computed since a schedule change
// with a cadence measured before it (jobid 36 false alarm); both now read the same window.
//
//   node --experimental-strip-types scripts/verify-cron-bundles-stay-honest.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STARVATION_EVIDENCE, bundleStepProblems, bundleSteps, provenAlongsideHog } from './lib/cronSlots.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

const migDir = join(ROOT, 'supabase/migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: readFileSync(join(migDir, name), 'utf8') }));
const stripComments = (s: string) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
/** Newest migration whose (comment-stripped) SQL matches `re`. */
const newest = (re: RegExp) => [...files].reverse().find((f) => re.test(stripComments(f.sql)));

const mirror = JSON.parse(readFileSync(join(ROOT, 'sql/mirrors/cron_schedule.json'), 'utf8')) as {
  jobs: Record<string, string>; single_writer_functions?: string[];
};
const writers = mirror.single_writer_functions ?? [];
check('the mirror lists the single-writer functions', writers.length >= 5 && writers.includes('sync_search_listings_ar'));

// ── 1. the runner ──────────────────────────────────────────────────────────────────────────────
const runnerMig = newest(/create or replace function public\.ops_run_cron_bundle\(/i);
check('a migration defines public.ops_run_cron_bundle', !!runnerMig);
const runnerSql = runnerMig ? stripComments(runnerMig.sql) : '';
const body = (() => {
  // Tag-generic: read whatever dollar tag opens the body and return '' when it never closes (a
  // missing body must read as a failure, never widen to the rest of the file).
  const i = runnerSql.search(/create or replace function public\.ops_run_cron_bundle\(/i);
  if (i < 0) return '';
  const open = /\bas\s+(\$([A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(runnerSql.slice(i));
  if (!open) return '';
  const start = i + open.index + open[0].length;
  const end = runnerSql.indexOf(open[1], start);
  return end > start ? runnerSql.slice(start, end) : '';
})();
export function runnerProblems(src: string): string[] {
  const p: string[] = [];
  if (!/begin\s+execute v_step;\s+exception when others then/i.test(src)) p.push('steps are not each in their own subtransaction');
  if (/query_canceled/i.test(src)) p.push('statement timeouts are swallowed (query_canceled caught)');
  if (!/set_config\('lock_timeout', v_lock, true\)/.test(src)) p.push('lock_timeout is not restored after each step');
  if (!/mon_raise\('P1', 'cron_health', null, v_key/.test(src) || !/'cron_bundle_step_fail:' \|\| p_bundle/.test(src)) p.push('a failed step raises no P1 cron_health alert');
  if (!/mon_resolve_key\('cron_health', v_key\)/.test(src)) p.push('a recovered step never resolves its alert');
  if (!/raise exception 'ops_run_cron_bundle\(%\): step % is not a single/.test(src)) p.push('malformed steps are not refused');
  return p;
}
const rp = runnerProblems(body);
check('the runner isolates, reports and resolves each step, and lets timeouts fail the job', rp.length === 0, rp.join('; '));
mustCatch('a runner without per-step isolation', runnerProblems(body.replace(/exception when others then/i, '')).length > 0);
mustCatch('a runner that swallows statement timeouts', runnerProblems(body.replace(/exception when others then/i, 'exception when query_canceled or others then')).length > 0);
mustCatch('a runner that leaks lock_timeout', runnerProblems(body.replace(/perform set_config\('lock_timeout', v_lock, true\);/, '')).length > 0);
mustCatch('a runner that logs a failure but raises nothing', runnerProblems(body.replace(/mon_raise\('P1'/, "mon_raise('P3'")).length > 0);

// ── 2 + 3. every bundle in the mirror: created by a migration, every step a non-writer fn call ──
const bundleNames = Object.keys(mirror.jobs).filter((n) => n.startsWith('bundle-'));
check('the mirror carries the bundle jobs', bundleNames.length >= 4, bundleNames.join(', '));
for (const name of bundleNames) {
  const mig = newest(new RegExp(`cron\\.schedule\\('${name}'`));
  const steps = mig ? bundleSteps(stripComments(mig.sql))[name] ?? [] : [];
  const probs = bundleStepProblems(steps, writers);
  check(`${name}: ${steps.length} step(s), each a plain non-writer "select public.fn(...)"`, !!mig && probs.length === 0,
    mig ? probs.join('; ') : 'no migration schedules it');
  const sched = mig ? new RegExp(`cron\\.schedule\\('${name}',\\s*'([^']+)'`).exec(mig.sql)?.[1] : undefined;
  check(`${name}: the mirror's schedule is the one its migration set`, sched === mirror.jobs[name], `${sched} vs ${mirror.jobs[name]}`);
}
const sample = ["select public.mon_detect_alert_flapping()", "select public.trigger_gh_workflow('af-robot.yml')"];
mustCatch('a single-writer function slipped into a bundle', bundleStepProblems([...sample, 'select public.sync_payment_monthly()'], writers).length > 0);
mustCatch('a step that is two statements', bundleStepProblems(['select public.a(); delete from x'], writers).length > 0);
mustCatch('a step without the public. prefix (invisible to the orphan scan)', bundleStepProblems(['select mon_detect_x()'], writers).length > 0);
mustCatch('an empty bundle', bundleStepProblems([], writers).length > 0);
check('a clean bundle passes', bundleStepProblems(sample, writers).length === 0);
const parsed = bundleSteps("select cron.schedule('bundle-x', '1 * * * *', $cmd$select public.ops_run_cron_bundle('bundle-x',\n  $s$select public.a()$s$,\n  $s$select public.b(1)$s$);$cmd$);");
check('bundleSteps parses a bundle command', JSON.stringify(parsed) === JSON.stringify({ 'bundle-x': ['select public.a()', 'select public.b(1)'] }), JSON.stringify(parsed));

// ── starvation evidence: SQL and the TS mirror agree, and the rule is mutation-proven ───────────
const evMig = newest(/create or replace function public\.mon_cron_victim_proven_alongside_hog\(/i);
const evSql = evMig ? stripComments(evMig.sql) : '';
check('the evidence function requires >= 3 co-runs and at most 1 missed start',
  /select co_run >= 3 and on_time >= expected - 1 from stats/.test(evSql)
  && STARVATION_EVIDENCE.minCoRuns === 3 && STARVATION_EVIDENCE.missedStartsAllowed === 1);
check('an on-time start is < 60 s late, in SQL and in the mirror',
  /date_trunc\('minute', d\.start_time\) < interval '60 seconds'/.test(evSql) && STARVATION_EVIDENCE.onTimeLagS === 60);
check('the evidence window starts at the later of both jobs\' schedule changes',
  /f\.jobid = p_victim\), now\(\) - interval '7 days'\)/.test(evSql) && /f\.jobid = p_hog\),\s+now\(\) - interval '7 days'\)/.test(evSql));
const detMig = newest(/create or replace function public\.mon_detect_cron_starvation_risk\(/i);
const detSql = detMig ? stripComments(detMig.sql) : '';
check('the starvation detector raises only pairs WITHOUT that evidence',
  /count\(\*\) filter \(where not e\.proven\)/.test(detSql));
// 20261104044638: the detector reads every pair's evidence from ONE scan of the involved jobs' runs
// (the per-pair version took 57 s). The batch function must carry the same rule as the single one.
// The newest DEFINITION or body patch (20261104044638 is an execute-replace patch), not the newest mention: a bundle migration that re-states its steps lists
// `select public.mon_detect_cron_starvation_risk()` as a step and used to be read as the detector's body
// (🔧 2026-11-04: 20261104220450 only adds a dispatch step to bundle-hourly-monitors).
const swapMig = newest(/create or replace function public\.mon_detect_cron_starvation_risk\(|pg_get_functiondef\('public\.mon_detect_cron_starvation_risk'/i);
check('the detector\'s newest definition takes its evidence from the batch function',
  !!swapMig && /select s\.\* from public\.mon_cron_starved_schedules_with_evidence\(\) s/.test(swapMig.sql));
const batchMig = newest(/create or replace function public\.mon_cron_starved_schedules_with_evidence\(/i);
const batchSql = batchMig ? stripComments(batchMig.sql) : '';
check('the batch evidence function applies the same rule (>= 3 co-runs, <= 1 missed, < 60 s late, both schedule changes)',
  /\(co_run >= 3 and on_time >= expected - 1\) as proven/.test(batchSql)
  && (batchSql.match(/< interval '60 seconds'/g) ?? []).length === 2
  && /fv\.schedule_changed_at/.test(batchSql) && /fh\.schedule_changed_at/.test(batchSql)
  && /runs as materialized/.test(batchSql));
const keyMig = newest(/cron_bundle_step_fail/);
check('a bundle step\'s alert key carries its step number (five trigger_gh_workflow steps share a name)',
  !!keyMig && /'cron_bundle_step_fail:' \|\| p_bundle \|\| ':' \|\| i \|\| ':' \|\| v_fn/.test(keyMig.sql));

const H = 3_600_000;
const now = Date.UTC(2026, 10, 4, 12, 0, 30);
const since = now - 24 * H;
const startsAt = (m: number, lagMs = 50) => Array.from({ length: 24 }, (_, i) => since + i * H + m * 60_000 + lagMs + 30_000)
  .map((t) => t - 30_000).filter((t) => t <= now);
const hogAll: Array<[number, number]> = Array.from({ length: 25 }, (_, i) => [since + i * H - 120_000, since + i * H + 600_000]);
check('full attendance during the hog = proven', provenAlongsideHog(startsAt(1), hogAll, 1, since, now));
mustCatch('missed starts (a starved victim)', !provenAlongsideHog(startsAt(1).filter((_, i) => i % 3 !== 0), hogAll, 1, since, now));
mustCatch('no observed co-run (a hog that was never running then)', !provenAlongsideHog(startsAt(30), hogAll, 30, since, now));
mustCatch('starts that were over a minute late', !provenAlongsideHog(startsAt(1, 61_000), hogAll, 1, since, now));
mustCatch('only two co-runs', !provenAlongsideHog(startsAt(1), hogAll.slice(0, 2), 1, since, now));

// ── cron_grace_tight reads the post-change window on both sides ─────────────────────────────────
const graceMig = newest(/mon_detect_cron_grace_below_cadence/);
check('cron_grace_tight measures recent cadence only since the schedule change',
  !!graceMig && /coalesce\(f\.schedule_changed_at, ''-infinity''::timestamptz\)/.test(graceMig.sql)
  && /left join public\.ops_cron_job_first_seen f on f\.jobid = d\.jobid/.test(graceMig.sql));

if (failures > 0) {
  console.error(`\n✗ cron-bundles-stay-honest: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ cron-bundles-stay-honest\n');
