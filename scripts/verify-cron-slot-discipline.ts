// THE CRON HOUR IS REBALANCED, AND A MIGRATION CANNOT UN-BALANCE IT WITHOUT A RED PR.
//
// Owner decision 6 (2026-11-03, «Yes, use your picks»): each minute carries as few jobs as the hour
// allows, :00 is left to the matview refresh, and the jobs cron_starvation_risk names leave the hog
// windows (:59-:10 after mon-detectors-and-dispatch, :16-:21 after refresh_listing_native_location_v1,
// :22-:37 after sync-search-listings-ar). Migration 20261104000454 applied it.
//
// Production is watched by mon_detect_cron_minute_collision() and mon_detect_cron_starvation_risk(),
// twice an hour — but only AFTER a migration is live. This file runs the same predicates
// (scripts/lib/cronSlots.ts) over the committed mirror sql/mirrors/cron_schedule.json at review time:
//
//   1. nothing starts on minute 0;
//   2. no hourly job starts inside another job's p95 window, except mon-p0-fast-lane, whose 24 slots
//      with a 3-minute worst gap ARE the owner-set 5-minute P0 SLO (verify-p0-delivery-sla.ts);
//   3. no (hour, minute) starts more than MAX_PER_INSTANT jobs — a ratchet that may only go DOWN;
//   4. no two single-writer jobs share an (hour, minute) (limb 2 of the collision detector);
//   5. the mirror is current: the newest migration that changes a cron schedule is the one the
//      mirror says it was re-read after (apply-and-mirror is ONE change), and it agrees with
//      sql/mirrors/cron_ordering_contract.json on every job both files name.
//
// RESIDUAL, stated: a schedule changed by hand (no migration) is invisible here — the live detectors
// catch it within 30 minutes, as before. Hog p95s are the values measured when the mirror was
// written; a hog that grows is the live detector's to report.
//
//   node --experimental-strip-types scripts/verify-cron-slot-discipline.ts   (in `npm test`)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CronJobs, maxPerInstant, minuteZeroStarts, newestScheduleMigration, starvedPairs, starvedWriters, writerCollisions,
} from './lib/cronSlots.ts';

const ROOT = join(import.meta.dirname, '..');
const MIRROR = 'sql/mirrors/cron_schedule.json';
const ORDERING = 'sql/mirrors/cron_ordering_contract.json';

// Shrink-only. 8 before the rebalance (2026-11-03); 4 after; 2 after the consolidation of 2026-11-04
// (20261104043631: 33 small jobs became steps of 4 bundle jobs, busiest hour 146 -> 99 starts). 2 is the
// live detector's own bar: mon_detect_cron_minute_collision() raises at 3 per (hour, minute), so a
// ratchet above 2 let a PR pass that production then flagged within 30 minutes.
const MAX_PER_INSTANT = 2;
// The only job allowed inside a hog window, and why.
const STARVATION_EXEMPT: Record<string, string> = {
  'mon-p0-fast-lane': '24 minutes, worst gap 3 — the owner-set 5-minute P0 delivery SLO; no such list can avoid a 34-minute band',
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught, 'the predicate did NOT report this defect');

console.log('\nThe cron hour stays rebalanced (owner decision 6, 2026-11-03)\n');

if (!existsSync(join(ROOT, MIRROR))) {
  console.error(`FAIL  ${MIRROR} is missing — deleting the mirror must not disarm this check`);
  process.exit(1);
}
const mirror = JSON.parse(readFileSync(join(ROOT, MIRROR), 'utf8')) as {
  jobs?: CronJobs; hog_p95_s?: Record<string, number>; single_writer_jobs?: string[];
  max_per_instant?: number; _mirrored_through_migration?: string;
};
const jobs = mirror.jobs ?? {};
const hogs = mirror.hog_p95_s ?? {};
const writers = mirror.single_writer_jobs ?? [];

check('the mirror lists the active jobs (non-empty, every value a 5-field schedule)',
  Object.keys(jobs).length >= 50 && Object.values(jobs).every((s) => s.trim().split(/\s+/).length === 5),
  'an empty or malformed mirror would certify nothing as balanced');
check('the mirror names at least one hog and one single-writer job',
  Object.keys(hogs).length > 0 && writers.length > 0,
  'with no hogs the starvation rule is vacuous; with no writers the lock rule is');
check(`the mirror's max_per_instant (${mirror.max_per_instant}) is the ratchet value ${MAX_PER_INSTANT}`,
  mirror.max_per_instant === MAX_PER_INSTANT,
  'lower both together when the hour gets lighter; never raise either to go green');

// 1. minute 0
const zero = minuteZeroStarts(jobs);
check('nothing starts on minute 0', zero.length === 0, zero.slice(0, 10).join('; '));

// 2. starvation
const starved = starvedPairs(jobs, hogs).filter((p) => !(p.split(':')[0] in STARVATION_EXEMPT));
check('no hourly job starts inside another job\'s p95 window (mon-p0-fast-lane excepted)',
  starved.length === 0, starved.join('; '));

// 3. stacking
const { max, where } = maxPerInstant(jobs);
check(`no (hour, minute) starts more than ${MAX_PER_INSTANT} jobs (worst is ${max})`,
  max <= MAX_PER_INSTANT, where.slice(0, 5).join('; '));

// 4. single-writer lock
const wc = writerCollisions(jobs, writers);
check('no two single-writer jobs start in the same (hour, minute)', wc.length === 0, wc.join('; '));

// 5a. currency against the migration tree
const sw = starvedWriters(jobs, writers, hogs);
check('no single-writer job starts ONLY inside another writer\'s p95 window (every pass refused, reported succeeded)',
  sw.length === 0, `${sw.join('; ')} — move it to a minute outside the writer windows (alert 12926: jobid 68 at :30 inside sync-search-listings-ar :22 + 890 s)`);

const migDir = join(ROOT, 'supabase/migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(join(migDir, name), 'utf8') }));
const newest = newestScheduleMigration(files);
check(`the mirror is current through the newest schedule-changing migration (${newest})`,
  newest !== null && mirror._mirrored_through_migration === newest,
  `mirror says ${mirror._mirrored_through_migration}; re-read cron.job and update ${MIRROR} in the same PR`);

// 5b. agreement with the ordering-contract mirror
const ordering = JSON.parse(readFileSync(join(ROOT, ORDERING), 'utf8')) as { schedules?: Record<string, string> };
const disagree = Object.entries(ordering.schedules ?? {})
  .filter(([n, s]) => jobs[n] !== s).map(([n, s]) => `${n}: ordering mirror '${s}' vs '${jobs[n]}'`);
check('both cron mirrors agree on every job they share', disagree.length === 0, disagree.join('; '));

// ── mutation proofs: each rule, broken on a copy, must be reported ─────────────────────────────
const anyHourly = Object.keys(jobs).find((n) => /^\d+ \* \* \* \*$/.test(jobs[n])
  && !(n in hogs) && !(n in STARVATION_EXEMPT)) ?? '';
mustCatch('a job moved onto minute 0', minuteZeroStarts({ ...jobs, [anyHourly]: '0 * * * *' }).length > 0);
mustCatch('a */15 job (lands on :00)', minuteZeroStarts({ ...jobs, [anyHourly]: '*/15 * * * *' }).length > 0);
mustCatch('a daily job on :00', minuteZeroStarts({ ...jobs, [anyHourly]: '0 3 * * *' }).length > 0);
const hogName = Object.keys(hogs).find((n) => /^\d+ \* \* \* \*$/.test(jobs[n] ?? '')) ?? '';
const hogMin = Number((jobs[hogName] ?? '0').split(' ')[0]);
mustCatch('an hourly job placed 2 minutes after a hog',
  starvedPairs({ ...jobs, [anyHourly]: `${(hogMin + 2) % 60} * * * *` }, hogs)
    .some((p) => p.startsWith(`${anyHourly}:`)));
mustCatch('the sync back on :22 with the matview refresh back on :20',
  starvedPairs({ ...jobs, 'refresh_listing_native_location_v1': '20 * * * *' }, hogs)
    .some((p) => p.startsWith('sync-search-listings-ar:')));
mustCatch('a window that wraps past the top of the hour (:59 + 11 min reaches :05)',
  starvedPairs({ a: '59 * * * *', b: '5 * * * *' }, { a: 650 }).includes('b:5 < a'));
mustCatch('three jobs on one minute (the live detector raises at 3)', maxPerInstant({ a: '13 * * * *', b: '13 * * * *', c: '13 * * * *' }).max > MAX_PER_INSTANT);
mustCatch('five jobs stacked on one minute', maxPerInstant({ a: '13 * * * *', b: '13 * * * *', c: '13 * * * *',
  d: '13 * * * *', e: '13 * * * *' }).max > MAX_PER_INSTANT);
mustCatch('two writers on one instant', writerCollisions({ x: '7-59/10 * * * *', y: '17 * * * *' }, ['x', 'y']).length > 0);
mustCatch('THE MEASURED CASE: a three-hourly writer at :30 inside the hourly sync :22 + 890 s (alert 12926)',
  starvedWriters({ ...jobs, 'sync-rich-attrs-wasalt': '30 */3 * * *' }, writers, hogs)
    .some((p) => p.startsWith('sync-rich-attrs-wasalt ')));
mustCatch('a writer whose window wraps past midnight still starves one starting at 00:03',
  starvedWriters({ a: '58 23 * * *', b: '3 0 * * *' }, ['a', 'b'], { a: 600 }).some((p) => p.startsWith('b ')));
check('(negative control) an every-10-minutes writer refused at SOME starts is not starved',
  starvedWriters({ a: '22 * * * *', b: '5-59/10 * * * *' }, ['a', 'b'], { a: 890 }).length === 0);
check('(negative control) a writer outside every window is not starved',
  starvedWriters({ a: '22 * * * *', b: '11 */3 * * *' }, ['a', 'b'], { a: 890 }).length === 0);
mustCatch('a newer migration that alters a schedule without a mirror update',
  newestScheduleMigration([...files, { name: '99991231235959_x.sql', sql: "select cron.alter_job(1, schedule := '5 * * * *');" }])
    !== mirror._mirrored_through_migration);
mustCatch('a commented-out cron call does not count as a schedule change',
  newestScheduleMigration([{ name: '20990101000000_c.sql', sql: "-- select cron.schedule('x','1 * * * *','');" }]) === null);

if (failures > 0) {
  console.error(`\n✗ cron-slot-discipline: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ cron-slot-discipline: minute 0 empty, no non-exempt starvation, stack ≤ ratchet, mirror current\n');
