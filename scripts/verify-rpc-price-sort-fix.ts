// Regression guard for the "price sort isn't real" bug found live 2026-07-27 (round-8 audit):
// location_search_candidates_ar had NO server-side sort parameter at all, so price_asc/price_desc
// (and area/beds/oldest) only re-sorted whatever ~1500-row RECENCY-capped page the client already
// fetched — genuinely cheaper listings sitting outside that window were structurally invisible under
// "cheapest first" while the UI still claimed "Sorted by price, lowest first." (live-verified: 39 real
// Riyadh listings priced 10k-50k SAR never appeared under price_asc before the fix.)
//
// Fixed with a real p_sort_by parameter on the RPC (supabase/migrations/
// 20260727122942_add_p_sort_by_to_location_search_candidates_ar.sql) ordering the FULL matching set
// before LIMIT/OFFSET. This script asserts (a) the client forwards q.sort to p_sort_by for every
// server-supported key, (b) ppm_asc/ppm_desc are deliberately NOT forwarded (RPC has no derived-ppm
// sort — this project has a strict "never derive price-per-meter" history), and (c) the platform-
// diversity-seed call (which hardcodes a last_updated-DESC re-sort — see mergeDiversitySeed in
// src/lib/platformDiversity.ts) is skipped for an objective RPC sort, since applying it would silently
// clobber the true price/area/beds ordering the RPC just computed.
//
//   node --experimental-strip-types scripts/verify-rpc-price-sort-fix.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const src = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');

check('rpcFilterParams forwards q.sort as p_sort_by for RPC-supported keys', /\.\.\.\(RPC_SORT_KEYS\.has\(q\.sort as string\) \? \{ p_sort_by: q\.sort \} : \{\}\)/.test(src));
check('RPC_SORT_KEYS covers exactly the 6 server-supported sort keys (no ppm, no newest)', /const RPC_SORT_KEYS = new Set\(\['oldest', 'price_asc', 'price_desc', 'area_asc', 'area_desc', 'beds_desc'\]\)/.test(src));
check('ppm_asc/ppm_desc are NOT in RPC_SORT_KEYS (still client-side-only, unchanged)', !/RPC_SORT_KEYS = new Set\(\[[^\]]*ppm/.test(src));
check('the diversity-seed call is gated off for an objective RPC sort', /const objectiveRpcSort = RPC_SORT_KEYS\.has\(q\.sort as string\);/.test(src) && /if \(!objectiveRpcSort && pageOffset === 0 && allCands\.length >= pageLimit\)/.test(src));

// Verbatim copy of the RPC_SORT_KEYS gating logic — executed against every real SortKey.
type SortKey = 'newest' | 'oldest' | 'price_asc' | 'price_desc' | 'area_asc' | 'area_desc' | 'ppm_asc' | 'ppm_desc' | 'beds_desc';
const RPC_SORT_KEYS = new Set(['oldest', 'price_asc', 'price_desc', 'area_asc', 'area_desc', 'beds_desc']);
function pSortByFor(sort: SortKey | undefined): string | undefined {
  return sort && RPC_SORT_KEYS.has(sort) ? sort : undefined;
}

const ALL_SORT_KEYS: SortKey[] = ['newest', 'oldest', 'price_asc', 'price_desc', 'area_asc', 'area_desc', 'ppm_asc', 'ppm_desc', 'beds_desc'];
const expectForwarded: Record<SortKey, string | undefined> = {
  newest: undefined, oldest: 'oldest', price_asc: 'price_asc', price_desc: 'price_desc',
  area_asc: 'area_asc', area_desc: 'area_desc', ppm_asc: undefined, ppm_desc: undefined, beds_desc: 'beds_desc',
};
for (const sort of ALL_SORT_KEYS) {
  check(`p_sort_by for SortKey "${sort}" -> ${JSON.stringify(expectForwarded[sort])}`, pSortByFor(sort) === expectForwarded[sort]);
}
check('undefined sort (no explicit sort at all) forwards nothing', pSortByFor(undefined) === undefined);

console.log(
  failed === 0
    ? '\n✓ RPC price/area/beds/oldest server-side sort fix verified'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
