// THE TRENDING LIST NEVER WAITS FOR THE COUNTS (owner 2026-10-03)
//
// "When a user taps the city field it takes time for the trending to show." Measured on production: the counting
// RPC top_cities_by_deal_ar took 6-14 s on the first tap (the hourly jobs share the database), and the field showed
// «جاري التحميل…» the whole time. The names do not depend on the scope, only the counts do, so the empty-focus list
// shows names at once (borrowed from another scope's pool, or the six cities every scope ranks first) with NO number
// and NO «nothing here» claim, and the real rows replace them when the pool arrives. Same idea as the typed list
// (verify-location-typeahead-never-hides-a-place.ts). What must never come back:
//   - a wait row instead of names while the counts load (cities and districts),
//   - another scope's COUNT printed as this scope's (the 2026-09-23 #648 defect: الرياض overstated 10.6x),
//   - a name two real cities share (الهفوف) offered before the exact pool says which one ranks first.
import { readFileSync } from 'node:fs';

const loc = readFileSync(new URL('../src/data/locations.ts', import.meta.url), 'utf8');
const idx = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

function wiring(l: string, i: string): string[] {
  const bad: string[] = [];
  const top = /export function topCitiesByListings[\s\S]*?\n}\n/.exec(l)?.[0] ?? '';
  const prov = /function provisionalTopCities[\s\S]*?\n}\n/.exec(l)?.[0] ?? '';
  const dist = /export function topDistrictsForCityId[\s\S]*?\n}\n/.exec(l)?.[0] ?? '';
  if (!/if \(pool === undefined\) return provisionalTopCities\(k\)/.test(top)) bad.push('topCitiesByListings returns nothing while its pool loads (the user waits on the counting RPC)');
  if (!/for \(const v of CITY_FIELD_POOLS\.values\(\)\)/.test(prov)) bad.push('the provisional list does not borrow another scope\'s city names');
  if (!/PROVISIONAL_TOP_CITY_NAMES\.flatMap/.test(prov)) bad.push('with no pool cached anywhere the first tap still shows nothing');
  if (!/!AMBIGUOUS_CITY_NAMES\.has\(norm\(c\.cityAr\)\)/.test(prov) || !/if \(AMBIGUOUS_CITY_NAMES\.has\(n\)\) return \[\]/.test(prov)) bad.push('the provisional list can offer a name two real cities share');
  if (!/listingCount: 0, scopeKnown: false/.test(prov)) bad.push('provisional city rows keep another scope\'s count');
  if (!/_districtCache\) \{[\s\S]*startsWith\(`\$\{cityId\}:`\)/.test(dist)) bad.push('the district top list does not borrow the city\'s names while its own pool loads');
  if (!/listingCount: 0, scopeKnown: false/.test(dist)) bad.push('provisional district rows keep another scope\'s count');
  if (!/cityStatus === 'loading' && provisionalOnly\(citySuggestions\) \? null/.test(i)) bad.push('the city field replaces count-free names with a wait row');
  if (!/districtStatus === 'loading' && provisionalOnly\(districtSuggestions\) \? null/.test(i)) bad.push('the district field replaces count-free names with a wait row');
  if (!/rows\.every\(\(r\) => r\.scopeKnown === false\)/.test(i)) bad.push('the wait row is skipped for rows that DO carry another cohort\'s counts (#648)');
  if (!/opt\.scopeKnown === false \? '…' : cohortCountLabel\(opt\.listingCount\),\n\s*\]\.filter\(Boolean\)\.join\(' · '\) \|\| undefined/.test(i)) bad.push('a trending city row prints a count that was not measured, or nothing while it loads');
  if (!/: opt\.scopeKnown === false \? '…'\n\s*: hasDistrictNarrowing/.test(i)) bad.push('a trending district row shows nothing (looks broken) while its count loads');
  // the TAP itself shows rows at once (2026-10-04, live: a scope change then a tap showed «جاري التحميل…» for seconds)
  if (!/const cohort = cityCohortSig;\s*\n(?:\s*\/\/[^\n]*\n)*\s*setCitySuggestions\(topCitiesByListings\(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams\)\);\s*\n\s*void ensureCityFieldIndex/.test(i)) bad.push('tapping the city field waits for the counts before showing any row');
  if (!/const cohort = districtCohortSigOf\(cid\);\s*\n\s*setDistrictSuggestions\(topDistrictsForCityId\(cid, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope\)\);[^\n]*\n\s*void ensureDistrictOptions/.test(i)) bad.push('tapping the district field waits for the counts before showing any row');
  return bad;
}

let failed = 0;
const check = (label: string, bad: string[]) => {
  if (bad.length) failed++;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`);
};
const mustCatch = (label: string, bad: string[]) => {
  if (!bad.length) failed++;
  console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}${bad.length ? '' : ' — the check passed a deliberately broken copy'}`);
};

console.log('\nThe trending list shows names at once; the numbers pop in later (owner 2026-10-03)\n');
check('wiring: names while the counts load, no borrowed counts, no ambiguous names, no wait row', wiring(loc, idx));
mustCatch('a top list that waits for its pool', wiring(loc.replace('if (pool === undefined) return provisionalTopCities(k);', ''), idx));
mustCatch('no names when no pool is cached anywhere', wiring(loc.replace('PROVISIONAL_TOP_CITY_NAMES.flatMap', 'PROVISIONAL_TOP_CITY_NAMES.filter'), idx));
mustCatch('a provisional list that offers an ambiguous name', wiring(loc.replace('if (AMBIGUOUS_CITY_NAMES.has(n)) return [];', ''), idx));
mustCatch('provisional city rows that keep another scope\'s count', wiring(loc.replace(/(function provisionalTopCities[\s\S]*?)listingCount: 0, scopeKnown: false/, '$1scopeKnown: false'), idx));
mustCatch('provisional district rows that keep another scope\'s count', wiring(loc.replace(/(export function topDistrictsForCityId[\s\S]*?)listingCount: 0, scopeKnown: false/, '$1scopeKnown: false'), idx));
mustCatch('a district top list that waits for its pool', wiring(loc.replace(/(export function topDistrictsForCityId[\s\S]*?)key\.startsWith\(`\$\{cityId\}:`\)/, '$1false'), idx));
mustCatch('a city field that shows the wait row over names', wiring(loc, idx.replace("cityStatus === 'loading' && provisionalOnly(citySuggestions) ? null", "false ? null")));
mustCatch('a district field that shows the wait row over names', wiring(loc, idx.replace("districtStatus === 'loading' && provisionalOnly(districtSuggestions) ? null", "false ? null")));
mustCatch('a wait row skipped for another cohort\'s real counts', wiring(loc, idx.replace('rows.every((r) => r.scopeKnown === false)', 'rows.length > 0')));
mustCatch('a trending row that prints an unmeasured count', wiring(loc, idx.replace("opt.scopeKnown === false ? '…' : cohortCountLabel(opt.listingCount)", 'cohortCountLabel(opt.listingCount)')));
mustCatch('a trending district row blank while loading', wiring(loc, idx.replace(/: opt\.scopeKnown === false \? '…'(\n\s*: hasDistrictNarrowing)/, ": false ? '…'$1")));

mustCatch('a city tap that waits for its counts', wiring(loc, idx.replace(/(const cohort = cityCohortSig;\s*\n(?:\s*\/\/[^\n]*\n)*)\s*setCitySuggestions\(topCitiesByListings\([^\n]*\n/, '$1')));
mustCatch('a district tap that waits for its counts', wiring(loc, idx.replace(/(const cohort = districtCohortSigOf\(cid\);\s*\n)\s*setDistrictSuggestions\(topDistrictsForCityId\([^\n]*\n/, '$1')));
console.log(failed ? `\n${failed} FAILED` : '\nAll trending-instant assertions passed');
process.exit(failed ? 1 : 0);
