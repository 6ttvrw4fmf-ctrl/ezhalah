// The stale-sweep coverage gate, as pure logic.
//
// mark_stale_listings_inactive() (pg_cron jobid 13, daily 04:00 UTC) asks, per listing table:
// "have I seen enough of this population recently to trust its stale count?" If not, it withholds
// the stale report and raises `stale_coverage_gate`. This module is that question, extracted so it
// can be reasoned about and mutation-tested offline; the SQL of record is
// sql/mirrors/mark_stale_listings_inactive.sql, md5-pinned to production.
//
// Both the CURRENT measure and the LEGACY proxy it replaced live here on purpose: the barrier's
// job is to prove they differ in the specific ways that matter, and a barrier that cannot express
// the old behaviour cannot prove it is gone.

/** Fraction of the active population that must be re-confirmed inside the window. */
export const COVERAGE_FRAC = 0.5;
/** Below this many active rows a table is too small to reason about; the gate does not apply. */
export const MIN_POPULATION = 30;
/** Platforms with no platform_cadence row are assumed daily. */
export const DEFAULT_EXPECTED_HOURS = 24;
/** A platform gets this many times its own expected interval to cover its population. */
export const WINDOW_MULTIPLIER = 3;

/**
 * Rolling window for a platform, in hours — identical to mon_detect_refresh_coverage().
 * aqar (8h) → 24h, a daily platform → 72h, souq24 (48h) → 144h.
 */
export function coverageWindowHours(expectedHours: number | null | undefined): number {
  const h = expectedHours ?? DEFAULT_EXPECTED_HOURS;
  return h * WINDOW_MULTIPLIER;
}

export function coverageFloor(active: number): number {
  return Math.ceil(COVERAGE_FRAC * active);
}

export type TableCoverage = {
  table: string;
  active: number;
  /** Distinct ACTIVE rows whose last_seen_at was refreshed inside the window. */
  observedInWindow: number;
};

/**
 * THE GATE. True = withhold the stale report and raise stale_coverage_gate.
 *
 * Slice-agnostic by construction: 24 slices each covering 1/24th of the population count exactly
 * as much as one monolithic run covering all of it, and no row is ever double-counted — which is
 * the whole defect in `legacyProxyTrips` below.
 */
export function gateTrips({ active, observedInWindow }: TableCoverage): boolean {
  if (active < MIN_POPULATION) return false;
  return observedInWindow < coverageFloor(active);
}

/**
 * THE LEGACY PROXY, replaced 2026-08-29. Kept only so the barrier can prove the difference.
 *
 * It asked whether the single best run in the window saw at least half the population —
 * `max(scrape_runs.rows_seen)` — which is a question a deliberately sliced scraper can never
 * answer yes to, however complete its coverage actually is.
 */
export function legacyProxyTrips(active: number, bestSingleRunRows: number | null): boolean {
  if (active < MIN_POPULATION) return false;
  return bestSingleRunRows === null || bestSingleRunRows < coverageFloor(active);
}

/**
 * Can a platform that crawls itself in `slices` equal parts EVER satisfy the legacy proxy?
 *
 * Only if one slice alone carries half the population, i.e. slices <= 2. This is the structural
 * impossibility in one line: for gathern (~24 slices) the legacy gate had no reachable green
 * state, so it was decoration — and a barrier that cannot go green teaches everyone to ignore it.
 */
export function proxyReachableForSlicedScraper(slices: number): boolean {
  return slices <= Math.floor(1 / COVERAGE_FRAC);
}
