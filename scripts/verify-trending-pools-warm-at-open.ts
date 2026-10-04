// THE TRENDING COUNTS ARE LOADING BEFORE THE USER TAPS (owner 2026-10-03: «once the user opens it, the timer is already on»).
// Home warms, at mount, the city pool of the current scope and then the pools one deal press away (Rent only, Buy + Rent,
// Buy only), one at a time. The warm-up uses cityPoolScopeOf(), a copy of the component's own scope derivation: if the
// two drift, the warm-up fills pools nobody reads and the speed-up silently vanishes, so every derivation expression of
// the component must appear, character for character, in the helper.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');

const EXPRS = [
  "validRentPeriod(query.rentPeriod) ?? 'annual'",
  'query.dealCombined ? null : query.deal',
  "effDeal === 'Rent' ? { ...query, rentPeriod } : query",
  'rentPeriodParam(queryForPeriod)',
  'scopeCrossesMacro(query) ? null : (query.category ?? IMPLIED_CATEGORY_DEFAULT)',
  'cohortTypesAr(queryForPeriod)',
  'searchTableScope(queryForPeriod) ?? {}',
  'rpcAllNarrowingParams(queryForPeriod)',
];

function problems(a: string): string[] {
  const bad: string[] = [];
  const helper = /function cityPoolScopeOf\(query: SearchQuery\) \{[\s\S]*?\n}\n/.exec(a)?.[0] ?? '';
  const comp = a.slice(a.indexOf('export default function Home()'));
  if (!helper) return ['cityPoolScopeOf is gone'];
  for (const e of EXPRS) {
    if (!comp.includes(e)) bad.push(`the component no longer derives its scope with «${e}» — update cityPoolScopeOf to match, then this list`);
    if (!helper.includes(e)) bad.push(`cityPoolScopeOf does not use «${e}» (it drifted from the component: warmed pools would never be read)`);
  }
  const warm = /await ensureCityFieldIndex\(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams\)\.catch\(\(\) => null\);[\s\S]*?\}, \[\]\);/.exec(a)?.[0] ?? '';
  if (!warm) return [...bad, 'the warm-up effect is gone'];
  if (!/for \(const sel of \['Rent', 'Both', 'Buy'\] as const\)/.test(warm)) bad.push('the warm-up does not cover every deal selection');
  if (!/await ensureCityFieldIndex\(sc\.effDeal, sc\.rentPeriodTok, sc\.effCategory, sc\.cohortTypes, sc\.af\)/.test(warm)) bad.push('the warm-up does not load the pools (or loads them all at once)');
  if (!/await ensureCityFieldIndex\(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams\)/.test(warm)) bad.push('the warm-up does not wait for the current scope first');
  if (!/for \(const c of topCitiesByListings\(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams\)\)/.test(warm)
    || !/await ensureDistrictOptions\(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope\)/.test(warm)) bad.push('the trending cities\' district lists are not warmed at open (the district field waits after a pick)');
  // the district warm must use the SAME key the field reads: the field's own call
  if (!/ensureDistrictOptions\(citySelected\.cityId, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope\)/.test(a)) bad.push('the district field no longer loads with the arguments the warm-up uses — re-align them');
  return bad;
}

let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

console.log('\nTrending pools warm at open (owner 2026-10-03)\n');
check('helper mirrors the component; warm-up loads the current scope, then each deal selection, one at a time', problems(src));
mustCatch('a helper that drifted from the component', problems(src.replace(/(function cityPoolScopeOf[\s\S]*?)cohortTypesAr\(queryForPeriod\)/, '$1cohortTypesAr(query)')));
mustCatch('a warm-up that skips Buy + Rent', problems(src.replace("['Rent', 'Both', 'Buy'] as const", "['Rent', 'Buy'] as const")));
mustCatch('a warm-up that fires every pool at once', problems(src.replace('await ensureCityFieldIndex(sc.effDeal', 'void ensureCityFieldIndex(sc.effDeal')));
mustCatch('districts not warmed at open', problems(src.replace('await ensureDistrictOptions(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope)', 'void 0')));
mustCatch('a district warm-up on a different key than the field reads', problems(src.replace('await ensureDistrictOptions(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope)', 'await ensureDistrictOptions(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityAfParams)')));
mustCatch('the warm-up removed', problems(src.replace('await ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).catch(() => null);', '')));
console.log(failed ? `\n${failed} FAILED` : '\nAll warm-at-open assertions passed');
process.exit(failed ? 1 : 0);
