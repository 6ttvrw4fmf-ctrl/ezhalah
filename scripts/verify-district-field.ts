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
// 2026-07-20: the explicit warm-up call inside the city-row onPress was removed — it's now handled
// by a [query.deal, query.category, citySelected] effect (also the mechanism that live-refreshes
// District's Top-6 on a Buy<->Rent flip AND on a later Residential<->Commercial pick — Category is
// chosen after District in this form, but the owner asked District to refresh retroactively once it's
// known, rather than reordering the form), so the warm-up fires once per real scope change instead
// of duplicating a fetch the effect would immediately re-trigger anyway. Extended 2026-07-21
// (PR#167/#175, LIVE) to also thread paymentMonthly (Rent's Monthly/Yearly toggle), so the same
// effect/warm-up also live-refreshes District's Top-6 on a Monthly<->Yearly flip.
check('city-select (via citySelected) warms THIS city’s districts by city_id, Category+Deal+period-scoped', /useEffect\(\(\) => \{\s*if \(!citySelected\) return;\s*const cid = citySelected\.cityId;\s*void ensureDistrictOptions\(cid, query\.deal, query\.category, paymentMonthly\)/.test(indexSrc));
check('editing the district text invalidates a prior pick', /setDistrictText\(v\);[\s\S]{0,240}?setDistrictSelected\(null\)/.test(indexSrc));

// ── Search payload: send match_values (full recall), never the raw normalized token ─────────────
check('onSearch sends districtSelected.matchValues (all spellings)', /districts: districtSelected \? districtSelected\.matchValues : undefined/.test(indexSrc));
check('District is OPTIONAL — undefined when unset (city-only search stays valid)', /: undefined/.test(indexSrc) && /districtSelected \?/.test(indexSrc));

// ── Data source: city_id-scoped RPC, Top-6 from live counts, autocomplete = complete catalog ────
// 2026-07-20: district_options_ar now takes optional p_deal AND p_category (proved live that
// Category matters more for districts than for cities — a Riyadh Commercial+Rent top district
// appears in NONE of the other 3 scopes' top 10) — the cache is correspondingly keyed by
// `${cityId}:${deal}:${category}`, not cityId alone. Category is null until the user picks it
// (Category is chosen AFTER District in this form — the owner declined reordering it), which the
// RPC treats as "broader/default ranking" until then.
check('district options come from the district_options_ar RPC, Category+Deal-scoped', /rpc\('district_options_ar', \{ p_city_id: cityId, p_deal: dealAr\(deal\), p_category: category \}\)/.test(locSrc));
check('RPC result carries match_values (twin-safe recall)', /match_values/.test(locSrc));
check('Top-6 = districts with active listings only (listingCount > 0)', /listingCount > 0\)\.slice\(0, k\)/.test(locSrc));
check('autocomplete searches the COMPLETE cached catalog for the city', /export function matchDistrictsByCityId/.test(locSrc));
check('empty focus shows the Category+Deal+period-scoped Top-6 via topDistrictsForCityId', /topDistrictsForCityId\(cid, query\.deal, query\.category, paymentMonthly, 6\)/.test(indexSrc));
check('typing filters within the chosen city+scope via matchDistrictsByCityId', /matchDistrictsByCityId\(citySelected\.cityId, query\.deal, query\.category, paymentMonthly, v\)/.test(indexSrc));
// Arabic-only: typing the district in English yields NO autocomplete and the same Arabic hint the City
// field shows (owner UI request 2026-07-18) — every district name is Arabic, so there's nothing to match.
check('English district input shows the Arabic-only hint and clears suggestions', /const latin = isLatinOnlyInput\(v\);[\s\S]{0,220}?setDistrictSuggestions\(latin \? \[\][\s\S]{0,220}?setDistrictMsg\(latin \? ARABIC_ONLY_MSG/.test(indexSrc));

// ── Dropdown shows the Top-6 WITHOUT listing numbers (owner UI request 2026-07-18). Top-6 is still
//    SELECTED by active-listing count (asserted above, in locations.ts), but the count is no longer
//    displayed; every row (incl. zero-listing catalog districts) renders its name unconditionally. ──
check('district dropdown no longer displays the listing count', !/grouped\(opt\.listingCount\)/.test(indexSrc) && !/\{opt\.listingCount\}/.test(indexSrc));
check('every district row renders its name unconditionally (zero-listing districts still selectable)', /<Text style=\{\[s\.suggCity, isEmpty && s\.suggCityEmpty\]\}>\{opt\.districtAr\}<\/Text>/.test(indexSrc));

// ── Dead-end guard (2026-08-09): a district with ZERO listings for the current deal/category must be
//    visibly marked, so a user is never silently led into a 0-result pick. The row stays selectable
//    (never-dead-end: picking it yields the specific "widen area" suggestion). ──
check('zero-listing district rows are detected via listingCount === 0', /const isEmpty = opt\.listingCount === 0/.test(indexSrc));
check('empty district rows are marked with a "no listings here" note', /isEmpty \? <Text style=\{s\.suggEmptyNote\}>\{t\('No listings here right now'\)\}<\/Text> : null/.test(indexSrc));
check('the "No listings here right now" string is translated to Arabic', /'No listings here right now': '[^']+'/.test(readFileSync(join(root, 'src/i18n.tsx'), 'utf8')));
// The picked district's live count rides along to the search so the 0-results path can tell an empty
// district ("widen area") from one that lacks only the chosen TYPE ("widen type").
check('onSearch carries districtSelected.listingCount to the query', /districtListingCount: districtSelected \? districtSelected\.listingCount : undefined/.test(indexSrc));
{
  const searchSrc = readFileSync(join(root, 'src/data/search.ts'), 'utf8');
  check('SearchQuery carries districtListingCount', /districtListingCount\?: number/.test(searchSrc));
  check('0-results diagnosis uses the real district count, not the empty pool', /distCount === 0[\s\S]{0,400}?widen the area[\s\S]{0,400}?q\.type[\s\S]{0,120}?broaden the type/.test(searchSrc));
}

console.log(failed === 0 ? '\n✓ all district-field assertions passed' : `\n✗ ${failed} district-field assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
