// ONE spelling of the rent pools for every independent oracle (2026-11-13).
//
// Migration 20261111141500 scoped the price-on-request arm of «سنوي» to rows NOT in the short-stays pool
// (rent_period_ar distinct from 'شهري'): Haraj's daily/weekly rents carry no price by owner order (backlog 1744)
// and joined «إقامات قصيرة». scripts/lib/afOracleFilter.ts learned it; four hand-copied oracles
// (verify-trending-filter-state-live.ts, verify-strict-filter-parity-live.ts, e2e/live-sweep/journeys.mjs and
// sweep.mjs) did not, and read ~740 Haraj short stays as a yearly-count gap (af-live-truth-check 43424461595:
// top_cities 16109 vs «independent» 16110, strict parity 139127 vs 139858) — the product was right.
// Every oracle builds the pools from HERE; scripts/verify-oracle-rent-pool-is-one-spelling.ts fails on a copy.

/** PostgREST `or=` body (without the `or=` prefix) for the yearly pool «سنوي». `encode=false` keeps raw Arabic. */
export function annualPoolOr(encode = true) {
  const e = encode ? encodeURIComponent : (x) => x;
  return `(rent_period_ar.eq.${e('سنوي')},and(rent_period_ar.eq.${e('شهري')},rent_now_pay_later.is.true),`
    + `and(price_annual.is.null,or(rent_period_ar.is.null,rent_period_ar.neq.${e('شهري')})))`;
}

/** PostgREST `or=` body for the short-stays pool «شهري» («إقامات قصيرة»). */
export function monthlyPoolOr() {
  return '(and(payment_monthly.is.true,rent_now_pay_later.not.is.true),and(price_annual.is.null,platform.in.(gathern,aqarmonthly)))';
}

/** PostgREST `or=` body for BOTH periods «كلاهما»: the union of the two single-period arms (never «no filter»). */
export function bothPoolOr(encode = true) {
  const e = encode ? encodeURIComponent : (x) => x;
  return `(payment_monthly.is.true,rent_period_ar.eq.${e('سنوي')},and(rent_period_ar.eq.${e('شهري')},rent_now_pay_later.is.true),`
    + `and(price_annual.is.null,or(rent_period_ar.is.null,rent_period_ar.neq.${e('شهري')})))`;
}
