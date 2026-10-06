// CHECK THE SHELF BEFORE SAYING «NONE» (owner 2026-10-05: «how can we never get this issue — or
// anything like it»). A zero answer is only shown when nothing we already know contradicts it.
//
// The «shelf» is a count we hold from a DIFFERENT source than the results RPC: the Filter picker's
// own district count (district_options_ar, deal/category/period scoped), or — for a deal-agnostic
// search — the location index (location_index_live, all deals, all types). When the search asked for
// nothing but the place, and the shelf says that place holds listings, a zero is not an answer: it
// is OUR failure, and it is worded as one («try again»), reported, and written in the notebook.
//
// Zero-dependency on purpose: scripts/verify-zero-never-contradicts-shelf.ts executes it directly.

// ponytail: one floor for both shelves — absorbs small scope drift (a listing removed since the
// count was taken, a platform hidden while DOWN). Lower it per-shelf if the notebook shows misses.
export const SHELF_FLOOR = 5;

// Every field that can make a TRUE zero on its own. A search carrying any of them can legitimately
// find nothing in a place that has listings, so the shelf cannot speak for it.
export const NARROWING = [
  'type', 'types', 'typeGroups', 'detail', 'priceInput', 'priceBand', 'priceMin', 'priceMax',
  'priceMinRent', 'priceMaxRent', 'keywords', 'proximity', 'sources', 'contextBeds', 'contextBedsList',
  'contextSize', 'areaMin', 'areaMax', 'ageMin', 'ageMax', 'isNewConstruction', 'amenities', 'bathMin',
  'ratingMin', 'reviewsMin', 'unitSubtypes', 'furnishedPref', 'streetWidthMin', 'ageBuckets',
  'ratingBuckets', 'furnishedIn', 'directions',
] as const;

type ShelfQuery = {
  bothDeals?: boolean;
  category?: unknown;
  districtListingCount?: number;
  locationMatch?: { exact?: boolean; fuzzy?: boolean } | null;
} & Partial<Record<(typeof NARROWING)[number], unknown>>;

const isSet = (v: unknown) => !(v == null || v === '' || (Array.isArray(v) && v.length === 0));

/** True when the search asked for nothing but a place (and a deal). */
export function placeOnly(q: ShelfQuery): boolean {
  return !NARROWING.some((k) => isSet(q[k]));
}

/** The shelf count that can contradict a zero for this exact search, or null when none can. */
export function shelfCount(q: ShelfQuery, liveCount: number | null): number | null {
  const lm = q.locationMatch;
  if (!lm || lm.exact !== true || lm.fuzzy || !placeOnly(q)) return null;
  if (typeof q.districtListingCount === 'number') return q.districtListingCount; // same deal/category/period scope
  if (q.bothDeals && !q.category && typeof liveCount === 'number') return liveCount; // all-deal, all-type shelf ↔ a search just as wide
  return null;
}

export const zeroContradictsShelf = (shelf: number | null): boolean => shelf != null && shelf >= SHELF_FLOOR;
