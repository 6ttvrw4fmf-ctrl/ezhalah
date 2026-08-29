// THE SEARCH REQUEST, SERIALIZED THE WAY THE APP SERIALIZES IT.
//
// The daily RPC coverage layer fires `location_search_candidates_ar` directly, so it must build the
// SAME request body the real client builds. Every trap in SEARCH_MATCH_QA_ENGINEER.md §41 that ever
// produced a false "product defect" came from a harness that guessed one of these fields:
//
//   §41.6  p_tables differs per نوع, and the two monthly-only sources attach only on a search whose
//          period scope includes monthly. Guessing it under-counted five searches.
//   §41.10 «شراء» serialises as p_deal:'بيع'. Feeding the UI label makes every Buy search read 0.
//   §41.11 (p_cities, p_region_ids) must be a CONSISTENT pair — the RPC ANDs them.
//   §41.14 p_types2 is NOT the cohort's type list (the overlay excludes «عمارة»), and p_category is
//          ALWAYS sent. Omitting either invented three COUNT_MISMATCH verdicts on «عمارة سكنية».
//   §41.16 A city NAME does not identify a city — 290 are ambiguous across regions. Resolve the
//          region through the row's own city_id.
//   §41.17 Buy+Rent COMBINED is a THIRD way into the monthly pool: it serialises as p_deal:null AND
//          p_rent_period:null, and its Rent side accepts Monthly unconditionally.
//
// So: the COHORT and TABLE facts are HARVESTED (ops_qa_cohort_catalog(), fed by real browser
// requests — never a hardcoded list, §1); the SERIALIZATION RULES live here, mirroring
// src/data/remote.ts, where `scripts/verify-qa-coverage-planner.ts` can prove them offline.
//
// Mirrors, by name, so a reader can diff them:
//   resTables()        src/data/remote.ts  — the monthly-only attach rule
//   rentPeriodParam()  src/data/remote.ts  — 'كلاهما' is NOT null
//   resolveSearchScope() / impliedCategory()  — p_types2 / p_tables2 / p_category

/** The RPC's page limit, matching the client's own. An ID-set hash is only meaningful at or below it. */
export const PAGE_LIMIT = 1500;

/** «عمارة» in a COMMERCIAL table is a Commercial Building, so the residential overlay excludes it. */
const OVERLAY_EXCLUDED_TYPE_AR = 'عمارة';

/**
 * @param {object} cohort  one row of ops_qa_cohort_catalog()
 * @param {object} s       the search: { deal, period, combined, city, regionId, districts,
 *                                       priceMin, priceMax, areaMin, areaMax, beds, bedsMin, sort }
 */
export function buildRequest(cohort, s) {
  if (!cohort) throw new Error('buildRequest: no cohort');

  // ── p_tables — resTables(): the monthly-only sources attach when the period scope includes
  //    monthly AND the search reads residential-kind tables. dealCombined ALWAYS wants monthly:
  //    combined mode has no period selector, so its Rent side accepts Monthly unconditionally.
  const wantsMonthly = !!s.combined || s.period === 'شهري' || s.period === 'كلاهما';
  const isRent = !!s.combined || s.deal === 'إيجار';
  const monthly = cohort.scope_monthly_tables;
  const tables = (isRent && wantsMonthly && monthly?.length) ? monthly : cohort.scope_tables;

  // ── p_tables2 / p_types2 — the residential misfile-recovery overlay (§41.14).
  let p_tables2 = null, p_types2 = null;
  if (cohort.scope2 && cohort.scope2_tables?.length) {
    const overlayTypes = cohort.types_ar.filter((t) => t !== OVERLAY_EXCLUDED_TYPE_AR);
    const overlayTables = cohort.scope2_tables.filter((t) => !tables.includes(t));
    if (overlayTypes.length && overlayTables.length) { p_types2 = overlayTypes; p_tables2 = overlayTables; }
  }

  return {
    // §41.10 — the SERIALIZED value, never the Arabic UI label of the control.
    // §41.17 — combined mode sends null for BOTH, the same shape as bothDeals.
    p_deal: s.combined ? null : (s.deal ?? null),
    p_rent_period: (s.combined || s.deal !== 'إيجار') ? null : (s.period ?? null),
    p_cities: s.city ? [s.city] : null,
    p_districts: s.districts?.length ? s.districts : null,
    p_tables: tables,
    p_platforms: null,
    // §41.11 / §41.16 — the region comes from the SAME catalog row the city name came from.
    p_region_ids: s.regionId != null ? [s.regionId] : null,
    p_category: cohort.macro,           // §41.14 — always sent; the RPC's category-purity gate.
    p_tables2, p_types2,
    p_types: cohort.types_ar,
    p_beds_exact: s.beds?.length ? s.beds : null,
    p_beds_min: s.bedsMin ?? null,
    p_price_min: s.priceMin ?? null,
    p_price_max: s.priceMax ?? null,
    p_area_min: s.areaMin ?? null,
    p_area_max: s.areaMax ?? null,
    p_per_platform: null,
    p_limit: s.limit ?? PAGE_LIMIT,
    p_offset: s.offset ?? 0,
    ...(s.sort ? { p_sort_by: s.sort } : {}),
  };
}

/** The canonical ledger key for one coverage cell. One key space, so staleness is comparable. */
export const cohortKey = (s) =>
  [s.uiType, s.combined ? 'كلاهما-عملية' : s.deal, s.combined ? '' : (s.period ?? ''), s.city].join('|');
