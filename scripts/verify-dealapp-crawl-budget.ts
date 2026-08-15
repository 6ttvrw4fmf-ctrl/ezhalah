// Regression guard (2026-08-08) for the dealapp daily crawl being killed by its CI timeout, and
// for the monitoring gap that let that happen silently.
//
// THE BUG THIS EXISTS TO PREVENT
// -----------------------------
// `small-sources-sync.yml` caps the dealapp crawl with DEALAPP_MAX_LISTINGS so the run finishes
// inside its `timeout-minutes` budget — the cap exists precisely so `prune_unseen()` and
// `end_run()` get to run. On 2026-08-07 the cap was raised to 12000 without measuring CI
// throughput. The next scheduled run (GitHub Actions run 31239278341, 2026-08-08) was CANCELLED at
// exactly 90m — 04:22:49 → 05:52:46 — with these consequences:
//   • scrape_runs id 25397 left ok=NULL / finished_at=NULL forever (end_run never ran),
//   • prune_unseen() and the sold-pin never ran for that cycle,
//   • ops_freshness_by_layer froze dealapp's scraper_last_ok at 2026-08-07 while every other
//     platform advanced to 08-08,
//   • and NOTHING alerted: mon_detect_silent_scraper_death() needs the last THREE runs to be
//     unhealthy, so a job killed every single day is only noticed on day three.
//
// Measured throughput from that run: 1,800 detail pages in ~83m of fetching ≈ 21.7/min at
// DEALAPP_WORKERS=3 (dealapp's anonymous origin trips a login-wall above ~3 workers).
//
// This guard is pure offline source-lint — no network, no DB. It checks two things:
//   (A) the dealapp cap still fits its job budget at measured throughput, so nobody can raise the
//       cap again without also raising the timeout (or the worker count / adding a proxy);
//   (B) mon_detect_dangling_scrape_run is still registered in mon_run_all_detectors, and no
//       previously-live detector was dropped from the roster — the exact silent-drop class that
//       hid the 2026-08-04 revert (senior audit run #5) and that migration 20260803194308 caused.
import { readFileSync, readdirSync } from 'node:fs';

const WORKFLOW = '.github/workflows/dealapp-sharded.yml';
const SMALL_SOURCES = '.github/workflows/small-sources-sync.yml';
const MIGRATIONS_DIR = 'supabase/migrations';

// WORST sustained throughput observed across the last 8 real dealapp runs (2026-08-07..08-11):
// 8.3 / 9.5 / 15.5 / 16.2 / 31.5 rows-per-minute, plus two 0-row login-wall runs. The 2026-08-08
// figure of 21.7/min was a single sample; sizing on the worst observed rate is what makes the
// budget hold on a bad night rather than on an average one.
const MEASURED_LISTINGS_PER_MIN = 8.3;
// Fixed per-run cost that is NOT fetching detail pages: runner setup + dependency install +
// sitemap enumeration + the final prune_unseen()/end_run() bookkeeping.
const FIXED_OVERHEAD_MIN = 13;
// The fetching phase must leave this much of the budget unused, so a slower-than-measured day
// (throttle variance, a retry storm) still completes rather than being killed.
const REQUIRED_HEADROOM_MIN = 15;
// Active dealapp inventory the fleet must re-confirm every night (8,012 residential + 374
// commercial, measured 2026-08-11). Sized with headroom for growth; re-measure if it moves a lot.
const ACTIVE_INVENTORY = 8386;

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}`);
  if (!cond) failures++;
};

console.log('verify-dealapp-crawl-budget: the dealapp cap must fit its CI timeout, and a killed');
console.log('  run must not be able to go unnoticed.');

// ── (A) the sharded fleet fits its budget, and dealapp runs in exactly ONE place ───────────────
const wf = readFileSync(WORKFLOW, 'utf8');

// dealapp must NOT also run in the small-sources matrix. Two crawls of the same catalogue would
// double the load on an origin that already blocks under burst, and the unsharded run would
// re-create the ~25%-coverage state that kept prune_unseen's coverage guard permanently tripped.
const small = readFileSync(SMALL_SOURCES, 'utf8');
check(
  'dealapp does NOT also run in small-sources-sync.yml (no duplicate crawl of the same catalogue)',
  !small.split('\n').some((l) => /^\s*-\s*\{\s*source:\s*dealapp\b/.test(l)),
);

const tmoMatch = wf.match(/timeout-minutes:\s*(\d+)/);
check('sharded workflow declares an explicit timeout-minutes', !!tmoMatch);
const tmo = tmoMatch ? Number(tmoMatch[1]) : NaN;

const shardsMatch = wf.match(/--shards\s+(\d+)/);
check('the crawl command passes an explicit --shards count', !!shardsMatch);

// The matrix must enumerate exactly shards 0..N-1 — a missing shard is a permanent coverage hole
// that nothing else would report, and a duplicated one is wasted work against a throttled origin.
const matrixMatch = wf.match(/shard:\s*\[([^\]]*)\]/);
check('the matrix enumerates the shard list', !!matrixMatch);

const capMatch = wf.match(/DEALAPP_MAX_LISTINGS:\s*"?(\d+)"?/);
check('the workflow sets an explicit per-shard DEALAPP_MAX_LISTINGS cap', !!capMatch);

const workersMatch = wf.match(/DEALAPP_WORKERS:\s*"?(\d+)"?/);
check('the workflow pins DEALAPP_WORKERS (throughput is only meaningful at a known worker count)', !!workersMatch);

if (shardsMatch && matrixMatch && capMatch && workersMatch && Number.isFinite(tmo)) {
  const shards = Number(shardsMatch[1]);
  const listed = matrixMatch[1].split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
  const expected = Array.from({ length: shards }, (_, i) => i);
  check(
    `the matrix runs every shard exactly once (0..${shards - 1}) — a missing shard is a silent coverage hole`,
    listed.length === shards && expected.every((i) => listed.filter((x) => x === i).length === 1),
  );

  const workers = Number(workersMatch[1]);
  check(
    `dealapp runs at the measured worker count (WORKERS=${workers}; throughput was measured at 3 — re-measure before raising it)`,
    workers <= 3,
  );

  // A shard must be able to re-confirm its whole slice of the ACTIVE inventory inside the budget —
  // that is the entire point of sharding. Coverage below prune_unseen's 0.80 floor means the guard
  // trips and nothing is ever aged out, which is the state this replaced.
  const perShard = Math.ceil(ACTIVE_INVENTORY / shards);
  const fetchMin = perShard / MEASURED_LISTINGS_PER_MIN;
  const projectedMin = fetchMin + FIXED_OVERHEAD_MIN;
  const headroom = tmo - projectedMin;

  console.log(
    `    ${ACTIVE_INVENTORY} active / ${shards} shards = ${perShard} rows/shard @ ${MEASURED_LISTINGS_PER_MIN}/min` +
      ` = ${fetchMin.toFixed(1)}m + ${FIXED_OVERHEAD_MIN}m overhead = ${projectedMin.toFixed(1)}m` +
      ` against a ${tmo}m budget (headroom ${headroom.toFixed(1)}m, need ≥${REQUIRED_HEADROOM_MIN}m)`,
  );

  check(
    `a shard re-confirms its full active slice inside the ${tmo}m budget with ≥${REQUIRED_HEADROOM_MIN}m headroom` +
      ' — raise the shard COUNT (or throughput), never the timeout alone',
    headroom >= REQUIRED_HEADROOM_MIN,
  );

  // The per-shard cap must not be able to truncate that slice, or coverage drops back under the
  // floor and pruning silently stops again.
  check(
    `the per-shard cap (${Number(capMatch[1])}) exceeds the shard's active slice (${perShard})`,
    Number(capMatch[1]) > perShard,
  );

  check('projected run time is under the GitHub Actions 360m job ceiling', projectedMin < 360);
}

// ── (B) the killed-run detector is wired, and nothing was dropped from the roster ───────────────
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

const definesDetector = files.some((f) =>
  /create\s+or\s+replace\s+function\s+public\.mon_detect_dangling_scrape_run/i.test(
    readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'),
  ),
);
check('a migration defines mon_detect_dangling_scrape_run()', definesDetector);

// Latest migration that (re)defines the roster wins — filenames are date-prefixed, so lexical
// sort is chronological. Anchored to line start so it only matches a genuine DDL definition:
// a needle-edit migration (do-block that replace()s the LIVE prosrc and re-executes it via
// `execute format('create or replace function public.mon_run_all_detectors...')`) carries that
// text inside a string literal, preserves the roster byte-for-byte by construction, and must NOT
// be mistaken for a roster rebuild — 20260815233850 is the precedent (false-failed this guard).
const latestRoster = files
  .filter((f) =>
    /^\s*create\s+or\s+replace\s+function\s+public\.mon_run_all_detectors/im.test(
      readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'),
    ),
  )
  .sort()
  .pop();

check('a migration defines mon_run_all_detectors()', !!latestRoster);

if (latestRoster) {
  const roster = readFileSync(`${MIGRATIONS_DIR}/${latestRoster}`, 'utf8');

  // Every detector that was live in production as of 2026-08-08. A roster rebuilt from a stale
  // base is how the unverified-inactivation detector was silently dropped on 2026-08-03 — this
  // list is the floor, so that can never happen quietly again.
  const REQUIRED_DETECTORS = [
    'mon_detect_silent_scraper_death',
    'mon_detect_zero_new_stall',
    'mon_detect_stale_active_fraction',
    'mon_detect_volume_drop',
    'mon_detect_cron_health',
    'mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables',
    'mon_detect_field_integrity',
    'mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth',
    'mon_detect_registry_orphans',
    'mon_detect_rls_reachability',
    'mon_detect_mass_inactivation',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation',
    'mon_detect_deletion_spike',
    'mon_detect_buy_token_price_suppression',
    'mon_detect_price_source_mismatch',
    'mon_detect_dangling_scrape_run',
    'mon_detect_orphaned_detectors',
  ];

  const missing = REQUIRED_DETECTORS.filter((d) => !roster.includes(`'${d}'`));
  check(
    `${latestRoster}: roster still lists all ${REQUIRED_DETECTORS.length} live detectors` +
      (missing.length ? ` (missing: ${missing.join(', ')})` : ''),
    missing.length === 0,
  );
}

console.log('');
if (failures > 0) {
  console.error(`❌ verify-dealapp-crawl-budget: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-dealapp-crawl-budget: all checks passed.');
