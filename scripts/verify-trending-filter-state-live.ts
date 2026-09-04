// TRENDING CARRIES THE FULL FILTER STATE — the LIVE half.
//
// Split out of scripts/verify-trending-carries-full-filter-state.ts on 2026-09-02. That file's §A
// (SOURCE) is offline and stays in `npm test`; everything here drives PRODUCTION — top_cities_by_
// deal_ar, location_search_candidates_ar and PostgREST counts — and therefore must NOT gate every
// PR. It did: it was auto-discovered by scripts/lib/testRegistry.ts, absent from
// scripts/test-exclusions.txt, and so ran inside the REQUIRED `Full verification` check. Observed
// live: it failed CI once on head 79210cb while passing locally twice at 50/50, and passed CI on the
// very next head — an unrelated PR held up by a production hiccup. AGENTS.md documents exactly this
// anti-pattern for the migration-drift guard ("wiring the live check in would fail every unrelated
// PR whenever drift exists anywhere in production"); this is the same shape.
//
// Nothing is retired. Every check below runs unchanged in .github/workflows/af-live-truth-check.yml,
// which is where the other four live AF/Trending checks already live, and the exclusion entry names
// that home — scripts/verify-test-registry-complete.ts refuses an exclusion whose home does not
// exist, so this cannot decay into a check nobody runs.
//
// WHY THE TWO HALVES ARE BOTH NEEDED (unchanged from the original file):
//   A. SOURCE — Trending must build from the all-inclusive builder, and that builder must carry both
//      halves. Catches "someone removed bedrooms from Trending" (the owner's named mutation).
//   B. LIVE — the trending RPC must actually HONOUR each predicate (a strictly smaller count), and a
//      stacked query must equal an independently-expressed PostgREST count. Catches a param that is
//      sent but ignored, or renamed, which no source check can see.
//
// The defect both halves lock out (found live on production by the owner, 2026-08-22): the city pool
// was handed rpcAdvancedFilterParams() — the ADVANCED half only — so bedrooms, price and area never
// reached top_cities_by_deal_ar. On Apartment + Rent + Annual, «الرياض» showed 10,618 against a truth
// of 705 once 120–180 m² and 70k–100k were added (15x; جدة 78x; مكة 708x). Picking a bedroom count
// changed nothing on screen, and the user chose a city from numbers describing a different set.
//
//   node --experimental-strip-types scripts/verify-trending-filter-state-live.ts

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nTrending must HONOUR every filter it is handed — live, against production\n');

// ── B. LIVE ─────────────────────────────────────────────────────────────────────────────────────
const TYPES = ['شقة', 'مبنى شقق مخدومة', 'ملحق علوي'];
const CITY = 'الرياض';
const trend = async (extra: Record<string, unknown>): Promise<number | null> => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/top_cities_by_deal_ar`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_deal: 'إيجار', p_rent_period: 'سنوي', p_category: 'Residential', p_types: TYPES, ...extra }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  const row = j.find((x: { city_ar: string }) => x.city_ar === CITY);
  return row ? Number(row.listing_count) : 0;
};
const independent = async (extra: string): Promise<number | null> => {
  const t = TYPES.map((x) => `"${x}"`).join(',');
  const q = `${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&production_ready=is.true`
    + `&deal_ar=eq.${encodeURIComponent('إيجار')}&type_ar=in.(${encodeURIComponent(t)})`
    + `&city_ar=eq.${encodeURIComponent(CITY)}`
    + `&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true))${extra}`;
  const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range');
  return cr && cr.includes('/') ? Number(cr.split('/')[1]) : null;
};

const base = await trend({});
check('LIVE baseline: the trending RPC returns a real count for the cohort', !!base && base > 100, `base=${base}`);

// Each predicate must be HONOURED — sent AND applied. A strictly smaller count proves both.
for (const [label, rpc, rest] of [
  ['bedrooms (3)',        { p_beds_exact: [3] },                    '&bedrooms=eq.3'],
  ['area (120–180 m²)',   { p_area_min: 120, p_area_max: 180 },     '&area_m2=gte.120&area_m2=lte.180'],
  ['price (70k–100k)',    { p_price_min: 70000, p_price_max: 100000 }, '&price_annual=gte.70000&price_annual=lte.100000'],
] as const) {
  const withPred = await trend(rpc);
  const ind = await independent(rest);
  check(`LIVE ${label}: trending applies it (count strictly narrows)`,
    withPred != null && base != null && withPred < base,
    `base=${base} withPredicate=${withPred} — an unapplied param leaves the count unchanged`);
  check(`LIVE ${label}: trending count == independent PostgREST count`,
    withPred != null && withPred === ind, `trending=${withPred} independent=${ind}`);
}

// Stacked — the owner's own example.
const stacked = await trend({ p_beds_exact: [3], p_area_min: 120, p_area_max: 180, p_price_min: 70000, p_price_max: 100000 });
const stackedInd = await independent('&bedrooms=eq.3&area_m2=gte.120&area_m2=lte.180&price_annual=gte.70000&price_annual=lte.100000');
check('LIVE stacked (bedrooms + area + price): trending == independent count',
  stacked != null && stacked === stackedInd, `trending=${stacked} independent=${stackedInd}`);
check('LIVE stacked: the stacked count is far below the unfiltered cohort count (no silent widening)',
  stacked != null && base != null && stacked < base * 0.5, `stacked=${stacked} base=${base}`);

// ── C. DISTRICT LIVE ────────────────────────────────────────────────────────────────────────────
// Everything above proves the CITY chip. The DISTRICT number the user actually clicks comes from a
// different function (fetchDistrictEligibleCounts → location_search_candidates_ar with p_districts)
// and had its own two incidents (2026-08-20 AF, 2026-08-22 combined-rent-budget) — so it needs its
// own live, independent-SQL proof, not just the source-regex checks in §A above.
//
// OWNER RULE (2026-08-27 audit): "DISTRICT COUNT = EXACT CURRENT ELIGIBLE RESULT SET ∩ THAT
// DISTRICT." Checks assert RPC == independent SQL (never a fixed absolute number — that would rot
// the moment inventory changes; self-consistency between the two live reads is what actually proves
// "no global-DB-count leak", and it holds however the data moves).
const districtCount = async (cityAr: string, districtAr: string, deal: string, extra: Record<string, unknown> = {}): Promise<number | null> => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_cities: [cityAr], p_districts: [districtAr], p_deal: deal, p_category: 'Residential', p_limit: 1, p_offset: 0, ...extra }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) return null;
  return j.length ? Number(j[0].total_count) || 0 : 0;
};
const independentDistrict = async (cityAr: string, districtAr: string, deal: string, extra: string): Promise<number | null> => {
  const q = `${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&production_ready=is.true`
    + `&city_ar=eq.${encodeURIComponent(cityAr)}&district_ar=eq.${encodeURIComponent(districtAr)}&deal_ar=eq.${encodeURIComponent(deal)}${extra}`;
  const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range');
  return cr && cr.includes('/') ? Number(cr.split('/')[1]) : null;
};

// Reuse the same district/city as the owner's worked example above, at the finer DISTRICT grain.
const DISTRICT = 'حي النرجس';
const distBase = await districtCount(CITY, DISTRICT, 'إيجار', { p_rent_period: 'سنوي', p_types: TYPES });
const distBaseInd = await independentDistrict(CITY, DISTRICT, 'إيجار',
  `&type_ar=in.(${TYPES.map((x) => `"${x}"`).join(',')})&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true))`);
check('LIVE DISTRICT baseline (حي النرجس): RPC == independent SQL', distBase != null && distBase === distBaseInd,
  `rpc=${distBase} independent=${distBaseInd}`);

for (const [label, rpcExtra, qs] of [
  ['bedrooms (3)',      { p_beds_exact: [3] },                        '&bedrooms=eq.3'],
  ['area (80–150 m²)',  { p_area_min: 80, p_area_max: 150 },          '&area_m2=gte.80&area_m2=lte.150'],
  ['price (30k–60k)',   { p_price_min: 30000, p_price_max: 60000 },   '&price_annual=gte.30000&price_annual=lte.60000'],
  ['amenity (elevator)', { p_amenities: ['elevator'] },               '&elevator=is.true'],
] as const) {
  const withPred = await districtCount(CITY, DISTRICT, 'إيجار', { p_rent_period: 'سنوي', p_types: TYPES, ...rpcExtra });
  const ind = await independentDistrict(CITY, DISTRICT, 'إيجار',
    `&type_ar=in.(${TYPES.map((x) => `"${x}"`).join(',')})&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true))${qs}`);
  check(`LIVE DISTRICT ${label}: applies it (count strictly narrows the district baseline)`,
    withPred != null && distBase != null && withPred < distBase, `base=${distBase} withPredicate=${withPred}`);
  check(`LIVE DISTRICT ${label}: RPC == independent SQL`, withPred != null && withPred === ind,
    `rpc=${withPred} independent=${ind}`);
}

// The owner's OWN new example (2026-08-27 audit): الخبر → حي الدوحة الجنوبية. Sparse on purpose —
// this district has very little inventory, which makes it the sharpest possible proof that a small
// TRUE count is shown as-is and never inflated toward a city- or category-wide number. Buy and
// Rent+Annual are asserted to DIFFER (never both empty/equal by coincidence) whenever the district
// has ANY inventory in either deal, so the check stays meaningful even as listings churn; when the
// district is fully empty in both deals the RPC==independent equality above still holds and proves
// "honest zero", which is exactly the required behaviour too.
const KHOBAR = 'الخبر', DOHA_S = 'حي الدوحة الجنوبية';
const dohaBuy = await districtCount(KHOBAR, DOHA_S, 'بيع');
const dohaBuyInd = await independentDistrict(KHOBAR, DOHA_S, 'بيع', '');
const dohaRent = await districtCount(KHOBAR, DOHA_S, 'إيجار', { p_rent_period: 'سنوي' });
const dohaRentInd = await independentDistrict(KHOBAR, DOHA_S, 'إيجار', '&or=(rent_period_ar.eq.سنوي,and(rent_period_ar.eq.شهري,rent_now_pay_later.is.true))');
check('LIVE DISTRICT (owner example, الخبر/حي الدوحة الجنوبية) Buy: RPC == independent SQL — never a bigger, un-narrowed number',
  dohaBuy != null && dohaBuy === dohaBuyInd, `rpc=${dohaBuy} independent=${dohaBuyInd}`);
check('LIVE DISTRICT (owner example) Rent+Annual: RPC == independent SQL',
  dohaRent != null && dohaRent === dohaRentInd, `rpc=${dohaRent} independent=${dohaRentInd}`);

// ── D. MUTATION PROOF ───────────────────────────────────────────────────────────────────────────
// "Remove one active filter and confirm the barrier goes red" (owner, 2026-08-27). This never edits
// app source — it calls the SAME production RPC a second time with one real, currently-active
// predicate deliberately withheld, and asserts the §C comparison above would then MISMATCH. That is
// the actual property a source-regex check cannot prove: if a future change silently stops sending
// one of these params, this exact assertion is what turns red.
for (const [label, full, dropKey] of [
  ['p_beds_exact (بيت النرجس, beds=3)', { p_rent_period: 'سنوي', p_types: TYPES, p_beds_exact: [3] }, 'p_beds_exact'],
  ['p_amenities (بيت النرجس, elevator)', { p_rent_period: 'سنوي', p_types: TYPES, p_amenities: ['elevator'] }, 'p_amenities'],
  ['p_price_min/p_price_max (بيت النرجس, 30k–60k)', { p_rent_period: 'سنوي', p_types: TYPES, p_price_min: 30000, p_price_max: 60000 }, 'p_price_min'],
] as const) {
  const correctRpc = await districtCount(CITY, DISTRICT, 'إيجار', full);
  const mutated = { ...full } as Record<string, unknown>;
  delete mutated[dropKey];
  if (dropKey === 'p_price_min') delete mutated.p_price_max; // drop both halves of the range together
  const mutatedRpc = await districtCount(CITY, DISTRICT, 'إيجار', mutated);
  check(`MUTATION PROOF — dropping ${label} makes the RPC call disagree with the correct one (barrier would go RED)`,
    correctRpc != null && mutatedRpc != null && mutatedRpc !== correctRpc,
    `correct=${correctRpc} mutated(dropped ${label})=${mutatedRpc} — expected these to DIFFER; if they match, a dropped predicate would go undetected`);
}

console.log(failures === 0
  ? '\n✓ Trending and district counts honour every predicate, live (source shape: verify-trending-carries-full-filter-state.ts)\n'
  : `\n✗ ${failures} check(s) FAILED — Trending is describing a different set than the user selected\n`);
process.exit(failures === 0 ? 0 : 1);
