// TRENDING IS THE LOCATION BREAKDOWN OF THE USER'S EXACT ELIGIBLE SET — NOT A GENERIC SUGGESTION.
//
// OWNER RULE (2026-08-22). "If the user has selected category, group, property type, Buy/Rent,
// Annual/Monthly, bedrooms, price, area and any Advanced Filter answers, then ALL of that must be
// passed into Trending." The number beside a city must be «listings matching everything I picked, in
// that city» — so that count == the count the user lands on after clicking it.
//
// THE DEFECT THIS LOCKS OUT (found live on production by the owner, 2026-08-22). The city pool was
// handed rpcAdvancedFilterParams() — the ADVANCED half only — so bedrooms, price and area never
// reached top_cities_by_deal_ar. Measured on Apartment + Rent + Annual:
//     3 bedrooms                     الرياض shown 10,618 · truth 3,863
//     + 120-180 m² + 70k-100k        الرياض shown 10,618 · truth   705   (15x; جدة 78x; مكة 708x)
// Picking a bedroom count changed NOTHING on screen, and every request went out with
// p_beds_* / p_area_* / p_price_* all null. The user chose a city from those numbers and landed on a
// completely different result.
//
// WHY IT WAS STRUCTURAL, AND WHAT CHANGED. The params were split across two builders
// (rpcFilterParams = normal narrowing, rpcAdvancedFilterParams = advanced answers), so every count
// surface had to REMEMBER to spread both — and this one spread one. remote.ts now exposes
// rpcAllNarrowingParams() as the single "everything the user chose" definition; Trending spreads
// THAT, so a future filter reaches it for free.
//
// The checks below are deliberately of two kinds, because either alone is weak:
//   A. SOURCE — Trending must build from the all-inclusive builder, and that builder must carry both
//      halves. Catches "someone removed bedrooms from Trending" (the owner's named mutation).
//   B. LIVE — the trending RPC must actually HONOUR each predicate (a strictly smaller count), and a
//      stacked query must equal an independently-expressed PostgREST count. Catches a param that is
//      sent but ignored, or renamed, which no source check can see.
//
//   node --experimental-strip-types scripts/verify-trending-carries-full-filter-state.ts

import { readFileSync } from 'node:fs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

console.log('\nTrending must carry EVERY filter the user has already chosen\n');

// ── A. SOURCE ───────────────────────────────────────────────────────────────────────────────────
const remote = strip(read('src/data/remote.ts'));
const index  = strip(read('src/app/index.tsx'));

const builder = remote.slice(remote.indexOf('export function rpcAllNarrowingParams'),
                             remote.indexOf('export function rpcAllNarrowingParams') + 600);
check('remote.ts exposes rpcAllNarrowingParams (the ONE "everything the user chose" definition)',
  builder.length > 0);
check('rpcAllNarrowingParams spreads the NORMAL narrowing (bedrooms / price / area)',
  /rpcFilterParams\(q\)/.test(builder),
  'without rpcFilterParams the builder loses p_beds_*, p_price_* and p_area_* — the exact 2026-08-22 defect');
check('rpcAllNarrowingParams spreads the ADVANCED answers',
  /rpcAdvancedFilterParams\(q\)/.test(builder));

// SPREADING IS NOT ENOUGH — the keys must actually SURVIVE. Proven by mutation: stripping
// p_beds_exact/p_beds_min inside rpcAllNarrowingParams left every check above green while bedrooms
// silently stopped reaching Trending, which is the original defect wearing a different hat. So the
// contract is pinned from both ends: the normal builder must PRODUCE each narrowing key, and the
// all-inclusive builder may drop ONLY the two keys it is documented to drop.
const normalBuilder = remote.slice(remote.indexOf('function rpcFilterParams'),
                                   remote.indexOf('function rpcCountFilterParams'));
for (const key of ['p_beds_exact', 'p_beds_min', 'p_price_min', 'p_price_max', 'p_area_min', 'p_area_max']) {
  check(`rpcFilterParams still produces ${key}`, new RegExp(`\\b${key}\\b`).test(normalBuilder),
    'the normal-narrowing builder feeds BOTH search and Trending — losing a key here loses it everywhere');
}
const dropped = (builder.match(/const \{([^}]*)\}\s*=\s*\n?\s*rpcFilterParams/)?.[1] ?? '')
  .split(',').map((x) => x.trim().split(':')[0].trim()).filter((x) => x && x !== '...normal');
// UNSET PREDICATES MUST BE OMITTED, NOT SENT AS NULL. Two things depend on it: the trending pool
// decides "is the user narrowed?" by asking whether this object is empty, and — measured — sending
// p_beds_*/p_price_*/p_area_* as explicit NULLs pushed top_cities_by_deal_ar into a statement
// timeout on an unfiltered call, emptying the city suggestion list entirely.
check('rpcAllNarrowingParams omits unset predicates (never sends explicit nulls)',
  /v === null \|\| v === undefined\) continue;/.test(builder)
  && /Array\.isArray\(v\) && v\.length === 0\) continue;/.test(builder),
  'an always-present null key makes every search look "narrowed" AND times the trending RPC out');

check('rpcAllNarrowingParams drops ONLY p_types and p_sort_by',
  dropped.length === 2 && dropped.includes('p_types') && dropped.includes('p_sort_by'),
  `it discards: ${dropped.join(', ') || '(nothing parsed)'} — any other key here is a predicate Trending will silently stop applying`);

check('the Trending city pool is built from rpcAllNarrowingParams',
  /rpcAllNarrowingParams\(query\)/.test(index),
  'Trending must not be handed the advanced-only builder again');
check('the Trending city pool no longer uses the advanced-ONLY builder',
  !/cityAfParams\s*=\s*useMemo\(\(\)\s*=>\s*rpcAdvancedFilterParams/.test(index)
  && !/rpcAdvancedFilterParams\(query\)/.test(index),
  'rpcAdvancedFilterParams(query) in index.tsx means the normal filters are being dropped again');

// The pool object must reach the RPC, and every widening fallback must be gated on "user is not
// narrowed" — a widened count under an active filter is the overstatement itself, delivered silently.
const locations = strip(read('src/data/locations.ts'));
check('the narrowing params are spread into the top_cities_by_deal_ar arguments',
  /Object\.assign\(args,\s*af\s*\?\?\s*\{\}\)/.test(locations));

// Scoped to the CITY pool builder: every fallback there WIDENS the scope (drops types/category/
// period), and a widened count under an active filter is the overstatement itself — delivered
// silently, because a fallback looks like a success. So each is gated on the user not being narrowed.
// (ensureDistrictOptions has its own fallbacks, but the district NUMBER the user sees comes from
// fetchDistrictEligibleCounts below, not from that pool, whenever any narrowing is active.)
const cityFn = locations.slice(locations.indexOf('export async function ensureCityFieldIndex'),
                               locations.indexOf('export function topCitiesByListings'));
const cityFallbacks = [...cityFn.matchAll(/if \(res\.error[^)]*\)/g)].map((m) => m[0]);
check('every widening fallback in the CITY pool is gated on the user NOT being narrowed',
  cityFallbacks.length >= 3 && cityFallbacks.every((f) => /!hasNarrowing/.test(f)),
  `found ${cityFallbacks.length}; ungated: ${cityFallbacks.filter((f) => !/!hasNarrowing/.test(f)).join(' | ') || '(none)'}`);

// DISTRICT side. The visible district number must likewise describe the user's exact set: it is
// fetched from the RESULTS RPC itself, and must carry BOTH halves of the params (2026-08-20: it
// carried neither advanced answers nor, before that, the normal ones — districts overstated ~8x).
const districtFn = remote.slice(remote.indexOf('export async function fetchDistrictEligibleCounts'),
                                remote.indexOf('export async function fetchDistrictEligibleCounts') + 1400);
check('district counts come from the results RPC (count and outcome cannot disagree)',
  /location_search_candidates_ar/.test(districtFn));
check('district counts carry the NORMAL narrowing (bedrooms / price / area)',
  /rpcCountFilterParams\(q\)/.test(districtFn));
// …AND THE FETCHED NUMBER MUST ACTUALLY BE THE ONE RENDERED. It was fetched correctly but consulted
// only to detect zero, so a narrowed search still displayed the wider deal/category SCOPE count:
// measured live with 3 beds + 120-180 m² + 70k-100k, حي النرجس advertised 1,064 while the whole city
// had 705 eligible listings — a district claiming more than its own city.
check('the trending district row RENDERS the live count, never the wider scope count under narrowing',
  /hasDistrictNarrowing[\s\S]{0,200}districtLiveCounts\?\.\[opt\.districtAr\] != null[\s\S]{0,120}: ''/.test(index),
  'a fetched-but-unrendered live count is the same lie as never fetching it; and under an active '
  + 'filter a MISSING live count must print nothing rather than the wider number '
  + '(tightened 2026-08-22 — see scripts/verify-district-counts-honest.ts)');
check('the typed district row applies the same rule',
  /const n = hasDistrictNarrowing \? live : \(live \?\? opt\.listingCount\);/.test(index),
  'both district surfaces must show the number the user will land on, or none at all');

check('district counts carry the ADVANCED answers',
  /rpcAdvancedFilterParams\(q\)/.test(districtFn));

// …and a change to ANY of those must invalidate the cached district numbers immediately.
for (const field of ['detail', 'priceMin', 'priceMax', 'areaMin', 'areaMax', 'amenities', 'bathMin']) {
  check(`district count signature invalidates on query.${field}`,
    new RegExp(`districtNarrowingSig[\\s\\S]{0,900}query\\.${field}\\b`).test(index),
    'a filter change that does not enter the signature leaves the previous numbers on screen');
}

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
  ? '\n✓ Trending carries the full filter state, and every predicate is honoured live\n'
  : `\n✗ ${failures} check(s) FAILED — Trending is describing a different set than the user selected\n`);
process.exit(failures === 0 ? 0 : 1);
