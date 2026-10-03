// A USER CAN ALWAYS FIND THE CITY AND DISTRICT HE TYPES, INSTANTLY (owner, 2026-10-03).
//
// «Users should always have the right to search the city and district they're looking for, no matter what they
// want … he shouldn't just wait: he types what he's looking for, and then a number pops up. If it takes time … the
// user can run away.» And: pick a very random place — it must show, with the note that it has nothing right now.
//
// WHAT WAS WRONG (measured in the code, not guessed). matchCitiesByText / matchDistrictsByCityId searched ONLY the
// pool fetched from the database for the user's exact scope (deal × category × period × types × Advanced Filter):
//   • a place with no listings in that scope was not in the pool, so it could not be typed at all;
//   • after any filter change the new scope's pool had to load first, so typing showed nothing («Loading…») for
//     as long as the RPC took.
// THE FIX: the built-in catalog (every city, every district, in memory) answers instantly through the pure
// helpers in src/lib/locationSuggest.ts, appended after the pool's own ranked, counted matches and flagged
// scopeKnown:false while the count is unmeasured (no number, no «nothing here» claim until the pool arrives).
//
// WHAT THIS EXECUTES. The pure helpers, for real, on a catalog fixture: a place absent from the pool is still
// found; pool entries are never duplicated; matching is synchronous and folds the same Arabic spellings as the
// DB; a district is only offered inside its own city. Plus text checks on the two files that wire them in and on
// the TWO search buttons (they must run the same handler, so neither can drift). Each check is mutation-proven:
// the check is run against a deliberately broken copy and must go RED.
//
//   node --experimental-strip-types scripts/verify-location-typeahead-never-hides-a-place.ts
import { readFileSync } from 'node:fs';
import { norm, catalogCityExtras, catalogDistrictExtras, type CatalogCity, type CatalogDistrict } from '../src/lib/locationSuggest.ts';

type Impl = { cityExtras: typeof catalogCityExtras; districtExtras: typeof catalogDistrictExtras };
const REAL: Impl = { cityExtras: catalogCityExtras, districtExtras: catalogDistrictExtras };

const CITIES: CatalogCity[] = [
  { cityId: 1, cityAr: 'الرياض', regionId: 1, regionAr: 'منطقة الرياض' },
  { cityId: 2, cityAr: 'المرافق الخدمية', regionId: 1, regionAr: 'منطقة الرياض' },
  { cityId: 3, cityAr: 'الخبر', regionId: 5, regionAr: 'المنطقة الشرقية' },
  { cityId: 4, cityAr: 'الهفوف', regionId: 5, regionAr: 'المنطقة الشرقية' },
  { cityId: 5, cityAr: 'الهفوف', regionId: 9, regionAr: 'منطقة أخرى' },
  { cityId: 6, cityAr: 'أبها', regionId: 6, regionAr: 'منطقة عسير' },
];
const DISTRICTS: CatalogDistrict[] = [
  { cityId: 1, districtAr: 'النرجس' },
  { cityId: 1, districtAr: 'حي الملقا' },
  { cityId: 3, districtAr: 'الراكة' },
  { cityId: 1, districtAr: 'الأحياء الجنوبية' },
];

/** All the behavioural problems of an implementation, as readable strings. Empty = good. */
function behaviour(impl: Impl): string[] {
  const bad: string[] = [];
  const ids = (xs: CatalogCity[]) => xs.map((c) => c.cityId).join(',');
  // 1. a place the pool does not carry is still found (the whole point)
  if (!impl.cityExtras('مرافق', CITIES, new Set([1, 3])).some((c) => c.cityId === 2))
    bad.push('a city absent from the scoped pool cannot be typed');
  // 2. never duplicates what the pool already shows
  if (impl.cityExtras('الرياض', CITIES, new Set([1])).some((c) => c.cityId === 1))
    bad.push('a city already in the pool is offered twice');
  // 3. prefix matches before substring matches
  const ranked = impl.cityExtras('ها', [
    { cityId: 10, cityAr: 'شهار', regionId: 1, regionAr: null },
    { cityId: 11, cityAr: 'هاشم', regionId: 1, regionAr: null },
  ], new Set());
  if (ids(ranked) !== '11,10') bad.push(`prefix must rank before substring, got ${ids(ranked)}`);
  // 4. same Arabic folding as the database: ة/ه, أ/ا, ى/ي, a missing «ال»
  if (!impl.cityExtras('ابها', CITIES, new Set()).some((c) => c.cityId === 6)) bad.push('«أ» and «ا» are not the same letter to the matcher');
  if (!impl.cityExtras('رياض', CITIES, new Set()).some((c) => c.cityId === 1)) bad.push('typing without «ال» does not find the city');
  // 5. two real cities with one name are BOTH offered (the UI shows the region to tell them apart)
  if (impl.cityExtras('الهفوف', CITIES, new Set()).length !== 2) bad.push('two cities named الهفوف must both be offered');
  // 6. nothing typed → nothing (the Top-6 path is separate), and it is synchronous
  if (impl.cityExtras('', CITIES, new Set()).length !== 0) bad.push('an empty query must return nothing');
  if (impl.cityExtras('خبر', CITIES, new Set()) instanceof Promise) bad.push('matching must be synchronous (no waiting)');
  // 7. a cap, so a two-letter query cannot render thousands of rows
  const many = Array.from({ length: 200 }, (_, i): CatalogCity => ({ cityId: 100 + i, cityAr: `قرية ${i}`, regionId: 1, regionAr: null }));
  if (impl.cityExtras('قريه', many, new Set(), 30).length > 30) bad.push('the catalog extras are not capped');
  // 7b. with no pool anywhere, a name two real cities share is held back (the pool ranks the real one first)
  if (impl.cityExtras('الهفوف', CITIES, new Set(), 30, new Set([norm('الهفوف')])).length !== 0) bad.push('an ambiguous name is not held back while no pool is cached');
  if (!impl.cityExtras('خبر', CITIES, new Set(), 30, new Set([norm('الهفوف')])).some((c) => c.cityId === 3)) bad.push('holding back one ambiguous name also hid an unambiguous city');
  // 7c. a homonym of a city the pool already lists is not offered as a twin row
  if (impl.cityExtras('الهفوف', CITIES, new Set([4]), 30, new Set([norm('الهفوف')])).length !== 0) bad.push('a same-named twin of a listed city is offered');
  // 8. districts: only inside their own city, and not duplicating the pool's names
  const d1 = impl.districtExtras('نرجس', DISTRICTS, 1, new Set());
  if (!d1.some((d) => d.districtAr === 'النرجس')) bad.push('a district of the city cannot be typed');
  if (impl.districtExtras('راكه', DISTRICTS, 1, new Set()).length !== 0) bad.push("another city's district leaked into this city");
  if (impl.districtExtras('نرجس', DISTRICTS, 1, new Set([norm('النرجس')])).length !== 0) bad.push('a district already in the pool is offered twice');
  if (!impl.districtExtras('ملقا', DISTRICTS, 1, new Set()).some((d) => d.districtAr === 'حي الملقا')) bad.push('«حي» in the stored name hides the district');
  return bad;
}

const locSrc = readFileSync(new URL('../src/data/locations.ts', import.meta.url), 'utf8');
const idxSrc = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

/** Wiring problems in the two files that use the helpers, and in the two search buttons. */
function wiring(loc: string, idx: string): string[] {
  const bad: string[] = [];
  const city = /export function matchCitiesByText[\s\S]*?\n}\n/.exec(loc)?.[0] ?? '';
  const dist = /export function matchDistrictsByCityId[\s\S]*?\n}\n/.exec(loc)?.[0] ?? '';
  if (!/catalogCityExtras\(/.test(city)) bad.push('matchCitiesByText no longer adds the built-in catalog');
  if (!/scopeKnown:\s*exactPool !== undefined/.test(city)) bad.push('city extras do not say whether their count is measured (scopeKnown)');
  if (!/for \(const v of CITY_FIELD_POOLS\.values\(\)\)/.test(city)) bad.push('matchCitiesByText does not borrow another scope\'s city names while its own pool loads');
  if (!/borrowed \? \{ \.\.\.s\.opt, listingCount: 0, scopeKnown: false \}/.test(city)) bad.push('borrowed city rows keep another scope\'s count (it would be printed as this scope\'s)');
  if (!/exactPool === undefined \? new Set\(\[\.\.\.AMBIGUOUS_CITY_NAMES, \.\.\.poolNames\]\) : poolNames/.test(city)) bad.push('same-named catalog cities are not held back / a homonym of a listed city is offered as a twin row');
  if (!/borrowed && AMBIGUOUS_CITY_NAMES\.has\(n\)\) continue/.test(city)) bad.push('while the exact pool loads, a borrowed same-named city is shown in ANOTHER scope\'s order (the wrong الهفوف can be first)');
  if (!/catalogDistrictExtras\(/.test(dist)) bad.push('matchDistrictsByCityId no longer adds the built-in catalog');
  if (!/_districtCache\) \{[\s\S]*startsWith\(`\$\{cityId\}:`\)/.test(dist)) bad.push('matchDistrictsByCityId does not borrow another scope\'s names while its own pool loads');
  if (!/scopeKnown:\s*false/.test(dist)) bad.push('borrowed district names are not flagged count-unknown');
  // the UI: unknown counts print nothing; a measured zero says so, for cities too
  if (!/const cityEmpty = opt\.scopeKnown !== false && !\(opt\.listingCount > 0\)/.test(idx)) bad.push('city rows do not mark a measured-empty city');
  if (!/cityEmpty \? <Text style=\{s\.suggEmptyNote\}>\{t\('No listings here right now'\)\}/.test(idx)) bad.push('a city with no listings does not say so');
  if (!/opt\.scopeKnown === false \? false :/.test(idx)) bad.push('a district with an unmeasured count is called empty');
  // BOTH search buttons run the SAME handler (a drifted second button was the owner\'s worry)
  for (const id of ['home-search-button', 'home-filter-search-button']) {
    if (!new RegExp(`testID="${id}"[^>]*onPress=\\{onSearch\\}`).test(idx)) bad.push(`${id} does not run onSearch`);
  }
  return bad;
}

let failed = 0;
const check = (label: string, bad: string[]) => {
  const ok = bad.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '\n        ' + bad.join('\n        ')}`);
};
const mustCatch = (label: string, bad: string[]) => {
  const ok = bad.length > 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  (mutation) catches ${label}${ok ? '' : ' — the check passed a deliberately broken copy'}`);
};

console.log('\nA user can always find the city and district he types — instantly (owner 2026-10-03)\n');
check('the pure matchers: a place outside the scoped pool is found, never duplicated, folded like the DB, capped, synchronous', behaviour(REAL));
check('the wiring: both matchers add the catalog, flag unmeasured counts, the UI says «nothing here» only for a measured zero, both search buttons run onSearch', wiring(locSrc, idxSrc));

// ── mutation proofs: each deliberately broken copy must go RED ──────────────────────────────────────────────
mustCatch('a matcher that only knows the scoped pool', behaviour({ ...REAL, cityExtras: () => [] }));
mustCatch('a matcher that offers the pool\'s own city twice', behaviour({ ...REAL, cityExtras: (q, cat, _have, lim) => catalogCityExtras(q, cat, new Set(), lim) }));
mustCatch('a homonym of a listed city offered as a twin row', wiring(locSrc.replace('...poolNames]) : poolNames', ']) : new Set()'), idxSrc));
mustCatch('a homonym of a listed city offered as a twin row (pure)', behaviour({ ...REAL, cityExtras: (q, cat, have, lim) => catalogCityExtras(q, cat, have, lim) }));
mustCatch('an ambiguous name that is not held back', behaviour({ ...REAL, cityExtras: (q, cat, have, lim) => catalogCityExtras(q, cat, have, lim) }));
mustCatch('a district matcher that ignores the city', behaviour({ ...REAL, districtExtras: (q, cat, _cityId, have, lim) => catalogDistrictExtras(q, cat.map((d) => ({ ...d, cityId: 1 })), 1, have, lim) }));
mustCatch('a catalog fallback that vanished from matchCitiesByText', wiring(locSrc.replace('catalogCityExtras(query', 'noExtras(query'), idxSrc));
mustCatch('a borrowed same-named city shown in another scope\'s order', wiring(locSrc.replace('if (borrowed && AMBIGUOUS_CITY_NAMES.has(n)) continue;', ''), idxSrc));
mustCatch('a city matcher that waits for its own pool', wiring(locSrc.replace('for (const v of CITY_FIELD_POOLS.values())', 'for (const v of [])'), idxSrc));
mustCatch('a borrowed city count printed as this scope\'s', wiring(locSrc.replace('listingCount: 0, scopeKnown: false } : s.opt', 'scopeKnown: false } : s.opt'), idxSrc));
mustCatch('a district matcher that waits for its own pool', wiring(locSrc.replace('k.startsWith(`${cityId}:`)', 'false'), idxSrc));
mustCatch('an unmeasured district count called empty', wiring(locSrc, idxSrc.replace('opt.scopeKnown === false ? false :', '')));
mustCatch('a second search button that stopped running onSearch', wiring(locSrc, idxSrc.replace(/(testID="home-filter-search-button"[^>]*onPress=\{)onSearch\}/, '$1() => {}}')));

console.log(failed ? `\n${failed} FAILED` : '\nAll typeahead assertions passed');
process.exit(failed ? 1 : 0);
