// THE RENT POOL a listing searches in (owner 2026-10-25). Zero-dep on purpose: scripts/verify-short-stays-pool.ts
// executes every function here, and the DB mirror (public.rent_pool_ar in supabase/migrations) carries the same
// truth table — the search index decides the pool with it, and this file decides what the card says about it.
//
//   «إقامات قصيرة» (Short stays) = Gathern + Aqar Monthly ONLY — stays shorter than a year, priced by length of stay.
//   «سنوي» (Yearly)             = every other platform's rent listing with a published period. A site that quotes
//                                  PER MONTH is a yearly listing at ×12 (price_annual is already stored as monthly×12),
//                                  and the card still shows the site's own words: «السعر المعلن 3,000 شهرياً».
//   null                         = the source published no period. Never guessed (owner 2026-09-03, unchanged).
//
// The source tables are untouched: rent_period there stays the site's own word (PERIOD = SOURCE). Only the POOL
// — the search index's rent_period_ar and the card's /yr suffix — reads the per-month figure as yearly.
export const SHORT_STAY_PLATFORMS = ['gathern', 'aqarmonthly'] as const;
export const SHORT_STAY_TABLE_RE = /^(gathern|aqarmonthly)(_|$)/;
// Accepts a source table (`gathern_residential_listings`), a platform key (`aqarmonthly`) or the row's display
// name (`Aqar Monthly`, `Gathern`): spaces dropped, case ignored, so the three spellings agree.
export const isShortStayTable = (tableOrPlatformOrSource: string): boolean =>
  SHORT_STAY_TABLE_RE.test(String(tableOrPlatformOrSource || '').replace(/\s+/g, '').toLowerCase());

export type RentPool = 'monthly' | 'annual' | null;

export function rentPool(sourceTable: string, sourceRentPeriod: string | null | undefined): RentPool {
  if (isShortStayTable(sourceTable)) return 'monthly';
  const p = String(sourceRentPeriod ?? '').trim().toLowerCase();
  if (p === 'annual' || p === 'monthly') return 'annual';
  return null;
}

// The per-month figure the SITE advertised, for the card's «السعر المعلن {a} شهرياً» line: only when the pool is
// yearly, the site priced per month, and a figure exists. price_annual is stored as monthly×12, so /12 is exact.
export function advertisedMonthly(pool: RentPool, sourceRentPeriod: string | null | undefined, priceAnnual: unknown): number | null {
  if (pool !== 'annual') return null;
  if (String(sourceRentPeriod ?? '').trim().toLowerCase() !== 'monthly') return null;
  if (typeof priceAnnual !== 'number' || !Number.isFinite(priceAnnual) || priceAnnual <= 0) return null;
  return Math.round(priceAnnual / 12);
}

// The PostgREST `.or()` clause the card fetch applies per source table so a row the results RPC returned is never
// dropped (and a row it would not return is never shown). `null` = no period clause. A priced row with no
// published period is in neither pool; an unpriced row («سعر عند الطلب») passes every branch (owner 2026-09-28).
export function cardFetchPeriodOr(pool: 'monthly' | 'annual' | 'both', sourceTable: string): string | null {
  const shortStay = isShortStayTable(sourceTable);
  if (pool === 'monthly') return shortStay ? null : 'rent_period.eq.monthly,price_annual.is.null';
  if (pool === 'annual') return shortStay ? 'rent_period.eq.annual,price_annual.is.null' : 'rent_period.in.(monthly,annual),price_annual.is.null';
  return shortStay ? null : 'rent_period.in.(monthly,annual),price_annual.is.null';
}
