// The stale-sweep coverage gate must measure ROLLING coverage, never one run's row count.
//
// WHAT THIS LOCKS IN (senior audit run #69, 2026-08-29, owner-directed)
// --------------------------------------------------------------------
// `stale_coverage_gate:gathern_residential_listings` had been open or re-raising since
// 2026-08-10. It was not reporting a coverage problem. The gate asked "did ONE recent run see at
// least 50% of this table's active population?" using max(scrape_runs.rows_seen), and gathern is
// deliberately crawled in ~24 slices a day: its best SINGLE run across 830 successful runs since
// 2026-06-23 is 5,823 rows against a floor of ~14,700. There was no reachable green state.
//
// It was also ARBITRARY, not merely impossible. The run-matching pattern ('^' || plat || '[_:]')
// matches non-capture bookkeeping rows too, so in practice gathern's gate was decided by whether a
// `gathern_prune` row (rows_seen=18,226) happened to fall inside the 48h window — passing for a
// reason unrelated to crawl coverage, and flapping when that row aged out.
//
// And it was VACUOUS for every commercial table: `recent_best` is a per-PLATFORM run count
// compared against a per-TABLE population, so hajer_commercial (1 active row) was measured against
// hajer's 122-row residential run — "12,200% coverage". Coverage was never checked there at all.
//
// THE REPLACEMENT measures what the proxy was proxying for: distinct ACTIVE rows re-confirmed at
// the source inside a rolling, cadence-derived window (expected_hours * 3) — the same measure
// mon_detect_refresh_coverage() already computed daily, so two gates that share an intent now
// share a definition. last_seen_at is a trustworthy source signal: NO database function writes it
// (checked across every function body in the public schema on 2026-08-29); every write comes from
// scrapers/common/db.py and is a real observation — _wasalt_batch for rows "seen on the source
// THIS crawl", and the prune self-heal path only for listings a liveness oracle re-fetched and
// confirmed live. A blocked crawl writes nothing, so the measure fails CLOSED.
//
// §A pins the pure decision and its boundaries.
// §B is the mutation proof: each case is one the legacy proxy gets WRONG and the new gate gets
//    right, or vice versa. If the SQL ever reverts to the proxy these are the cases that break.
// §C replays real production measurements — healthy AND degraded, historical AND current — taken
//    from mon_refresh_coverage_alerts and from a full 28-table sweep on 2026-08-29.
// §D pins the SQL itself, via the md5-pinned mirror, so the logic above cannot drift away from the
//    function that actually runs. verify-sql-mirrors-not-stale.ts keeps the mirror equal to
//    production, so asserting on the mirror transitively asserts on production.
//
// Run: node --experimental-strip-types scripts/verify-stale-coverage-gate.ts
import { readFileSync } from 'node:fs';
import {
  COVERAGE_FRAC,
  MIN_POPULATION,
  coverageFloor,
  coverageWindowHours,
  gateTrips,
  legacyProxyTrips,
  proxyReachableForSlicedScraper,
} from './lib/staleCoverageGate.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-stale-coverage-gate: the gate measures rolling coverage, not one run.');

// ── §A the decision and its boundaries ───────────────────────────────────────────────────────
console.log('\n  §A decision + boundaries');
check('window: a daily platform gets 72h', coverageWindowHours(24) === 72);
check('window: aqar (8h) gets 24h', coverageWindowHours(8) === 24);
check('window: souq24 (48h) gets 144h', coverageWindowHours(48) === 144);
check('window: no cadence row defaults to daily → 72h', coverageWindowHours(null) === 72);
check('floor rounds UP (odd populations must not round in the lenient direction)', coverageFloor(29339) === 14670 && coverageFloor(651) === 326);
check('exactly at the floor PASSES', gateTrips({ table: 't', active: 100, observedInWindow: 50 }) === false);
check('one below the floor TRIPS', gateTrips({ table: 't', active: 100, observedInWindow: 49 }) === true);
check(
  `below ${MIN_POPULATION} active the gate does not apply (a 9-row table swings 0→100% on one listing)`,
  gateTrips({ table: 't', active: 29, observedInWindow: 0 }) === false,
);
check(
  'at exactly the min population the gate DOES apply',
  gateTrips({ table: 't', active: 30, observedInWindow: 0 }) === true,
);
check('total capture loss trips', gateTrips({ table: 't', active: 5000, observedInWindow: 0 }) === true);
check('full coverage passes', gateTrips({ table: 't', active: 5000, observedInWindow: 5000 }) === false);

// ── §B mutation proof: the proxy vs the measure ──────────────────────────────────────────────
console.log('\n  §B mutation proof (each case the two definitions disagree on)');

// gathern's shape: 24 equal slices, complete coverage.
const SLICES = 24;
const GATHERN_ACTIVE = 29_339;
const perSlice = Math.ceil(GATHERN_ACTIVE / SLICES);
check(
  'a fully-covered 24-slice platform PASSES the new gate',
  gateTrips({ table: 'gathern_residential_listings', active: GATHERN_ACTIVE, observedInWindow: GATHERN_ACTIVE }) === false,
);
check(
  'the SAME fully-covered platform TRIPS the legacy proxy — the defect, reproduced',
  legacyProxyTrips(GATHERN_ACTIVE, perSlice) === true,
  `best single slice ${perSlice} < floor ${coverageFloor(GATHERN_ACTIVE)}`,
);
check(
  'the legacy proxy has NO reachable green state for a 24-slice scraper',
  proxyReachableForSlicedScraper(SLICES) === false,
);
check(
  `…and is only ever reachable at <= ${Math.floor(1 / COVERAGE_FRAC)} slices`,
  proxyReachableForSlicedScraper(2) === true && proxyReachableForSlicedScraper(3) === false,
);
check(
  'a non-capture bookkeeping run could satisfy the proxy while real coverage was 0 — the arbitrariness',
  legacyProxyTrips(GATHERN_ACTIVE, 18_226) === false &&
    gateTrips({ table: 'gathern_residential_listings', active: GATHERN_ACTIVE, observedInWindow: 0 }) === true,
);
// The vacuous-commercial shape: hajer_commercial, 1 active row, measured against a 122-row
// residential run. Under the new gate a table this small is excluded explicitly, by population —
// not accidentally, by a number borrowed from a different table.
check(
  'the proxy passed a commercial table using another table\'s run count',
  legacyProxyTrips(650, 468) === false,
);
check(
  'the new gate measures that commercial table on its OWN rows and catches it',
  gateTrips({ table: 'dealapp_commercial_listings', active: 650, observedInWindow: 258 }) === true,
);

// ── §C real production measurements ──────────────────────────────────────────────────────────
// Sources: a full 28-table sweep on 2026-08-29 (active / observed-in-window, measured directly),
// and mon_refresh_coverage_alerts for the historical rows. `expect` is the CORRECT verdict.
console.log('\n  §C replay of real production measurements');
type Fixture = { table: string; active: number; observedInWindow: number; expect: boolean; note: string };
const FIXTURES: Fixture[] = [
  // --- degraded: must still fail closed ---
  { table: 'erapulse_residential_listings', active: 50, observedInWindow: 0, expect: true,
    note: '2026-08-29 — source origin offline (Cloudflare 1033) since 08-25; 0% coverage' },
  { table: 'dealapp_residential_listings', active: 15_252, observedInWindow: 6_365, expect: true,
    note: '2026-08-29 — 42%, the known dealapp egress degradation; 4,356 rows already stale' },
  { table: 'dealapp_commercial_listings', active: 650, observedInWindow: 258, expect: true,
    note: '2026-08-29 — 40%, a REAL degradation the legacy proxy passed (182 rows stale >= 7d)' },
  { table: 'gathern_residential_listings', active: 29_948, observedInWindow: 13_836, expect: true,
    note: '2026-08-10 — mon_refresh_coverage_alerts recorded gathern at 46.2%: the new gate is NOT ' +
          'permanently green for gathern, it retains real sensitivity' },
  // wasalt tables are excluded from THIS sweep (`tablename not like 'wasalt_%'`); this row is here
  // as a measure-level case, proving the same predicate rates a known catastrophic collapse as such.
  { table: 'wasalt_residential_listings (measure only — excluded from this sweep)', active: 50_921, observedInWindow: 1_680, expect: true,
    note: '2026-08-24 — the wasalt capture collapse at 3.3%, rated critical by mon_detect_refresh_coverage' },
  // --- healthy: must pass, and two of them the legacy proxy wrongly failed ---
  { table: 'gathern_residential_listings', active: 29_339, observedInWindow: 22_007, expect: false,
    note: '2026-08-29 — 75%: a sliced scraper in good health, the case that was permanently red' },
  { table: 'aqarmonthly_residential_listings', active: 1_739, observedInWindow: 1_249, expect: false,
    note: '2026-08-29 — 72%: 32 sync runs/day, so no single run nears the floor. Its gate had been ' +
          'open since 2026-08-12 purely as an artefact of that' },
  { table: 'aqar_commercial_listings', active: 5_931, observedInWindow: 4_962, expect: false, note: '2026-08-29 — 84%' },
  { table: 'aqarcity_residential_listings', active: 1_597, observedInWindow: 1_597, expect: false, note: '2026-08-29 — 100%' },
  { table: 'eaqartabuk_residential_listings', active: 532, observedInWindow: 532, expect: false, note: '2026-08-29 — 100% after recovery' },
  { table: 'jazwtn_residential_listings', active: 123, observedInWindow: 123, expect: false, note: '2026-08-29 — 100% after recovery' },
];
for (const f of FIXTURES) {
  const pct = ((100 * f.observedInWindow) / f.active).toFixed(1);
  check(
    `${f.expect ? 'TRIPS ' : 'passes'} ${f.table} @ ${pct}%`,
    gateTrips(f) === f.expect,
    f.note,
  );
}
check(
  'the corpus contains genuine degradation AND genuine health (a fixture set of one shape proves nothing)',
  FIXTURES.some((f) => f.expect) && FIXTURES.some((f) => !f.expect),
);

// ── §D the SQL of record ─────────────────────────────────────────────────────────────────────
// The mirror is md5-pinned to production by verify-sql-mirrors-not-stale.ts, so asserting here
// asserts on the function that actually runs at 04:00.
console.log('\n  §D the shipped SQL still implements this');
const MIRROR = 'sql/mirrors/mark_stale_listings_inactive.sql';
const sql = readFileSync(MIRROR, 'utf8');
const body = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');

check(
  'mirror computes the window from platform_cadence.expected_hours * 3',
  /coalesce\(pc\.expected_hours,\s*24\)\s*\*\s*3/.test(body),
);
check(
  'mirror counts distinct ACTIVE rows refreshed inside that window',
  /last_seen_at\s*>\s*now\(\)\s*-\s*make_interval\(hours\s*=>\s*%s\)/.test(body) &&
    /into observed/.test(body),
);
check(
  'the gate predicate uses that count',
  /if act >= min_population and observed < coverage_floor then/.test(body),
);
check(
  'THE REVERT GUARD: no max(rows_seen) coverage proxy anywhere in the body',
  !/max\(\s*r\.rows_seen\s*\)/.test(body) && !/recent_best/.test(body),
);
check(
  'the 48h `alive` window survives for the breaker-escape branch (a different question, untouched)',
  /alive_window\s+constant interval\s*:=\s*interval '48 hours'/.test(body) &&
    /and r\.started_at > now\(\) - alive_window/.test(body),
);
check(
  'the sweep still never deactivates anything (n := 0 on every path)',
  /n := 0;/.test(body) && !/\bset active = false\b/i.test(body),
);
check(
  'the alert payload names the measure, so the next reader is not misled the way this one was',
  /'observed_in_window', observed/.test(body) && /'window_hours', cov_window_hours/.test(body),
);

console.log('');
if (failures > 0) {
  console.error(`❌ verify-stale-coverage-gate: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-stale-coverage-gate: all checks passed.');
