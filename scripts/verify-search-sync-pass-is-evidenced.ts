// "THE CRON JOB SUCCEEDED" IS NOT "THE SYNC WROTE".  (ops_incident #37)
//
// 1,562 rows served a search price that disagreed with their source for ~24 hours. Every structural
// precondition said the hourly sync should have repaired them, and the incident closed its own
// root_cause with "THE MECHANISM WAS NEVER ESTABLISHED". It could not be established, because the
// one fact the investigation rested on — "jobid 28 has run and SUCCEEDED hourly ~24 times" — is not
// evidence that the upsert ran even once:
//
//   • sync_search_listings_ar() opens with `if not search_index_writer_lock() then return; end if;`
//     and that path is SILENT — zero rows, a NOTICE nobody reads, whose own text says
//     "this pass is a NO-OP and reports NULL (not 0)".
//   • pg_cron job 28 runs SEVEN statements, so return_message reflects the last one
//     (sync_all_listing_photos). The sync's own (upserted, deleted) is discarded every run.
//   • status='succeeded' therefore means "nothing raised" — equally true of a 200,000-row pass and
//     of a pass that took no lock and wrote nothing.
//
// Both monitors of this surface read exactly that non-evidence: search_index_freshness() and
// price_fidelity() each computed last_successful_sync_at / sync_recent from
// `max(end_time) from cron.job_run_details where jobid = 28 and status = 'succeeded'`. So
// mon_detect_search_index_freshness()'s P1 arm at lag_minutes > 360 could never fire while the
// scheduler kept ticking, however long the writer had actually been idle.
//
// This guard pins the repair: the writer records its own passes past the lock gate, that record is
// registered with mon_detect_stale_refresh(), and neither monitor may go back to reading the
// scheduler. Hermetic — no database, no network — and it runs inside `npm test`.
//
// STRUCTURE, NOT KEYWORDS. The load-bearing properties are an ORDERING (evidence is unreachable on
// the no-op path) and a NAMING rule (the registered object must not be a relation, or
// mon_detect_stale_refresh's pg_stat_user_tables.last_analyze fallback makes a MISSING record read
// as healthy — fail open in exactly the case it exists to catch). Every predicate below is a
// function of the migration text, and every one is EXECUTED at the bottom of this file against a
// deliberately broken copy of the real migration, so a check that cannot fail cannot ship.
//
//   node --experimental-strip-types scripts/verify-search-sync-pass-is-evidenced.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The object the writer records itself under. Deliberately NOT a relation name.
const EVIDENCE_KEY = 'search_listings_ar_sync_pass';

// ── the predicates, each a pure function of the migration SQL ────────────────────────────────────

/** The needle-edit must REFUSE to apply unless the writer-lock gate precedes the evidence write —
 *  compared by position, not assumed. Otherwise a pass that took no lock could still stamp "I ran". */
const gateOrderingIsEnforced = (sql: string) =>
  /position\(\s*'search_index_writer_lock\(\)'\s+in\s+v_def\s*\)\s*>\s*position\(\s*r_old\s+in\s+v_def\s*\)/.test(sql);

/** A moved function body must abort the edit, not be edited blind. */
const needleIsCounted = (sql: string) => /return needle found % times, expected 1/.test(sql);

/** Inside the replacement body the evidence write must precede the return, or the function returns
 *  before recording anything. */
const evidencePrecedesReturn = (sql: string) => {
  const body = sql.slice(sql.indexOf('r_new constant text :='));
  const iEvidence = body.indexOf(EVIDENCE_KEY);
  const iReturn = body.indexOf('return query select v_upserted, v_deleted;');
  return iEvidence > -1 && iReturn > -1 && iEvidence < iReturn;
};

/** mon_detect_stale_refresh() falls back to pg_stat_user_tables.last_analyze when no
 *  mon_mv_refresh_log row exists. autovacuum keeps that fresh on the real table, so registering a
 *  RELATION name would make a missing record read as healthy. */
const registeredObjectIsNotARelation = (sql: string) =>
  !/mon_refresh_targets[\s\S]{0,600}?values\s*\(\s*'search_listings_ar'\s*,/.test(sql);

const targetRow = (sql: string) =>
  /mon_refresh_targets[\s\S]*?values\s*\(\s*'search_listings_ar_sync_pass'\s*,\s*'mv_freshness'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*true/.exec(sql);

/** The writer runs hourly. A threshold looser than 6h would let a full working day of silent no-ops
 *  pass unreported — which is exactly how long ops_incident #37 ran. */
const thresholdsBoundAnHourlyWriter = (sql: string) => {
  const m = targetRow(sql);
  if (!m) return false;
  const warn = Number(m[1]), crit = Number(m[2]);
  return warn > 0 && warn <= 180 && crit > warn && crit <= 360;
};

/** Both monitors must read the writer's own record… */
const monitorsReadTheWriter = (sql: string) =>
  /select refreshed_at into v_last_sync[\s\S]{0,300}mon_mv_refresh_log/.test(sql);

/** …and the edit must post-check that no scheduler-derived freshness survived the rewrite. */
const schedulerRegressionIsPostChecked = (sql: string) =>
  /post-check, still deriving sync freshness from the scheduler/.test(sql)
  && /position\('cron\.job_run_details' in v_def\) > 0/.test(sql);

/** Seeding the evidence row with now() at install would forge exactly the evidence this migration
 *  exists to stop forging. The seed must be the last non-erroring cron time, labelled as such, and
 *  must never overwrite a real record. */
const bootstrapIsLabelledNotForged = (sql: string) => {
  const seed = /insert into public\.mon_mv_refresh_log[\s\S]*?'search_listings_ar_sync_pass'[\s\S]*?where not exists/.exec(sql);
  if (!seed) return false;
  return /bootstrap/i.test(seed[0]) && !/'search_listings_ar_sync_pass',\s*now\(\)/.test(seed[0]);
};

/** The rewritten sync must still carry its own contract. */
const syncContractSurvives = (sql: string) =>
  /post-check: unrelated sync behaviour disappeared/.test(sql)
  && /prune_inactive_from_search/.test(sql)
  && /sync_delete_circuit_breaker/.test(sql)
  && /price_annual=excluded\.price_annual/.test(sql);

// ── the real migration ───────────────────────────────────────────────────────────────────────────

console.log('\nA sync pass that did nothing must not read as a sync that ran (ops_incident #37)\n');

const migDir = join(root, 'supabase/migrations');
const carriers = readdirSync(migDir)
  .filter(f => f.endsWith('.sql'))
  .filter(f => readFileSync(join(migDir, f), 'utf8').includes(EVIDENCE_KEY));

check('the repair migration is committed (no production-only drift)', carriers.length > 0,
  `no migration in supabase/migrations/ mentions ${EVIDENCE_KEY}`);

const SQL = carriers.map(f => readFileSync(join(migDir, f), 'utf8')).join('\n');

check('the edit refuses unless the writer-lock gate precedes the evidence write',
  gateOrderingIsEnforced(SQL),
  'no position(lock) > position(return) guard: the evidence write could land on the no-op path');
check('the edit refuses to guess when the body has moved (needle counted, not just found)',
  needleIsCounted(SQL));
check('the evidence write precedes the return inside the replacement body',
  evidencePrecedesReturn(SQL));
check('the registered object is not the relation name (the fallback would fail open)',
  registeredObjectIsNotARelation(SQL),
  "mon_refresh_targets registers 'search_listings_ar' — pg_stat_user_tables.last_analyze would mask a missing record");
check('the evidence object is registered with mon_detect_stale_refresh, active',
  targetRow(SQL) !== null);
check('the escalation thresholds still bound an hourly writer (warn ≤ 180m, crit ≤ 360m)',
  thresholdsBoundAnHourlyWriter(SQL));
check("both monitors read the writer's own record, not cron.job_run_details",
  monitorsReadTheWriter(SQL));
check('a return to scheduler-derived freshness is post-checked and refused',
  schedulerRegressionIsPostChecked(SQL));
check('the install-time seed is labelled a bootstrap and is not a forged now()',
  bootstrapIsLabelledNotForged(SQL));
check('the sync rewrite post-checks that unrelated behaviour survived',
  syncContractSurvives(SQL));

// ── mutation self-proof: every predicate above, run against a broken copy of the REAL migration ──
// Not a hand-written fixture: each mutant is the shipped SQL with exactly the defect this barrier
// exists to catch spliced back in, so a predicate that has drifted away from the file it guards
// shows up here as BLIND rather than as a quiet pass.

let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

const drop = (s: string, re: RegExp) => s.replace(re, '');

mustCatch('the lock-gate ordering guard being deleted from the edit',
  !gateOrderingIsEnforced(drop(SQL, /\n\s*or position\('search_index_writer_lock\(\)' in v_def\) > position\(r_old in v_def\)/)));

mustCatch('the return needle no longer being counted (a moved body edited blind)',
  !needleIsCounted(SQL.replace('return needle found % times, expected 1', 'return needle missing')));

mustCatch('the evidence write being removed from the replacement body',
  !evidencePrecedesReturn(
    SQL.replace(/  insert into public\.mon_mv_refresh_log\(object_name, refreshed_at, rows_after, note\)\n  values \(''search_listings_ar_sync_pass''[\s\S]*?note = excluded\.note;\n/, '')));

mustCatch('the freshness target being registered under the RELATION name (fallback fails open)',
  !registeredObjectIsNotARelation(SQL.replace("values ('search_listings_ar_sync_pass', 'mv_freshness'", "values ('search_listings_ar', 'mv_freshness'")));

mustCatch('the escalation threshold being loosened past a working day',
  !thresholdsBoundAnHourlyWriter(SQL.replace("'mv_freshness', 180, 360, true", "'mv_freshness', 180, 1440, true")));

mustCatch('a monitor going back to reading the scheduler',
  !monitorsReadTheWriter(SQL.replace(/select refreshed_at into v_last_sync/g,
    'select max(end_time) into v_last_sync from cron.job_run_details where jobid = 28;')));

mustCatch('the scheduler-regression post-check being dropped',
  !schedulerRegressionIsPostChecked(SQL.replace('post-check, still deriving sync freshness from the scheduler', 'post-check, fine')));

mustCatch('the bootstrap forging write evidence with now()',
  !bootstrapIsLabelledNotForged(
    SQL.replace(/select 'search_listings_ar_sync_pass',\n\s*coalesce\(\(select max\(end_time\)[\s\S]*?interval '1 hour'\),/,
      "select 'search_listings_ar_sync_pass', now(),")));

mustCatch('the sync losing its delete circuit-breaker in the rewrite',
  !syncContractSurvives(drop(SQL, /sync_delete_circuit_breaker/g)));

// …and the other direction: the shipped file must still READ as correct, or the mutants above prove
// nothing about it.
mustCatch('the shipped migration itself still satisfying every predicate (the proofs are not vacuous)',
  gateOrderingIsEnforced(SQL) && needleIsCounted(SQL) && evidencePrecedesReturn(SQL)
  && registeredObjectIsNotARelation(SQL) && thresholdsBoundAnHourlyWriter(SQL)
  && monitorsReadTheWriter(SQL) && schedulerRegressionIsPostChecked(SQL)
  && bootstrapIsLabelledNotForged(SQL) && syncContractSurvives(SQL));

console.log('');
if (failures || mutFail) {
  console.error(`❌ ${failures} check(s) failed, ${mutFail} mutation(s) undetected\n`);
  process.exit(1);
}
console.log('✅ the writer records its own passes, and the monitors read the writer\n');
