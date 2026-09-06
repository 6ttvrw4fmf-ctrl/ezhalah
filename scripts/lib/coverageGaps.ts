// THE PURE PREDICATES BEHIND THE THREE PER-PLATFORM COVERAGE BARRIERS.
//
// WHY THEY LIVE HERE (routine #10, ops_incident #104, 2026-09-06). Each of these barriers was one
// file doing two incompatible jobs: a hermetic predicate with mutation proofs, and a ~10-second live
// read of production. The live halves moved to .github/workflows/loader-active-platforms-check.yml
// so a production hiccup can no longer fail an unrelated PR; the mutation proofs stayed in the
// required `npm test`.
//
// That split is only honest if BOTH halves run THE SAME predicate. If the offline half proved a copy
// and the live half evaluated another, the proof would say nothing about the code that actually
// decides production's verdict — which is precisely the "stale duplicated logic in a barrier" class
// (AGENTS.md; BARRIER_ENGINEER.md PART 1 §6) that made verify-extract-price pass while production
// broke on 2026-08-29. So the predicate is defined once, imported by both halves, and mutation-proven
// against the real production row shapes in the offline half.
//
// Every function here is pure and total: it takes the rows as an argument precisely so a proof can
// hand it a broken one.

// ── 1. AF attribute views ───────────────────────────────────────────────────────────────────────
// listing_rich_attrs and listing_extra_attrs are the two views sync_all_rich_attrs reads to fill the
// AF columns of search_listings_ar. A platform missing from one can never contribute the fields that
// view carries, so its listings answer UNKNOWN to those AF questions instead of answering with what
// the source published — invisible from the search side, which is the whole problem.
export type AttrCoverageRow = {
  platform: string;
  in_rich: boolean;
  in_extra: boolean;
  searchable_rows: number;
};

export const attributeViewGaps = (rows: AttrCoverageRow[]): AttrCoverageRow[] =>
  rows.filter((r) => !r.in_rich || !r.in_extra);

export const attributeCoverageIsClean = (rows: AttrCoverageRow[]): boolean =>
  attributeViewGaps(rows).length === 0;

export const describeAttributeGaps = (gaps: AttrCoverageRow[]): string =>
  gaps
    .map((g) => `${g.platform} (${g.searchable_rows} rows) missing from `
      + [!g.in_rich && 'listing_rich_attrs', !g.in_extra && 'listing_extra_attrs'].filter(Boolean).join(' + '))
    .join('; ');

// ── 2. Location index ───────────────────────────────────────────────────────────────────────────
// ops_location_index_coverage() returns one row per platform that is searchable but missing from
// listing_location_index. Any row at all is a gap — including one reporting zero searchable rows,
// because a freshly-activated platform is exactly the case this hole re-opens for.
export type LocationCoverageRow = { platform: string; searchable_rows: number };

export const locationIndexIsClean = (rows: LocationCoverageRow[]): boolean => rows.length === 0;

// ── 3. Image coverage ratchet ───────────────────────────────────────────────────────────────────
// An unphotographed row is VALID at every pipeline layer, so the only honest detector is the
// coverage NUMBER itself, snapshotted daily and held to a committed floor. Three rules, and each one
// is a separate way the guard could go blind rather than red:
//   1. FRESHNESS — a guard whose input silently stops arriving is a guard that always passes.
//   2. RATCHET — floors are raised when a fix lands and NEVER lowered to clear a red.
//   3. ONBOARDING GATE — a platform live but absent from the baseline fails, so adding a platform
//      requires declaring its expected coverage (or `imageless_at_source` with a reason: PRICE=SOURCE
//      has a sibling, IMAGES=SOURCE, and an honest zero stays a zero).
export type ImageBaseline = { floor_pct?: number; imageless_at_source?: boolean; reason?: string };
export type ImageCoverageRow = {
  platform: string;
  active_rows: number;
  with_images: number;
  pct: number;
  snapshot_age_hours: number;
};

export const MAX_SNAPSHOT_AGE_HOURS = 48;

export function evaluateImageCoverage(
  snap: ImageCoverageRow[],
  base: Record<string, ImageBaseline>,
): string[] {
  const problems: string[] = [];
  if (!snap.length) {
    problems.push('EMPTY SNAPSHOT — mon_snapshot_image_coverage has never run');
    return problems;
  }
  const age = snap[0].snapshot_age_hours;
  if (age > MAX_SNAPSHOT_AGE_HOURS) {
    problems.push(`snapshot is ${age}h old (>${MAX_SNAPSHOT_AGE_HOURS}h) — the cron is dead and this guard is blind`);
  }
  for (const row of snap) {
    const b = base[row.platform];
    if (!b) {
      problems.push(`${row.platform}: ${row.active_rows} live rows but NOT in the baseline — `
        + 'onboarding must declare expected image coverage');
      continue;
    }
    if (b.imageless_at_source) continue;              // declared honest zero — reason lives in the file
    const floor = b.floor_pct ?? 0;
    if (Number(row.pct) < floor) {
      problems.push(`${row.platform}: coverage ${row.pct}% fell below its floor ${floor}% `
        + `(${row.with_images}/${row.active_rows}) — scraper regression or source change; `
        + 'investigate, never lower the floor');
    }
  }
  return problems;
}
