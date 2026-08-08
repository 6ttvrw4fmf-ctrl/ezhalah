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

const WORKFLOW = '.github/workflows/small-sources-sync.yml';
const MIGRATIONS_DIR = 'supabase/migrations';

// Measured on GitHub Actions run 31239278341 (2026-08-08), DEALAPP_WORKERS=3, no proxy.
const MEASURED_LISTINGS_PER_MIN = 21.7;
// Fixed per-run cost that is NOT fetching detail pages: runner setup + dependency install +
// sitemap enumeration + the final prune_unseen()/end_run() bookkeeping.
const FIXED_OVERHEAD_MIN = 13;
// The fetching phase must leave this much of the budget unused, so a slower-than-measured day
// (throttle variance, a retry storm) still completes rather than being killed.
const REQUIRED_HEADROOM_MIN = 15;

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}`);
  if (!cond) failures++;
};

console.log('verify-dealapp-crawl-budget: the dealapp cap must fit its CI timeout, and a killed');
console.log('  run must not be able to go unnoticed.');

// ── (A) the cap fits the budget ────────────────────────────────────────────────────────────────
const wf = readFileSync(WORKFLOW, 'utf8');

// Default job timeout: `timeout-minutes: ${{ matrix.tmo || 90 }}`
const defaultTmoMatch = wf.match(/timeout-minutes:\s*\$\{\{\s*matrix\.tmo\s*\|\|\s*(\d+)\s*\}\}/);
check('workflow declares a matrix-overridable timeout-minutes default', !!defaultTmoMatch);
const defaultTmo = defaultTmoMatch ? Number(defaultTmoMatch[1]) : NaN;

// The dealapp matrix entry (a single `- { source: dealapp, ... }` line).
const dealappLine = wf.split('\n').find((l) => /^\s*-\s*\{\s*source:\s*dealapp\b/.test(l));
check('workflow has a dealapp matrix entry', !!dealappLine);

if (dealappLine && Number.isFinite(defaultTmo)) {
  const capMatch = dealappLine.match(/DEALAPP_MAX_LISTINGS=(\d+)/);
  check('dealapp entry sets an explicit DEALAPP_MAX_LISTINGS cap (0/unset = uncapped full crawl)', !!capMatch);

  const workersMatch = dealappLine.match(/DEALAPP_WORKERS=(\d+)/);
  check('dealapp entry pins DEALAPP_WORKERS (throughput is only meaningful at a known worker count)', !!workersMatch);

  // Per-source timeout override, e.g. `tmo: 150` (souq24 uses this).
  const tmoMatch = dealappLine.match(/\btmo:\s*(\d+)/);
  const tmo = tmoMatch ? Number(tmoMatch[1]) : defaultTmo;

  if (capMatch && workersMatch) {
    const cap = Number(capMatch[1]);
    const workers = Number(workersMatch[1]);

    // Throughput was measured at 3 workers. More workers would be faster, but dealapp's
    // login-wall throttle is exactly why the run is pinned to 3 — so treat >3 as unproven
    // rather than silently assuming a linear speed-up.
    check(
      `dealapp runs at the measured worker count (WORKERS=${workers}; throughput was measured at 3 — re-measure before raising it)`,
      workers <= 3,
    );

    const fetchMin = cap / MEASURED_LISTINGS_PER_MIN;
    const projectedMin = fetchMin + FIXED_OVERHEAD_MIN;
    const headroom = tmo - projectedMin;

    console.log(
      `    cap=${cap} @ ${MEASURED_LISTINGS_PER_MIN}/min = ${fetchMin.toFixed(1)}m fetch` +
        ` + ${FIXED_OVERHEAD_MIN}m overhead = ${projectedMin.toFixed(1)}m against a ${tmo}m budget` +
        ` (headroom ${headroom.toFixed(1)}m, need ≥${REQUIRED_HEADROOM_MIN}m)`,
    );

    check(
      `projected run time fits the ${tmo}m budget with ≥${REQUIRED_HEADROOM_MIN}m headroom` +
        ' — raise `tmo` (or throughput) together with the cap, never the cap alone',
      headroom >= REQUIRED_HEADROOM_MIN,
    );

    // GitHub Actions hard-caps a job at 6h; a cap that needs more than that can never complete.
    check('projected run time is under the GitHub Actions 360m job ceiling', projectedMin < 360);
  }
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
// sort is chronological.
const latestRoster = files
  .filter((f) =>
    /create\s+or\s+replace\s+function\s+public\.mon_run_all_detectors/i.test(
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
