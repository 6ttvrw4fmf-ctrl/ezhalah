// Static invariant checks for the District filter field (owner spec 2026-07-18). Mirrors
// verify-city-field.ts: greps the shipped source so the load-bearing rules can't silently regress.
// The District field must: be disabled until a city is chosen, be scoped to the chosen city's
// canonical city_id, clear on EVERY city mutation, drive Top-6 from live counts, autocomplete the
// COMPLETE canonical catalog, and send the district's match_values (all spellings) to search so a
// hamza-twin never loses recall.
//
//   node --experimental-strip-types scripts/verify-district-field.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const locSrc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── Disabled until a city is chosen ────────────────────────────────────────────────────────────
check('District TextInput is editable ONLY when a city is selected', /editable=\{!!citySelected\}/.test(indexSrc));
check('District field is visually disabled until a city is chosen', /!citySelected && \{ opacity/.test(indexSrc));
check('District field never focuses without a city (guarded onPress)', /if \(citySelected\) districtRef\.current\?\.focus\(\)/.test(indexSrc));

// ── Cleared on EVERY city mutation (no cross-city carry-over) ───────────────────────────────────
check('a single clearDistrict() helper exists', /const clearDistrict = \(\) => \{/.test(indexSrc));
// clearDistrict must be called from: city keystroke, city X-clear, Clear-all, and city-select.
check('clearDistrict called on ≥4 city-mutation sites', (indexSrc.match(/clearDistrict\(\)/g) || []).length >= 4);
check('city-select warms THIS city’s districts by city_id', /ensureDistrictOptions\(opt\.cityId\)/.test(indexSrc));
check('editing the district text invalidates a prior pick', /setDistrictText\(v\);[\s\S]{0,240}?setDistrictSelected\(null\)/.test(indexSrc));

// ── Search payload: send match_values (full recall), never the raw normalized token ─────────────
check('onSearch sends districtSelected.matchValues (all spellings)', /districts: districtSelected \? districtSelected\.matchValues : undefined/.test(indexSrc));
check('District is OPTIONAL — undefined when unset (city-only search stays valid)', /: undefined/.test(indexSrc) && /districtSelected \?/.test(indexSrc));

// ── Data source: city_id-scoped RPC, Top-6 from live counts, autocomplete = complete catalog ────
check('district options come from the district_options_ar RPC', /rpc\('district_options_ar', \{ p_city_id: cityId \}\)/.test(locSrc));
check('RPC result carries match_values (twin-safe recall)', /match_values/.test(locSrc));
check('Top-6 = districts with active listings only (listingCount > 0)', /listingCount > 0\)\.slice\(0, k\)/.test(locSrc));
check('autocomplete searches the COMPLETE cached catalog for the city', /export function matchDistrictsByCityId/.test(locSrc));
check('empty focus shows Top-6 via topDistrictsForCityId', /topDistrictsForCityId\(cid, 6\)/.test(indexSrc));
check('typing filters within the chosen city via matchDistrictsByCityId', /matchDistrictsByCityId\(citySelected\.cityId, v\)/.test(indexSrc));

// ── Dropdown shows the Top-6 WITHOUT listing numbers (owner UI request 2026-07-18). Top-6 is still
//    SELECTED by active-listing count (asserted above, in locations.ts), but the count is no longer
//    displayed; every row (incl. zero-listing catalog districts) renders its name unconditionally. ──
check('district dropdown no longer displays the listing count', !/grouped\(opt\.listingCount\)/.test(indexSrc) && !/\{opt\.listingCount\}/.test(indexSrc));
check('every district row renders its name unconditionally (zero-listing districts still selectable)', /<Text style=\{s\.suggCity\}>\{opt\.districtAr\}<\/Text>/.test(indexSrc));

console.log(failed === 0 ? '\n✓ all district-field assertions passed' : `\n✗ ${failed} district-field assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
