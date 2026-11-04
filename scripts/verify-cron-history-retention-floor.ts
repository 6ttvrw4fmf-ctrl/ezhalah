// CRON RUN HISTORY KEEPS 30 DAYS — NEVER LESS, AND NO READER LOOKS FURTHER BACK (owner decision 3, 2026-11-04).
//
// cron.job_run_details had grown to 260,081 rows / 72 MB (oldest 2026-06-11) with only a runid primary
// key. The owner approved a daily job deleting rows older than 30 days, on the measured fact that no
// detector reads more than 7 days of it. Two things can make that purge wrong later, and both are
// pinned here:
//
//   1. someone shortens the retention (a smaller p_keep_days in the schedule, a lower floor constant,
//      or a function that stops refusing) — the detectors that judge a 7-day window would then read a
//      truncated history as "this job did not run";
//   2. someone writes a NEW reader of job_run_details with a window longer than 30 days — it would
//      silently see a history that was deleted under it.
//
// Limb 2 scans every committed migration's SQL for a function/view body that reads job_run_details and
// converts each interval literal in it to days. A body that ALSO reads another table can carry an
// interval meant for that table, so those are listed in NOT_A_JOB_RUN_DETAILS_WINDOW with the reason,
// each measured on 2026-11-04 by reading the live function.
//
//   node --experimental-strip-types scripts/verify-cron-history-retention-floor.ts   (in `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase/migrations');
export const RETENTION_FLOOR_DAYS = 30;

// function name -> interval literals in its body that do NOT bound a job_run_details read
const NOT_A_JOB_RUN_DETAILS_WINDOW: Record<string, string[]> = {
  mon_detect_loc_rel_capacity_risk: ['1000 hours'], // coalesce default on loc_rel_refresh_state.last_run_at
  mon_detect_liveness_job_silent: ['45 days'],      // scrape_runs cadence window
  ops_run_cron_bundle: ['14 days'],                 // prunes ops_cron_bundle_step_run
  search_index_freshness: ['999 hours'],            // coalesce default when jobid 28 never succeeded (20260716)
};

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught, 'MUTANT SURVIVED');

/** '7 days' -> 7, '36 hours' -> 1.5, '2 weeks' -> 14, '1 mon' -> 30; unknown units -> null. */
export function intervalDays(lit: string): number | null {
  const m = lit.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week|mon|month|year)s?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const per: Record<string, number> = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, mon: 30, month: 30, year: 365 };
  return n * per[m[2]];
}

/** Function/view bodies in a SQL text that read cron.job_run_details, with their interval literals. */
export function readersIn(sql: string): Array<{ name: string; intervals: string[] }> {
  const out: Array<{ name: string; intervals: string[] }> = [];
  const re = /create\s+(?:or\s+replace\s+)?(?:function|view|materialized\s+view)\s+(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?)(?=\ncreate\s+(?:or\s+replace\s+)?(?:function|view|materialized\s+view)\s|$)/gi;
  for (const m of sql.matchAll(re)) {
    const body = m[2];
    if (!/job_run_details/.test(body)) continue;
    const intervals = [...body.matchAll(/interval\s*'([^']+)'/gi)].map((x) => x[1]);
    out.push({ name: m[1], intervals });
  }
  return out;
}

export function tooLongReaders(sql: string, floor = RETENTION_FLOOR_DAYS,
  exempt: Record<string, string[]> = NOT_A_JOB_RUN_DETAILS_WINDOW): string[] {
  const bad: string[] = [];
  for (const r of readersIn(sql)) {
    for (const iv of r.intervals) {
      if ((exempt[r.name] ?? []).includes(iv)) continue;
      const d = intervalDays(iv);
      if (d !== null && d > floor) bad.push(`${r.name}: interval '${iv}' (${d.toFixed(1)} days) > ${floor}`);
    }
  }
  return bad;
}

/** The purge function's own guards, read from its committed SQL. */
export function purgeProblems(sql: string, floor = RETENTION_FLOOR_DAYS): string[] {
  const p: string[] = [];
  const f = sql.match(/floor_days\s+constant\s+int\s*:=\s*(\d+)/i);
  if (!f) p.push('no floor_days constant in ops_purge_cron_run_history');
  else if (Number(f[1]) < floor) p.push(`floor_days is ${f[1]} (< ${floor})`);
  if (!/if\s+p_keep_days\s+is\s+null\s+or\s+p_keep_days\s*<\s*floor_days\s+then\s+raise\s+exception/i.test(sql))
    p.push('the function does not RAISE when asked to keep fewer than floor_days');
  const sched = sql.match(/cron\.schedule\('purge-cron-run-history',\s*'([^']+)',[\s\S]*?ops_purge_cron_run_history\((\d+)?/i);
  if (!sched) p.push('purge-cron-run-history is not scheduled');
  else {
    if (sched[1].trim().split(/\s+/).slice(2).join(' ') !== '* * *') p.push(`schedule '${sched[1]}' is not daily`);
    if (sched[2] !== undefined && Number(sched[2]) < floor) p.push(`the schedule asks to keep ${sched[2]} days`);
  }
  return p;
}

console.log('\nCron run history: 30-day retention floor (owner decision 3, 2026-11-04)\n');

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const purgeFiles = files.filter((f) => /ops_purge_cron_run_history/.test(readFileSync(join(MIG, f), 'utf8')));
check('a committed migration defines and schedules ops_purge_cron_run_history', purgeFiles.length >= 1);
const newestPurge = purgeFiles.length ? readFileSync(join(MIG, purgeFiles[purgeFiles.length - 1]), 'utf8') : '';
const pp = purgeProblems(newestPurge);
check(`the newest purge migration keeps >= ${RETENTION_FLOOR_DAYS} days, refuses less, runs daily`, pp.length === 0, pp.join('; '));

// Limb 2 over the whole tree, newest definition per name.
const newestBody = new Map<string, string>();
for (const f of files) {
  const sql = readFileSync(join(MIG, f), 'utf8');
  if (!/job_run_details/.test(sql)) continue;
  for (const r of readersIn(sql)) newestBody.set(r.name, `-- ${f}\ncreate function public.${r.name} ${r.intervals.map((i) => `interval '${i}'`).join(' ')} job_run_details\n`);
}
const bad = [...newestBody.values()].flatMap((s) => tooLongReaders(s));
check(`no committed reader of job_run_details looks back more than ${RETENTION_FLOOR_DAYS} days`, bad.length === 0, bad.join('\n      '));
console.log(`      scanned ${newestBody.size} reader(s) of job_run_details`);

// ── mutation proofs ────────────────────────────────────────────────────────────────────────────
const good = `floor_days constant int := 30;
  if p_keep_days is null or p_keep_days < floor_days then
    raise exception 'x';
select cron.schedule('purge-cron-run-history', '27 1 * * *', $cmd$select public.ops_purge_cron_run_history(30)$cmd$);`;
check('the reference purge text passes', purgeProblems(good).length === 0, purgeProblems(good).join('; '));
mustCatch('a floor lowered to 7 days', purgeProblems(good.replace(':= 30', ':= 7')).length > 0);
mustCatch('a function that no longer refuses a short retention',
  purgeProblems(good.replace('p_keep_days < floor_days then', 'p_keep_days < 0 then')).length > 0);
mustCatch('a schedule that keeps 3 days', purgeProblems(good.replace('history(30)', 'history(3)')).length > 0);
mustCatch('a purge that is no longer scheduled', purgeProblems(good.replace(/select cron\.schedule[\s\S]*$/, '')).length > 0);
mustCatch('a schedule that is not daily (weekly)', purgeProblems(good.replace("'27 1 * * *'", "'27 1 * * 0'")).length > 0);
mustCatch('a new reader of job_run_details with a 60-day window',
  tooLongReaders("create or replace function public.mon_x() returns int as $$ select count(*) from cron.job_run_details where start_time > now() - interval '60 days' $$;").length > 0);
mustCatch('a 45-day window on job_run_details in a function NOT on the exempt list',
  tooLongReaders("create function public.mon_y() as $$ cron.job_run_details interval '45 days' $$").length > 0);
check('(control) a 7-day reader passes',
  tooLongReaders("create function public.mon_z() as $$ cron.job_run_details interval '7 days' $$").length === 0);
check('(control) intervalDays parses hours and weeks', intervalDays('36 hours') === 1.5 && intervalDays('2 weeks') === 14);

console.log('');
console.log(failed === 0 ? 'PASS — cron history keeps 30 days and nothing reads further back.' : `FAIL — ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
