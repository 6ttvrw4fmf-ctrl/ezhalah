// The url_collision_res_vs_com barrier must stay wired, self-heal, and check the right cohort.
//
// THE FAILURE CLASS THIS EXISTS FOR (Search & Matching QA run, 2026-08-12):
//   Same source ad URL persisted as BOTH a production_ready row in <platform>_residential_listings
//   AND a production_ready row in <platform>_commercial_listings on the same platform. Because
//   both the RPC (location_search_candidates_ar) and the client (src/data/remote.ts) key on
//   (source_table, listing_id), the two rows correctly return as two independent search cards —
//   the user sees the same physical property twice. Confirmed at introduction and still open
//   2026-08-22: dealapp + sadin, ~10 URL pairs, 20 production_ready rows.
//
// The barrier lives in supabase/migrations/20260812120526_url_collision_res_vs_com_detector.sql.
// It must stay in the roster (else mon_detect_orphaned_detectors would flag it), keep filtering
// to production_ready on BOTH sides (a non-served row is not a user-visible defect), self-heal
// per-platform via mon_resolve_key when a platform recovers, lowercase URLs so case-only
// variants can't evade, and never widen scope silently.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`. The
// LIVE half is mon_detect_orphaned_detectors(), which raises P2 within seconds if the detector
// ever becomes unreachable from the roster.
//
// Run: node --experimental-strip-types scripts/verify-url-collision-detector-wired.ts
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const DETECTOR = 'mon_detect_url_collisions_res_vs_com';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check(files.length > 100, `scanned ${files.length} migrations`,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

const creators = files.filter((f) =>
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${DETECTOR}`, 'i')
    .test(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')));

check(creators.length >= 1,
  `${DETECTOR} is defined in ${creators.length} migration(s)`,
  `${DETECTOR} is not defined in any tracked migration — it exists only in production, which is ` +
  `exactly the schema drift AGENTS.md "Migration drift guard" forbids`);

if (creators.length) {
  const file = creators[creators.length - 1];
  const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');

  // 1. Roster wiring lands in the SAME migration.
  check(/mon_run_all_detectors(?![A-Za-z0-9_])/.test(sql),
    `${file} wires the detector into the roster in the same migration`,
    `${file} creates ${DETECTOR} without touching mon_run_all_detectors — an unwired detector ` +
    `is decoration, and mon_detect_orphaned_detectors would raise on it within seconds`);

  // 2. Needle-edit of the live roster body, never a pasted replacement.
  check(sql.includes('pg_get_functiondef'),
    'the roster edit reads the live body via pg_get_functiondef (cannot drop entries it never read)',
    `${file} edits the roster without pg_get_functiondef — a hand-pasted body silently drops every ` +
    `detector the author's copy predates`);

  // 3. Both sides filtered to production_ready. A non-served row is not a user-visible defect —
  //    counting it would spam a P2 for platforms whose "shadow" rows are already correctly hidden.
  const prCount = (sql.match(/production_ready/g) || []).length;
  check(prCount >= 2,
    `both sides of the collision test filter to production_ready (found ${prCount} references)`,
    `${file} does not filter both res and com to production_ready — the barrier would raise on ` +
    `rows the app never surfaces, turning a real defect signal into permanent noise`);

  // 4. Self-heal per platform, else a repaired platform stays red forever and stops meaning anything.
  check(sql.includes('mon_resolve_key'),
    'resolves its own alerts per platform when the collision clears',
    `${file} never calls mon_resolve_key — a recovered platform would stay red forever`);

  // 5. lower(listing_url) — case-only variants must not evade the detector.
  check(/lower\(\s*[a-z]\.listing_url\s*\)/i.test(sql),
    'compares listing_url case-insensitively (lower())',
    `${file} does not lower() listing_url on both sides — a case-only variant would evade detection`);

  // 6. Cross-schema safety: uses information_schema to check both tables exist before querying.
  check(sql.includes('information_schema.tables'),
    'guards against missing per-platform tables via information_schema.tables',
    `${file} does not check information_schema before executing dynamic SQL — a future platform ` +
    `without one of the two tables would crash the whole detector, not just skip its own row`);

  // 7. Selftest that proves reachability + initial detection lives in the migration body.
  check(sql.includes('SELFTEST'),
    'the migration includes an in-body SELFTEST asserting roster reachability and detection',
    `${file} has no SELFTEST block — a silent broken barrier could ship undetected`);
}

// 8. This guard is worthless if nothing runs it.
const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-url-collision-detector-wired'),
  'npm test runs this guard',
  'package.json no longer runs verify-url-collision-detector-wired.ts — the guard is inert');

console.log('url-collision-detector-wired: same URL never renders as two cards\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the url-collision barrier is unwired or mis-scoped.`);
  process.exit(1);
}
console.log('\n✅ url-collision-detector-wired: passed.');
