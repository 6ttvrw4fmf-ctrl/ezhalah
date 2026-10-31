// THE RENT POOL a listing searches in (owner 2026-10-25). Zero-dep on purpose: scripts/verify-short-stays-pool.ts
// executes every function here, and the DB mirror (public.rent_pool_ar in supabase/migrations) carries the same
// truth table — the search index decides the pool with it, and this file decides what the card says about it.
//
//   «إقامات قصيرة» (Short stays) = Gathern + Aqar Monthly ONLY — stays shorter than a year, priced by length of stay.
//   «سنوي» (Yearly)             = every other platform's rent listing with a published period. A site that quotes
//                                  PER MONTH is a yearly listing at ×12 (price_annual is already stored as monthly×12),
//                                  and the card still shows the site's own words: «السعر المعلن 3,000 شهرياً».
//   null                         = the source published no period AND the figure cannot settle it (see below).
//
// A SILENT PERIOD IS JUDGED FROM THE PRICE (owner 2026-09-28, every site 2026-10-03, built 2026-10-31 — migrations
// 20261031205445 + the pool-rule correction the same night; SQL mirror public.judge_silent_rent_period_ar()).
// 13,436 priced rents (aqar, haraj, muhaysini, nofodh, dwelleo, wajaf …) sat with no period and no rent button could
// show them. Now, when the site prints no period, the raw figure decides: under 300 = a placeholder, not a rent →
// null; 300–7,999 on a home/business type = a PER-MONTH figure → the yearly pool at ×12 exactly like a stated
// monthly («السعر المعلن 2,500 شهرياً»); 15,000 and above = a yearly rent → 'annual'; 8,000–14,999 (or a small figure
// on land / farm / chalet) stays null — borderline, never a guess. The index does the same, so count = cards.
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

export const SILENT_YEARLY_FROM = 15000;                        // SAR, inclusive: a silent figure this big is a yearly rent
export type SilentJudgment = 'monthly-figure' | 'annual' | null;
/** The owner's silent-period rule on the raw figure a site printed with NO period (mirror of judge_silent_rent_period_ar). */
export function judgeSilentRentPeriod(priceAnnual: unknown, cleanType: string | null | undefined): SilentJudgment {
  if (typeof priceAnnual !== 'number' || !Number.isFinite(priceAnnual)) return null;
  if (priceAnnual < CHEAP_YEARLY_FROM) return null;                                     // 1, 20, 35 … placeholders
  if (priceAnnual < CHEAP_YEARLY_BELOW) {
    return (CHEAP_YEARLY_TYPES_EN as readonly string[]).includes(String(cleanType ?? '')) ? 'monthly-figure' : null;
  }
  if (priceAnnual >= SILENT_YEARLY_FROM) return 'annual';
  return null;                                                                          // 8,000–14,999: borderline
}

export function rentPool(sourceTable: string, sourceRentPeriod: string | null | undefined,
  priceAnnual?: unknown, cleanType?: string | null): RentPool {
  if (isShortStayTable(sourceTable)) return 'monthly';
  const p = String(sourceRentPeriod ?? '').trim().toLowerCase();
  if (p === 'annual' || p === 'monthly') return 'annual';
  // SILENT = the column is NULL/absent — exactly what the index trigger judges. An empty or unknown WORD is not
  // silent: the index leaves it alone, so the card must too (the parity enumeration in verify-short-stays-pool.ts).
  if (sourceRentPeriod == null) return judgeSilentRentPeriod(priceAnnual, cleanType) ? 'annual' : null;
  return null;
}

// A «YEARLY» RENT UNDER 8,000 SAR ON A HOME OR BUSINESS UNIT IS A PER-MONTH PRICE (owner 2026-10-26: «investigate
// the monthly prices kept in yearly and put a very very strong guard … make sure we show yearly always»).
// Measured 2026-10-26 over the live index: «سنوي» apartments price 8,410 below 8,000 SAR, 194 between 8,000 and
// 12,000, then 2,202 at 12,000–20,000 and 56,282 above — nothing rents a flat for 3,000 a YEAR; the sites' own ad
// text says «شهري» on 3,269 of Aqar's 5,272 cheap «yearly» ads, and Wasalt's own data labels 3,300 as yearly with
// no monthly figure beside it. The source's word stays the source's word in the source tables; the POOL and the
// PRICE WE SERVE read such a figure as monthly ×12, and the card says so: «السعر المعلن 3,300 شهرياً».
// Rooms, land, rest houses, chalets, camps and farms are OUT (a room at 6,000 a year is real). Mirrored in SQL by
// public.rent_price_annual_ar(); the same list and threshold, pinned by scripts/verify-cheap-yearly-is-monthly.ts.
// THE BAND is [300, 8000): measured on the rule's first live hour (2026-10-26), 118 «yearly» figures sit UNDER
// 300 SAR (1, 12, 35, 100 …) — placeholders, not monthly rents; ×12 would print «السعر المعلن 35 شهرياً». They
// stay as published and the price-magnitude guards own them.
export const CHEAP_YEARLY_FROM = 300;                           // SAR per year, inclusive
export const CHEAP_YEARLY_BELOW = 8000;                         // SAR per year, exclusive
export const CHEAP_YEARLY_TYPES_EN = ['Apartment', 'Villa', 'Floor', 'Duplex', 'Studio', 'House', 'Building',
  'Residential Building', 'Office', 'Shop', 'Warehouse', 'Showroom', 'Commercial Building'] as const;
export function cheapYearlyIsMonthly(sourceTableOrSource: string, sourceRentPeriod: string | null | undefined,
  priceAnnual: unknown, cleanType: string | null | undefined): boolean {
  if (isShortStayTable(sourceTableOrSource)) return false;
  // A stated «yearly» — or, since 2026-10-31, a SILENT period — with a per-month-sized figure on a home/business unit.
  // A stated «monthly» is the pool's job (×12 is already stored); any other word is left alone.
  const silent = sourceRentPeriod == null;                      // NULL/absent only — an empty word is not silent
  if (!silent && String(sourceRentPeriod).trim().toLowerCase() !== 'annual') return false;
  if (typeof priceAnnual !== 'number' || !Number.isFinite(priceAnnual) || priceAnnual < CHEAP_YEARLY_FROM || priceAnnual >= CHEAP_YEARLY_BELOW) return false;
  return (CHEAP_YEARLY_TYPES_EN as readonly string[]).includes(String(cleanType ?? ''));
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
// dropped (and a row it would not return is never shown). `null` = no period clause. An unpriced row («سعر عند
// الطلب») passes every branch (owner 2026-09-28). Since 2026-10-31 a priced row with NO published period may be in
// the yearly pool (judged from its figure by the index); the yearly / both clauses therefore accept a null raw
// period too — the INDEX decided membership (its rent_period_ar), this clause only keeps the card fetch from
// dropping a row the count already included (10-31: «111 نتيجة» with 21 judged rows the old clause would drop).
export function cardFetchPeriodOr(pool: 'monthly' | 'annual' | 'both', sourceTable: string): string | null {
  const shortStay = isShortStayTable(sourceTable);
  if (pool === 'monthly') return shortStay ? null : 'rent_period.eq.monthly,price_annual.is.null';
  if (pool === 'annual') return shortStay ? 'rent_period.eq.annual,price_annual.is.null' : 'rent_period.in.(monthly,annual),rent_period.is.null,price_annual.is.null';
  return shortStay ? null : 'rent_period.in.(monthly,annual),rent_period.is.null,price_annual.is.null';
}
