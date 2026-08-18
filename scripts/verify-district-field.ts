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
check('city-select (via citySelected) warms THIS city’s districts by city_id, Category+Deal+period-scoped (effCategory since count-scope parity 2026-08-14)', /useEffect\(\(\) => \{\s*if \(!citySelected\) return;\s*const cid = citySelected\.cityId;\s*void ensureDistrictOptions\(cid, query\.deal, effCategory, paymentMonthly, cohortTypes\)/.test(indexSrc));

// ── MULTI-SELECT (owner 2026-08-10): several districts, OR semantics, one shared selection state ──
// The state is an ARRAY and city-mutation clears wipe the WHOLE array (no cross-city carry-over,
// exactly the old invariant but over a list).
check('district selection is an array (districtsSelected)', /const \[districtsSelected, setDistrictsSelected\] = useState<DistrictOption\[\]>\(\[\]\)/.test(indexSrc));
check('clearDistrict wipes the whole selection array', /const clearDistrict = \(\) => \{[\s\S]{0,300}?setDistrictsSelected\(\[\]\)/.test(indexSrc));
// DEDUP: membership is keyed by districtAr, and toggle add/remove goes through ONE helper — so the
// same district picked from Trending and from typed search is one key, one entry, and a second tap
// REMOVES it. Trending and typed rows share the same selectedLabels set (one shared state).
check('one toggleDistrict helper keyed by districtAr (add/remove, no duplicates)', /prev\.some\(\(d\) => d\.districtAr === opt\.districtAr\)\s*\? prev\.filter\(\(d\) => d\.districtAr !== opt\.districtAr\)\s*: \[\.\.\.prev, opt\]/.test(indexSrc));
check('Trending rows and typed rows share ONE selection state (selectedLabels from districtsSelected)', /const selectedLabels = new Set\(districtsSelected\.map\(\(d\) => d\.districtAr\)\)/.test(indexSrc) && /selectedLabels=\{selectedLabels\}/.test(indexSrc));
check('typed suggestion rows highlight when picked', /isPicked && s\.suggRowPicked/.test(indexSrc));
// Selected picks stay VISIBLE as removable chips (owner: "the user knows exactly what they picked").
check('selected districts render as removable chips (✕ per district)', /districtsSelected\.map\(\(d\) => \([\s\S]{0,700}?toggleDistrict\(d\)/.test(indexSrc)); // window widened 2026-08-14: chips gained the LOC_IMG.district art
// The capability is TOLD to the user in Arabic (owner copy).
check('multi-select helper text is shown and translated («تقدر تختار أكثر من حي»)', /You can pick more than one neighborhood/.test(indexSrc) && /'You can pick more than one neighborhood': 'تقدر تختار أكثر من حي'/.test(readFileSync(join(root, 'src/i18n.tsx'), 'utf8')));
// The confirm animation survives multi-select: green border/checkmark persist while ≥1 pick, and the
// one-shot pop replays on each ADDITION (owner: "don't forget the animation").
check('confirm pop replays on each added district', /if \(n > prevDistrictCount\.current\) confirmPop\(districtPop\)/.test(indexSrc));

// ── Search payload: UNION of every selected district's match_values, deduped (OR semantics). ─────
// ONE pick serializes to exactly the array an old single-district link carries — old links and new
// ones are the same shape, so nothing downstream needed changing (p_districts was always string[]).
check('onSearch sends the deduped UNION of matchValues (district A OR B OR C)', /new Set\(districtsSelected\.flatMap\(\(d\) => d\.matchValues\)\)/.test(indexSrc));
check('District is OPTIONAL — undefined when nothing picked (city-only search stays valid)', /districtsSelected\.length\s*\? \[\.\.\.new Set/.test(indexSrc));

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
check('empty focus shows the Category+Deal+period-scoped Top-6 via topDistrictsForCityId', /topDistrictsForCityId\(cid, query\.deal, effCategory, paymentMonthly, 6, cohortTypes\)/.test(indexSrc));
check('typing filters within the chosen city+scope via matchDistrictsByCityId (cohort-typed)', /matchDistrictsByCityId\(citySelected\.cityId, query\.deal, effCategory, paymentMonthly, v, cohortTypes\)/.test(indexSrc));
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
// ── DISTRICT COUNT HONESTY (owner rule 2026-08-13): the signal beside a district must equal what
//    selecting it returns UNDER THE CURRENT FILTER STATE. district_options_ar knows deal/category/
//    period only; measured live, with نوع=مستودع set, 10/10 of Riyadh's top rent districts presented
//    as having inventory while holding ZERO warehouses. The fix: when any narrower filter is active,
//    the visible rows' empty-marking comes from the RESULTS RPC itself (fetchDistrictEligibleCounts,
//    p_limit:1 → total_count), so signal and outcome cannot disagree — by construction. ──
check('live counts come from the RESULTS RPC (fetchDistrictEligibleCounts exists, p_limit:1)', (() => {
  const remoteSrc = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
  return /export async function fetchDistrictEligibleCounts/.test(remoteSrc)
    && /location_search_candidates_ar'?,\s*\{ \.\.\.base, p_districts: opt\.matchValues \}/.test(remoteSrc)
    && /p_limit: 1/.test(remoteSrc);
})());
check('per-option match_values OVERRIDE the base q districts (spread order)', /\{ \.\.\.base, p_districts: opt\.matchValues \}/.test(readFileSync(join(root, 'src/data/remote.ts'), 'utf8')));
check('marking prefers the live full-filter-state count over the scope count', /const live = districtLiveCounts\?\.\[opt\.districtAr\];\s*\n\s*const isEmpty = live != null \? live === 0 : opt\.listingCount === 0/.test(indexSrc));
check('counts use the CURRENT filter state (narrowing signature covers type/group/types/beds/size/price/area)', /districtNarrowingSig = JSON\.stringify\(\[query\.type, query\.typeGroup, query\.types, query\.detail,[\s\S]{0,200}?query\.priceMin, query\.priceMax, query\.areaMin, query\.areaMax\]\)/.test(indexSrc));
check('changing any relevant filter INVALIDATES the previous counts before refetch (no stale numbers)', /setDistrictLiveCounts\(null\);\s*\n\s*if \(!citySelected \|\| !hasDistrictNarrowing/.test(indexSrc));
check('a live-count response is dropped if a newer request superseded it (race guard)', /if \(id === districtLiveReq\.current && counts\) setDistrictLiveCounts\(counts\)/.test(indexSrc));
check('onSearch and the count effect share ONE query builder (no state drift between count and search)', /const base = buildFilterBaseQuery\(\)!/.test(indexSrc) && /const q = buildFilterBaseQuery\(\);/.test(indexSrc));
check('trending rows show the Arabic zero message under narrowing (never a silent dead-end)', /sublabel: districtLiveCounts\?\.\[opt\.districtAr\] === 0[\s\S]{0,40}\? t\('No listings here right now'\)[\s\S]{0,80}cohortCountLabel\(opt\.listingCount\)/.test(indexSrc));
// The owner explicitly praised and locked the Arabic zero-listing message: it must exist, stay
// TRANSLATED (no English leak in the user-visible string), and stay wired to the empty rows.
{
  const i18nSrc = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
  const m = i18nSrc.match(/'No listings here right now': '([^']+)'/);
  check('the zero-listing message is translated and its Arabic contains no Latin letters', !!m && !/[A-Za-z]/.test(m[1]));
}
check('empty district rows are marked with a "no listings here" note', /isEmpty[\s\S]{0,40}\? <Text style=\{s\.suggEmptyNote\}>\{t\('No listings here right now'\)\}<\/Text>/.test(indexSrc));
check('the "No listings here right now" string is translated to Arabic', /'No listings here right now': '[^']+'/.test(readFileSync(join(root, 'src/i18n.tsx'), 'utf8')));
// The picked districts' live counts ride along to the search (multi: the SUM — folds are disjoint,
// so the sum IS the union size) so the 0-results path can tell an empty area from a type mismatch.
check('onSearch carries the summed listingCount of all picked districts', /districtsSelected\.reduce\(\(sum, d\) => sum \+ d\.listingCount, 0\)/.test(indexSrc));
{
  const searchSrc = readFileSync(join(root, 'src/data/search.ts'), 'utf8');
  check('SearchQuery carries districtListingCount', /districtListingCount\?: number/.test(searchSrc));
  check('0-results diagnosis uses the real district count, not the empty pool', /distCount === 0[\s\S]{0,400}?widen the area[\s\S]{0,400}?q\.type[\s\S]{0,120}?broaden the type/.test(searchSrc));
}

console.log(failed === 0 ? '\n✓ all district-field assertions passed' : `\n✗ ${failed} district-field assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
