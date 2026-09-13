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

// ── 4. listing_extra_attrs TABLE coverage (finer grain than #1) ────────────────────────────────
// #1 above (attributeViewGaps) is PLATFORM-grained: ops_af_attribute_coverage() EXISTS-checks
// pg_depend for EITHER of a platform's two candidate tables, so a platform with both a residential
// and a commercial table reads in_extra=true the moment ONE of the two has a listing_extra_attrs
// branch. A table-level gap — one of the two wired, the sibling not — is invisible to it. amlakalahsa
// itself (2026-09-12/13) was a full absence on BOTH its tables and would have tripped #1 too, but the
// half-wired shape is a strictly larger blind spot that #1 cannot see. This predicate is TABLE-grained
// instead: one row per SEARCHABLE_TABLES entry, never collapsed to its platform.
//
// A table with searchable_rows === 0 is NOT a gap — there is nothing for a missing branch to lose yet
// (same reasoning attributeCoverageIsClean's own onboarding-timing case uses, applied per table).
export type ExtraAttrsTableRow = { table: string; searchable_rows: number; in_extra_attrs: boolean };

export const extraAttrsTableGaps = (rows: ExtraAttrsTableRow[]): ExtraAttrsTableRow[] =>
  rows.filter((r) => r.searchable_rows > 0 && !r.in_extra_attrs);

export const extraAttrsTableCoverageIsClean = (rows: ExtraAttrsTableRow[]): boolean =>
  extraAttrsTableGaps(rows).length === 0;

export const describeExtraAttrsTableGaps = (gaps: ExtraAttrsTableRow[]): string =>
  gaps
    .map((g) => `${g.table} (${g.searchable_rows} searchable rows) has NO branch in listing_extra_attrs`)
    .join('; ');

// ── 5. IMAGES WE WERE GIVEN AND DID NOT STORE ───────────────────────────────────────────────────
// THE GAP THIS CLOSES, earned 2026-09-13. The image-coverage ratchet (#3 above) measures a
// PERCENTAGE, and a percentage cannot tell two opposite findings apart:
//
//   A. we dropped images the source published  -> OUR BUG, must be loud, must never be waived
//   B. the source published fewer images        -> NOT our bug, and no floor edit can make it one
//
// Both produce the identical red. On 2026-09-13 wasalt sat at 89.4% against a 90% floor and looked
// exactly like (A): rows the newest crawl passes touched were 13.3% and 10.0% photo-less against
// ~1% for the older cohort. It was (B) — every one of the 5,691 active photo-less rows carried
// source_capture->>'image_count' = 0, a single bucket, zero exceptions. The scraper stored
// precisely what wasalt published.
//
// THE SIGNAL IS FLEET-WIDE, NOT A WASALT SPECIAL CASE. scrapers/common/db.py records
// image_count = len(photos) into source_capture for every platform that goes through the shared
// write path. Measured across the ten largest platforms, 2026-09-13: 199,509 of 199,511 active
// rows carry the key, and `dropped` is 0 on every one of them.
//
// So this predicate is the SHARP rule the ratchet's percentage cannot be: of the listings whose
// source published images, how many did we fail to store? The answer must be ZERO, at any coverage
// percentage, on every platform — and unlike a floor it is not a judgement call anyone can tune.
//
// UNKNOWN IS NOT ZERO. A row with no image_count key is NOT evidence of nothing dropped; it is a
// row this rule cannot judge, counted separately and reported, never folded into the pass.
export type DroppedImageRow = {
  table: string;
  active_rows: number;
  /** Rows carrying source_capture->>'image_count' at all — the judgeable population. */
  rows_with_signal: number;
  /** Rows where the source published >0 images and we stored none. MUST be 0. */
  dropped: number;
};

export const droppedImageGaps = (rows: DroppedImageRow[]): DroppedImageRow[] =>
  rows.filter((r) => r.dropped > 0);

export const describeDroppedImages = (gaps: DroppedImageRow[]): string =>
  gaps
    .map((g) => `${g.table}: ${g.dropped} row(s) where the source published images and we stored `
      + `NONE (of ${g.rows_with_signal} judgeable rows in ${g.active_rows} active)`)
    .join('; ');

/**
 * How much of the fleet this rule can actually judge. A platform whose rows carry no image_count is
 * INVISIBLE to the check, and a check that silently judges nothing is the failure mode this repo has
 * been burned by — so the caller asserts coverage explicitly rather than reading `0 gaps` as health.
 */
export const droppedImageBlindRows = (rows: DroppedImageRow[]): number =>
  rows.reduce((n, r) => n + Math.max(0, r.active_rows - r.rows_with_signal), 0);
