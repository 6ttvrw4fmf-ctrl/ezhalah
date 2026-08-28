// The detector roster must never again be lost to a hand-copied full body (2026-08-10, DIE run).
//
// THE FAILURE CLASS: `mon_run_all_detectors()` holds the list of every barrier that runs twice an
// hour. Replacing it with `create or replace function ... <a body pasted from a screen>` silently
// deletes every entry the author's copy predates. Nothing errors, nothing regresses in CI, and the
// only symptom is that a barrier stops protecting anything — which looks exactly like silence.
//
// It has now happened at least four times, and the migration names alone tell the story:
//   20260804113911_revert_nightly_report_clobber_restore_full_detector_roster
//   20260810175245_restore_full_detector_roster_union
//   20260810202219_price_area_artifact_fix_repair_and_barrier   ← dropped 6 detectors 4 min after
//                                                                 they were wired; comment claimed
//                                                                 "rebuilt from the current live
//                                                                 body, verified this session"
//   20260810222259_restore_roster_detectors_dropped_by_stale_rebuild  ← the repair
//
// THE PATTERN THAT CANNOT LOSE ENTRIES: read the live body with pg_get_functiondef(), assert the
// anchor, splice the new name in, execute the result. 20260810201833 does it; 20260810222259 does
// it. A needle-edit never has to know what else is in the array, so it cannot drop what it never
// read. That is the rule this guard enforces for every future migration.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`. The LIVE
// half is mon_detect_orphaned_detectors(), which raises P2 within seconds when a detector becomes
// unreachable — it caught this incident correctly; what was missing was anything that stops the
// bad edit from landing in the first place.
//
// Run: node --experimental-strip-types scripts/verify-detector-roster-edits-are-guarded.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

// "Is this guard actually wired in?" — asked of the test registry, which is what `npm test`
// resolves its run set from (scripts/lib/testRegistry.ts). String-matching package.json used to
// answer it; since the 201-command chain became one runner invocation, that match would read
// "not wired" for every barrier in the suite.
const REPO_ROOT = __join(import.meta.dirname, '..');

const MIGRATIONS_DIR = 'supabase/migrations';
const REPAIR = '20260810222259_restore_roster_detectors_dropped_by_stale_rebuild.sql';

// Migrations that already replace the roster wholesale. Grandfathered by exact filename — this list
// is a record of past misses, not a template. It must never grow: a NEW entry here is the very
// thing the guard exists to prevent, so adding one is a deliberate, reviewed act.
const GRANDFATHERED = new Set([
  '20260713_batch0_detection_spine.sql',
  '20260716_batch2_search_truth.sql',
  '20260716_batch5_integrity_checks.sql',
  '20260716_search_index_freshness_detector.sql',
  '20260717194809_20260717194600_mon_rls_reachability_detector.sql',
  '20260717_ingestion_watchdogs.sql',
  '20260721021600_mon_detect_mass_inactivation.sql',
  '20260721102646_mon_detect_mass_inactivation.sql',
  '20260727115000_retention_cleanup_framework.sql',
  '20260803193000_mon_english_district_leak_detector.sql',
  '20260804063424_mon_rewire_orphaned_detectors_crash_isolate_sweep_search_gate_leak.sql',
  '20260804113559_fix_mass_inactivation_date_type_and_isolate_detectors.sql',
  '20260804113911_revert_nightly_report_clobber_restore_full_detector_roster.sql',
  '20260804120000_price_size_sanity_safety_check.sql',
  '20260808062049_mon_detect_dangling_scrape_run_killed_jobs_must_not_be_silent.sql',
  // 2026-08-11: applied to prod by a concurrent session as a wholesale rewrite; this guard caught
  // it at mirror time. Production verified BEFORE grandfathering: the live roster carries all 37
  // detectors including every 2026-08-11 addition, and mon_detect_orphaned_detectors() = 0 — this
  // instance dropped nothing (its copy was written the same day as the newest entries). Recorded
  // here as a miss, not a template: the next roster edit still must use the guarded needle-edit.
  '20260811131736_dealapp_shard_coverage_barrier.sql',
  '20260810125209_mon_filter_barrier_leak_alerting.sql',
  '20260810175029_cron_stampede_fix_and_collision_detector.sql',
  '20260810175245_restore_full_detector_roster_union.sql',
  '20260810175327_roster_drop_superseded_search_gate_leak.sql',
  '20260810202219_price_area_artifact_fix_repair_and_barrier.sql',
  // 2026-08-15: miss #5 — applied straight to prod at 07:23 by a concurrent session, discovered at
  // mirror time when this guard (correctly) refused the verbatim files. LIVE ROSTER VERIFIED INTACT
  // before grandfathering: every mon_detect_* absent from the live mon_run_all_detectors body has
  // its own dedicated cron entry (jobids 40/42/43/58/59/63), mon_detect_orphaned_detectors is in
  // the roster and quiet, zero orphan/roster alerts in the surrounding 10h. Recorded verbatim as a
  // historical fact (drift mirror must be byte-identical); the NEXT roster edit still must use the
  // guarded needle-edit.
  '20260815072328_mon_detect_rent_period_contradicts_source_probe.sql',
  '20260815072452_restore_explicit_detector_roster_after_run22_wholesale_rebuild.sql',
  // 2026-08-15: miss #6 — applied straight to prod at 23:38 by the senior-audit session, recovered
  // verbatim at mirror time (md5 36deb3503dfb2b648e7066f748586538). It IS a needle-edit (reads live
  // prosrc, asserts the rent-period anchor, splices one name in, re-executes) so it cannot drop
  // entries — it trips this guard only because its execute format() string spells out the
  // create-or-replace header, unlike the repair's pg_get_functiondef splice. LIVE ROSTER VERIFIED
  // INTACT before grandfathering: 23/23 required detectors present in the live body, including
  // both names this migration and its sibling (233826) touch. Drift mirror must stay byte-identical,
  // so the file is grandfathered rather than rewritten; the NEXT roster edit still must use the
  // pg_get_functiondef needle-edit.
  '20260815233850_roster_wire_wasalt_annualisation_fabricated_detector.sql',
  // 2026-08-15: miss #7 — the 23:43 sibling of miss #6, applied straight to prod by the same
  // concurrent session and recovered verbatim at mirror time (md5 3d0a1a30454e6e13e71035e335c7b2d0).
  // Named 'roster_full_explicit' by its own author. LIVE ROSTER VERIFIED INTACT before
  // grandfathering: mon_detect_orphaned_detectors() = 0 and zero orphan/roster alerts in the
  // surrounding 3h. Drift mirror must stay byte-identical; the NEXT roster edit still must use the
  // pg_get_functiondef needle-edit.
  '20260815234309_roster_full_explicit_after_wasalt_annualisation_detector.sql',
]);

// Every detector the 2026-08-10 repair put back. Pinned so a future revert of that migration, or a
// rebuild that quietly drops one of them again, fails here instead of going unnoticed in production.
const RESTORED = [
  'mon_detect_price_size_contamination',
  'mon_detect_trending_district_dead_end',
  'mon_detect_location_predicate_drift',
  'mon_detect_search_performance_regression',
  'mon_detect_commercial_coverage_blind_spot',
  'mon_detect_stalled_daily_detector',
  'mon_detect_zero_price_served',
  'mon_detect_filter_barrier_leaks',
  'mon_detect_deploy_lock_misuse',
];

const FULL_REWRITE = /create\s+or\s+replace\s+function\s+(?:public\.)?mon_run_all_detectors/i;

// A GUARDED NEEDLE-EDIT is not a rewrite, even though it contains that same header inside its
// `execute format(...)` string. The distinction is the one this file's own header calls "THE PATTERN
// THAT CANNOT LOSE ENTRIES": it reads the LIVE body (pg_get_functiondef / prosrc) and splices the new
// name into it, so it never has to know what else is in the array and cannot drop what it never read.
// A hand-pasted body enumerates the roster literally and silently loses every entry it predates.
// Keying on the mechanism instead of the string means a genuine needle-edit no longer needs a
// grandfather entry to pass — and a pasted body still cannot sneak through by adding a comment.
const NEEDLE_EDIT = (sql: string) =>
  /(pg_get_functiondef|prosrc)/i.test(sql) && /\breplace\s*\(/i.test(sql);

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check(files.length > 100, `scanned ${files.length} migrations`,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

// 1. No NEW migration may rewrite the roster wholesale.
const offenders = files.filter((f) => {
  if (GRANDFATHERED.has(f) || f === REPAIR) return false;
  const sql = readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8');
  return FULL_REWRITE.test(sql) && !NEEDLE_EDIT(sql);
});
check(offenders.length === 0,
  'no migration replaces mon_run_all_detectors with a hand-written body',
  `these migrations rewrite the roster wholesale, which silently drops every entry their copy ` +
  `predates — use the guarded needle-edit in ${REPAIR} instead: ${offenders.join(', ')}`);

// 2. The grandfather list is a record, not a loophole: it may only name files that exist.
const stale = [...GRANDFATHERED].filter((f) => !files.includes(f));
check(stale.length === 0,
  `grandfather list matches the tree (${GRANDFATHERED.size} historical full rewrites)`,
  `grandfathered files no longer exist — the list has drifted from the tree: ${stale.join(', ')}`);

// 3. The repair itself must stay in the tree, keep using the needle-edit, and keep naming every
//    detector it restored.
const repair = files.includes(REPAIR) ? readFileSync(`${MIGRATIONS_DIR}/${REPAIR}`, 'utf8') : '';
check(repair.length > 0, `${REPAIR} is present`,
  `${REPAIR} is missing — the roster repair has been reverted out of the tree`);
check(repair.includes('pg_get_functiondef') && !FULL_REWRITE.test(repair),
  'the repair edits the LIVE body via pg_get_functiondef instead of pasting a new one',
  `${REPAIR} no longer reads the live body — it has become the bug it fixed`);
const dropped = RESTORED.filter((d) => !repair.includes(d));
check(dropped.length === 0,
  `all ${RESTORED.length} restored detectors are still pinned by the repair`,
  `the repair no longer restores: ${dropped.join(', ')}`);
check(repair.includes('open_alerts'),
  'the roster still reports standing open alerts, not only newly-raised ones',
  `${REPAIR} dropped the open_alerts summary — an all-zero sweep would again read as healthy ` +
  `while alerts sit open (mon_raise returns 0 for an already-open dedup key)`);

// 4. This guard is worthless if nothing runs it.
check(npmTestRuns(REPO_ROOT, 'verify-detector-roster-edits-are-guarded'),
  'npm test runs this guard',
  '`npm test` no longer runs verify-detector-roster-edits-are-guarded.ts (see scripts/test-exclusions.txt) — the guard is inert');

console.log('detector-roster-edits-are-guarded: the barrier list must survive the next migration\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — a roster edit can silently drop detectors.`);
  process.exit(1);
}
console.log('\n✅ detector-roster-edits-are-guarded: passed.');
