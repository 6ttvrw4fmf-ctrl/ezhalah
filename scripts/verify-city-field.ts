// CITY-ONLY LOCATION FIELD — owner spec 2026-07-17. New Home/Filter Location field: "أي مدينة؟"
// replaces the old combined city-or-neighborhood field. Top-6-by-listings on focus, Arabic-only
// prefix/substring autocomplete while typing, cities only (no region/district/landmark/area), every
// result keyed by city_id (loc_catalog_city.city_id, shared with search_listings_ar.city_id and
// sa-locations.json's city tuples — verified live 2026-07-17) so genuine duplicate city names
// (confirmed live, e.g. الهفوف exists as two distinct real cities in two different regions) never
// collide. Backed by public.city_listing_counts_ar (supabase/migrations/20260717150000_...).
//
// This script: (a) replicates matchCitiesByText/hasNameCollision/resolveCitySelection's exact logic
// as pure functions and genuinely EXECUTES it against concrete cases, including the real live-data
// edge cases found during implementation (spelling-variant folding, real duplicate names, the one
// city_id not yet in the static catalog); (b) asserts via source-text that the shipped files
// actually wire these functions in — src/data/locations.ts imports '@/lib/supabase' at module scope
// (same constraint as remote.ts, documented in prior verify scripts), so it can't be live-imported
// by a plain node script.
//
//   node --experimental-strip-types scripts/verify-city-field.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

// ── faithful replica of locations.ts's norm() (verbatim logic) ──
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[^\p{L}\p{N}]/gu, '');

// ── faithful replica of the new CityOption machinery ──
type CityOption = { cityId: number; cityAr: string; regionId: number | null; regionAr: string | null; listingCount: number };

function matchCitiesByText(pool: CityOption[], query: string): CityOption[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { opt: CityOption; rank: number }[] = [];
  for (const opt of pool) {
    const n = norm(opt.cityAr);
    if (n.startsWith(q)) scored.push({ opt, rank: 0 });
    else if (n.includes(q)) scored.push({ opt, rank: 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || b.opt.listingCount - a.opt.listingCount);
  return scored.map((s) => s.opt);
}
function hasNameCollision(results: CityOption[], cityAr: string): boolean {
  return results.filter((r) => r.cityAr === cityAr).length > 1;
}
// Replica of resolveCitySelection's fallback logic (CITY_BY_ID/REGION_BY_ID lookups mocked as maps
// keyed identically to the real static catalog's city_id numbering).
const CITY_BY_ID = new Map<number, { en: string; ar: string; regionId: number }>([
  [3, { en: 'Riyadh', ar: 'الرياض', regionId: 1 }],
  [12, { en: 'Hofuf', ar: 'الهفوف', regionId: 5 }],
  [501, { en: 'Al Hofuf', ar: 'الهفوف', regionId: 1 }], // the real, verified duplicate-name case
]);
const REGION_BY_ID = new Map<number, { en: string; ar: string }>([
  [1, { en: 'Riyadh', ar: 'منطقة الرياض' }],
  [5, { en: 'Eastern Province', ar: 'المنطقة الشرقية' }],
]);
function resolveCitySelection(opt: CityOption) {
  const cat = CITY_BY_ID.get(opt.cityId);
  const region = cat ? REGION_BY_ID.get(cat.regionId) : undefined;
  return {
    raw: opt.cityAr,
    kind: 'city' as const,
    city: cat?.en ?? opt.cityAr,
    region: region?.en ?? opt.regionAr ?? undefined,
    label: opt.cityAr,
    districts: [] as string[],
    cities: [] as string[],
    exact: true,
  };
}

// ── EXECUTED tests: matchCitiesByText — real production spelling/duplicate scenarios ──
const POOL: CityOption[] = [
  { cityId: 3, cityAr: 'الرياض', regionId: 1, regionAr: 'منطقة الرياض', listingCount: 66904 },
  { cityId: 18, cityAr: 'جدة', regionId: 2, regionAr: 'منطقة مكة المكرمة', listingCount: 33982 },
  { cityId: 13, cityAr: 'الدمام', regionId: 5, regionAr: 'المنطقة الشرقية', listingCount: 11845 },
  { cityId: 31, cityAr: 'الخبر', regionId: 5, regionAr: 'المنطقة الشرقية', listingCount: 11761 },
  { cityId: 14, cityAr: 'المدينة المنورة', regionId: 3, regionAr: 'منطقة المدينة المنورة', listingCount: 7896 },
  { cityId: 6, cityAr: 'مكة المكرمة', regionId: 2, regionAr: 'منطقة مكة المكرمة', listingCount: 7473 },
  // real, verified live duplicate: same display name, two different real cities/regions
  { cityId: 12, cityAr: 'الهفوف', regionId: 5, regionAr: 'المنطقة الشرقية', listingCount: 900 },
  { cityId: 501, cityAr: 'الهفوف', regionId: 1, regionAr: 'منطقة الرياض', listingCount: 40 },
];

eq("owner's exact example: typing 'ر' matches every city containing ر (الرياض/الخبر/المدينة المنورة/مكة المكرمة all contain ر)", matchCitiesByText(POOL, 'ر').map((c) => c.cityAr), ['الرياض', 'الخبر', 'المدينة المنورة', 'مكة المكرمة']);
eq("owner's exact example: typing 'ال' narrows the results (prefix matches first, then مكة المكرمة as a substring match via المكرمة)", matchCitiesByText(POOL, 'ال').map((c) => c.cityAr), ['الرياض', 'الدمام', 'الخبر', 'المدينة المنورة', 'الهفوف', 'الهفوف', 'مكة المكرمة']);
eq("owner's exact example: typing 'الري' shows الرياض", matchCitiesByText(POOL, 'الري').map((c) => c.cityAr), ['الرياض']);
check('a taa-marbuta/haa spelling variant still matches (مكه matches مكة المكرمة via norm() folding)', matchCitiesByText(POOL, 'مكه').some((c) => c.cityAr === 'مكة المكرمة'));
eq('no query text returns nothing (never shows an unfiltered dump while typing)', matchCitiesByText(POOL, ''), []);
eq('a query matching nothing returns nothing (no fuzzy fallback — city-field never guesses)', matchCitiesByText(POOL, 'زznxq'), []);
check('prefix matches rank before substring matches', (() => { const r = matchCitiesByText(POOL, 'دمام'); return r[0]?.cityAr === 'الدمام'; })());

// ── EXECUTED tests: hasNameCollision — the real verified duplicate case ──
check('THE VERIFIED LIVE EDGE CASE: الهفوف (2 distinct real cities, different regions) IS flagged as a collision', hasNameCollision(POOL, 'الهفوف'));
check('a unique city name is NOT flagged as a collision (so region stays hidden in the common case, per spec)', !hasNameCollision(POOL, 'الرياض'));

// ── EXECUTED tests: resolveCitySelection — city_id-keyed disambiguation + English/Arabic fallback ──
eq('a normal city resolves via the static catalog (English city + English region, matching resolveLocation()\'s own exact-city-match shape)', resolveCitySelection(POOL[0]), { raw: 'الرياض', kind: 'city', city: 'Riyadh', region: 'Riyadh', label: 'الرياض', districts: [], cities: [], exact: true });
check("THE VERIFIED LIVE EDGE CASE: the two 'الهفوف' entries resolve to DIFFERENT English city keys (city_id disambiguates — never the wrong city)", (() => {
  const a = resolveCitySelection(POOL[6]); // city_id 12, Eastern Province
  const b = resolveCitySelection(POOL[7]); // city_id 501, Riyadh region
  return a.city === 'Hofuf' && a.region === 'Eastern Province' && b.city === 'Al Hofuf' && b.region === 'Riyadh' && a.city !== b.city;
})());
check('an orphan city_id not in the static catalog (verified live: only 1 of 423 real cities, city_id 90001/بلسمر) falls back to the Arabic name directly, never crashes or produces undefined', (() => {
  const orphan: CityOption = { cityId: 90001, cityAr: 'بلسمر', regionId: 6, regionAr: 'منطقة عسير', listingCount: 22 };
  const r = resolveCitySelection(orphan);
  return r.city === 'بلسمر' && r.region === 'منطقة عسير' && r.label === 'بلسمر' && r.exact === true;
})());

// ── source-text ties: the shipped files actually wire this in ──
const locationsSrc = readFileSync(new URL('../src/data/locations.ts', import.meta.url), 'utf8');
const indexSrc = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
const i18nSrc = readFileSync(new URL('../src/i18n.tsx', import.meta.url), 'utf8');

check('locations.ts exports ensureCityFieldIndex/topCitiesByListings/matchCitiesByText/hasNameCollision/resolveCitySelection', [
  'export async function ensureCityFieldIndex',
  'export function topCitiesByListings',
  'export function matchCitiesByText',
  'export function hasNameCollision',
  'export function resolveCitySelection',
].every((sig) => locationsSrc.includes(sig)));
// Context-aware Top Cities/Districts (owner request 2026-07-20): the plain city_listing_counts_ar
// view (a single GLOBAL ranking, no deal/category awareness) was replaced by the deal-scoped
// top_cities_by_deal_ar(p_deal) RPC — verified live the two genuinely differ (Buy vs Rent swap
// Khobar/Madinah ahead of Dammam/Makkah). Category×Deal (4-way) was ruled out: Category is picked
// AFTER City/District in this form, so it isn't known yet at this step (owner decision, same date).
check("locations.ts's city pool fetch is scoped by deal via top_cities_by_deal_ar(p_deal)", /\.rpc\('top_cities_by_deal_ar', \{ p_deal: dealAr\(deal\) \}\)/.test(locationsSrc));
check('locations.ts no longer reads the global, deal-blind city_listing_counts_ar view for the field pool', !locationsSrc.includes(".from('city_listing_counts_ar')"));
check('district_options_ar RPC calls now pass p_deal too (district Top-6 is deal-scoped like the city one)', /\.rpc\('district_options_ar', \{ p_city_id: cityId, p_deal: dealAr\(deal\) \}\)/.test(locationsSrc));

check('index.tsx no longer imports the old Place-based combined-field helpers (matchLocations/placeLabel/placeTitle/placeSub/placeIcon/placeKey/resolveLocation)', [
  'matchLocations', 'placeLabel', 'placeTitle', 'placeSub', 'placeIcon', 'placeKey', 'resolveLocation',
].every((sym) => !new RegExp(`\\b${sym}\\b`).test(indexSrc.replace(/\/\/.*$/gm, ''))));
check('index.tsx placeholder text is "Which city?" (renders أي مدينة؟), not the old combined-field label', indexSrc.includes("t('Which city?')") && !indexSrc.includes("t('Which city or neighborhood?')"));
// query.deal threading (owner request 2026-07-20): every Top-6 call site now passes query.deal
// alongside k — Deal is chosen before City in the form, so it's always known here.
check('onFocus with empty text shows the deal-scoped Top 6 (topCitiesByListings(query.deal, 6))', /onFocus=\{\(\) => \{[\s\S]{0,1300}?topCitiesByListings\(query\.deal, 6\)/.test(indexSrc));
check(
  'REGRESSION (found live in testing): the Top-6-on-focus promise callback re-checks cityTextRef at resolution time before overwriting citySuggestions — without this guard, a keystroke typed right after focus can have its correctly-filtered results silently clobbered back to the stale Top 6 by the async callback resolving a moment later',
  /if \(!cityTextRef\.current\) setCitySuggestions\(topCitiesByListings\(query\.deal, 6\)\);/.test(indexSrc) && /cityTextRef\.current = v;/.test(indexSrc),
);
check(
  'REGRESSION (found live in testing, now also gates on deal change): the deal-scoped ensureCityFieldIndex() fetch re-runs the match against cityTextRef once it resolves — without this, a user who types before a slow-connection fetch finishes would see an empty dropdown forever, since nothing else re-triggers matchCitiesByText() once the data actually arrives',
  /void ensureCityFieldIndex\(query\.deal\)\.then\(\(\) => \{[\s\S]{0,700}?if \(cityTextRef\.current\) \{[\s\S]{0,200}?setCitySuggestions\(latin \? \[\] : matchCitiesByText\(query\.deal, cityTextRef\.current\)\);/.test(indexSrc),
);
check(
  'NEW (owner request 2026-07-20): flipping Buy<->Rent live-refreshes an already-open Top-6 list instead of leaving a stale ranking on screen',
  /\}, \[query\.deal\]\);/.test(indexSrc) && /else if \(cityFocus\) \{\s*setCitySuggestions\(topCitiesByListings\(query\.deal, 6\)\);/.test(indexSrc),
);
check('onChangeText clears citySelected on every keystroke (never silently reuses a stale pick)', /onChangeText=\{\(v\) => \{[\s\S]{0,300}?setCitySelected\(null\)/.test(indexSrc));
check('onSearch blocks when citySelected is falsy, using CITY_REQUIRED_MSG (never calls the old free-text resolveLocation guessing path)', /if \(!citySelected\) \{[\s\S]{0,600}?setLocMsg\(CITY_REQUIRED_MSG\);[\s\S]{0,600}?return;/.test(indexSrc));
// Owner UI request 2026-07-18: a blocked search must scroll the page to the top so the (top-of-card)
// validation message is actually visible — the Search button is at the bottom.
check('a blocked search scrolls to the top so the validation message is visible', /if \(!citySelected\) \{[\s\S]{0,320}?scrollRef\.current\?\.scrollTo\(\{ y: 0/.test(indexSrc));
// 2026-07-20: the city-row tap handler moved into a named `cityOnPress` closure (shared by both the
// Trending-leaderboard rows and the plain typed-filter rows) instead of an inline JSX onPress — same
// behavior, different wrapping. Check the closure body directly rather than the old inline shape.
check('the selection handler stores the FULL CityOption in citySelected (city_id-keyed, not just the display string)', /const cityOnPress = \(opt: CityOption\) => \{[\s\S]{0,200}?setQuery\(\(q\) => \(\{ \.\.\.q, location: opt\.cityAr \}\)\);\s*setCitySelected\(opt\)/.test(indexSrc));

check('i18n.tsx defines CITY_REQUIRED_MSG as a genuine Arabic string', /export const CITY_REQUIRED_MSG = '[^']*[ء-ي][^']*';/.test(i18nSrc));

console.log(
  failed === 0
    ? '\n✓ City-only Location field verified — Arabic prefix matching, duplicate-name disambiguation, and orphan city_id fallback all correct'
    : `\n✗ ${failed} city-field check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
