// mon_detect_refresh_coverage(), the "was this row refreshed?" question, as pure logic.
//
// The SQL of record is the needle edit in supabase/migrations/*_feed_only_refresh_counts_direct_verdict.sql
// (owner decision 7, 2026-11-04). For a catalogue platform refresh_coverage measures the CRAWL only —
// its job is to notice a crawl that stopped re-seeing its catalogue, and a liveness oracle that keeps
// running would hide exactly that. For a FEED-ONLY platform (a stream of new posts that no crawl can
// see again) the crawl can never re-see an old post, so a direct own-page ALIVE verdict
// (last_verified_alive_at) counts as refreshed.
//
// Adding a platform to FEED_ONLY_PLATFORMS is an owner decision, not an engineering one.

/** Platforms whose refresh is measured by crawl OR direct verdict. Owner decision 7, 2026-11-04. */
export const FEED_ONLY_PLATFORMS: readonly string[] = ['haraj'];

export const DEFAULT_EXPECTED_HOURS = 24;
export const WINDOW_MULTIPLIER = 3;

export type Row = { lastSeenAt: number | null; lastVerifiedAliveAt: number | null };

/** True when the row counts as refreshed inside the window for this platform. */
export function rowRefreshed(platform: string, row: Row, nowMs: number, windowHours: number,
  feedOnly: readonly string[] = FEED_ONLY_PLATFORMS): boolean {
  const since = nowMs - windowHours * 3600_000;
  const seen = row.lastSeenAt;
  // greatest() in Postgres ignores NULL; a row with neither stamp is not refreshed.
  const evidence = feedOnly.includes(platform)
    ? Math.max(row.lastSeenAt ?? -Infinity, row.lastVerifiedAliveAt ?? -Infinity)
    : (seen ?? -Infinity);
  return evidence > since;
}

/** coverage_pct as the detector computes it (one decimal). */
export function coveragePct(platform: string, rows: Row[], nowMs: number, windowHours: number,
  feedOnly: readonly string[] = FEED_ONLY_PLATFORMS): number {
  if (rows.length === 0) return 0;
  const r = rows.filter((x) => rowRefreshed(platform, x, nowMs, windowHours, feedOnly)).length;
  return Math.round(1000 * r / rows.length) / 10;
}

/** The array literal the migration declares: `feed_only constant text[] := array['haraj']`. */
export function feedOnlyFromSql(sql: string): string[] | null {
  const m = sql.match(/feed_only\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
