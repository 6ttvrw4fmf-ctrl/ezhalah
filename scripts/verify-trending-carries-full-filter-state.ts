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
// TWO KINDS OF CHECK, IN TWO FILES (split 2026-09-02 — see below):
//   A. SOURCE — THIS FILE, offline, in `npm test`. Trending must build from the all-inclusive
//      builder, and that builder must carry both halves. Catches "someone removed bedrooms from
//      Trending" (the owner's named mutation).
//   B. LIVE — scripts/verify-trending-filter-state-live.ts. The trending RPC must actually HONOUR
//      each predicate (a strictly smaller count), and a stacked query must equal an independently-
//      expressed PostgREST count. Catches a param that is sent but ignored, or renamed, which no
//      source check can see.
//
// Either alone is weak, so both still run — just not in the same place. §B drives PRODUCTION, and
// while it lived here it was auto-discovered into the REQUIRED `Full verification` check, so a
// production hiccup failed unrelated PRs (observed: red CI on head 79210cb, green locally twice at
// 50/50, green CI on the next head). AGENTS.md documents that exact anti-pattern for the migration-
// drift guard. §B now runs in .github/workflows/af-live-truth-check.yml alongside the other four
// live AF/Trending checks, named as its home in scripts/test-exclusions.txt.
//
//   node --experimental-strip-types scripts/verify-trending-carries-full-filter-state.ts

import { readFileSync } from 'node:fs';

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


console.log(failures === 0
  ? '\n✓ Trending is built from the full filter state (live honouring: verify-trending-filter-state-live.ts)\n'
  : `\n✗ ${failures} check(s) FAILED — Trending is describing a different set than the user selected\n`);
process.exit(failures === 0 ? 0 : 1);
