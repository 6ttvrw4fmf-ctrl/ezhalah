// The searchability barrier must stay WIRED, stay measured on the right metric, and stay quiet
// about cohorts it does not own.
//
// THE FAILURE CLASS THIS EXISTS FOR (found 2026-08-12, Data Integrity run #14): `mon_searchability_
// alerts` computed a per-platform SEARCHABILITY_COLLAPSE verdict and NOTHING read it — no pg_proc
// body, no cron job. cron job 62 dutifully snapshotted the history the verdict is built from, twice
// an hour every detector ran, and the verdict itself was never evaluated once. It sat on 7 standing
// COLLAPSE verdicts having raised exactly zero alerts. Same class as the orphaned-detector incident
// (AGENTS.md §11a) and the rent-period manual barrier (§22): a barrier nothing calls is decoration,
// and "the check exists" is not the same claim as "the check runs".
//
// Two measurement defects were fixed in the same migration, and both are guarded here because
// either one silently destroys the barrier's meaning:
//
//   1. The metric counted ONLY «سنوي». A «شهري» row is reachable under the monthly Filter chip, so
//      counting just annual made monthly-heavy platforms read as collapsed: gathern 0.0% -> 99.7%,
//      aqarmonthly 0.0% -> 99.3%, mustqr 21.6% -> 98.0%. If the verdict ever goes back to
//      pct_annual_searchable, the barrier reverts to alarming about healthy platforms.
//
//   2. It ignored `ops_rent_period_sourceless` — the table recording, with evidence, the 15
//      platforms whose SOURCES publish no rental period at all (audited 2026-08-11). An honest NULL
//      the owner's own audit blessed read as a defect. Wiring the verdict without this would have
//      raised 7 false P2s on day one, and a barrier that is red every time carries no information
//      (the run #8 lesson).
//
// It must ALSO not raise on suspect_price_without_period: that cohort is already owned by
// mon_detect_rent_period_unreachable (open P2 #423). Two detectors alerting on one cohort is how a
// roster turns into noise nobody reads.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`. The LIVE
// half is mon_detect_orphaned_detectors(), which raises P2 within seconds if the detector ever
// becomes unreachable from the roster.
//
// Run: node --experimental-strip-types scripts/verify-searchability-barrier-wired.ts
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const DETECTOR = 'mon_detect_searchability_collapse';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check(files.length > 100, `scanned ${files.length} migrations`,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

// The migration that CREATES the detector. There must be exactly one origin for it.
const creators = files.filter((f) =>
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${DETECTOR}`, 'i')
    .test(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')));

check(creators.length >= 1,
  `${DETECTOR} is defined in ${creators.length} migration(s)`,
  `${DETECTOR} is not defined in any tracked migration — it exists only in production, which is ` +
  `exactly the schema drift AGENTS.md "Migration drift guard" forbids`);

if (creators.length) {
  // Read the newest definer: later migrations may legitimately amend it.
  const file = creators[creators.length - 1];
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');

  // 1. THE BARRIER MUST BE WIRED IN THE SAME MIGRATION THAT CREATES IT.
  //    A detector wired in a LATER migration is unreachable in the window between the two, and
  //    mon_detect_orphaned_detectors() fires on it. AGENTS.md §11a requires them to land together.
  // Matched with a trailing-identifier guard, not a bare substring: `includes('mon_run_all_detectors')`
  // also matches `mon_run_all_detectorsX`, so a renamed or typo'd roster function would sail past.
  check(/mon_run_all_detectors(?![A-Za-z0-9_])/.test(sql),
    `${file} wires the detector into the roster in the same migration`,
    `${file} creates ${DETECTOR} without touching mon_run_all_detectors — an unwired detector is ` +
    `decoration, and that is the precise failure this barrier was built to answer`);

  // 2. The roster edit must be a needle-edit off the LIVE body, never a pasted replacement.
  check(sql.includes('pg_get_functiondef'),
    'the roster edit reads the live body via pg_get_functiondef (cannot drop entries it never read)',
    `${file} edits the roster without pg_get_functiondef — a hand-pasted body silently drops every ` +
    `detector the author's copy predates (four recorded losses; see verify-detector-roster-edits-are-guarded.ts)`);

  // 3. The verdict must be built on the period metric, not the annual-only one.
  check(sql.includes('pct_period_searchable'),
    'the verdict is measured on pct_period_searchable (annual OR monthly)',
    `${file} does not use pct_period_searchable — the verdict is back on an annual-only metric, ` +
    `which reports monthly-heavy platforms (gathern, aqarmonthly, mustqr) as collapsed while they ` +
    `are ~99% reachable`);

  // 4. The waiver table must be honoured, or evidence-backed source silence reads as a defect.
  check(sql.includes('ops_rent_period_sourceless'),
    'recorded source silence (ops_rent_period_sourceless) suppresses period-driven verdicts',
    `${file} no longer consults ops_rent_period_sourceless — the 15 platforms whose sources publish ` +
    `no period would raise false collapses, and a permanently-red barrier carries no information`);

  // 5. It must NOT re-raise a cohort another detector already owns.
  const raisesSuspect = /mon_raise[\s\S]{0,600}suspect_price_without_period/i.test(sql)
    && !/deliberately raises NOTHING/i.test(sql);
  check(!raisesSuspect,
    'does not re-alert the period-suspect cohort owned by mon_detect_rent_period_unreachable',
    `${file} raises on suspect_price_without_period — that cohort already has a detector (open P2 ` +
    `#423). Duplicate alerting on one cohort is how a roster becomes noise`);

  // 6. The barrier must self-heal, or a one-day blip stays red forever and stops meaning anything.
  check(sql.includes('mon_resolve_key'),
    'resolves its own alerts when a platform recovers',
    `${file} never calls mon_resolve_key — a recovered platform would stay red forever`);

  // 7. The scope limitation must stay documented. This view is a rent-APARTMENT canary, and run #12
  //    recorded that a detector quietly looking at the wrong scope while returning 0 is the worst
  //    failure mode there is.
  check(/NOT whole-platform coverage/i.test(sql),
    'the apartments-only scope is recorded in a COMMENT, not left for a reader to assume',
    `${file} dropped the scope disclaimer — mon_searchability_now covers only type_ar='شقة', and a ` +
    `future reader will otherwise take it for full coverage`);
}

// 8. This guard is worthless if nothing runs it.
const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-searchability-barrier-wired'),
  'npm test runs this guard',
  'package.json no longer runs verify-searchability-barrier-wired.ts — the guard is inert');

console.log('searchability-barrier-wired: the searchability verdict must be read, and read correctly\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the searchability barrier is unwired or mis-measured.`);
  process.exit(1);
}
console.log('\n✅ searchability-barrier-wired: passed.');
