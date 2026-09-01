// THE INDEPENDENT DB ORACLE MUST STAY INDEPENDENT, EXACT, AND HONEST ABOUT WHAT IT CANNOT EXPRESS.
//
// Layer 5 of the live sweep is the only thing standing between "the RPC agrees with itself" and
// actual evidence. Until 2026-08-24 it refused three parameters outright — `p_districts`,
// `p_region_ids`, `p_tables2` — so EVERY district-scoped journey, including the whole
// trending-district kind, silently returned `db: null`. Null contributes zero mismatches, which
// reads exactly like agreement: the sweep reported 0 RPC→DB mismatches while never once comparing
// a district search against database truth.
//
// The scopes are now expressed, and this file pins three separate things:
//
//   1. THEY ARE EXPRESSED. A district/region/two-arm/category request must come back comparable.
//   2. THEY ARE NOT FAKED. Where the oracle CANNOT be faithful it must refuse, not approximate:
//      • districts across MORE THAN ONE city — 232 tokens are rendered differently in different
//        cities (measured), so label-equality would legitimately under-count and the oracle would
//        accuse a healthy product;
//      • a missing taxonomy — guessing the category scope is worse than skipping it.
//   3. IT IS STILL INDEPENDENT. The oracle reaches the same answer by a DIFFERENT route: the RPC
//      matches a district on norm_district_tok() and resolves category in SQL; the oracle matches
//      the SERVED LABEL exactly and applies the PUBLISHED TAXONOMY as data. Agreement is therefore
//      evidence rather than self-confirmation — which is the entire reason layer 5 exists.
//
// Hermetic: no browser, no database. Runs inside `npm test` on every PR.
//
//   node --experimental-strip-types scripts/verify-live-sweep-db-oracle-scope.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dbFilterFromRequest, districtLabelVariants, cityLookupKey } from '../e2e/live-sweep/sweep.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nThe live sweep\'s independent DB oracle: expressed, not faked, still independent\n');

// The published taxonomy, as data — the same shape the sweep fetches at runtime.
const TAX = [
  { type_ar: 'شقة', macro: 'Residential' }, { type_ar: 'فيلا', macro: 'Residential' },
  { type_ar: 'محل', macro: 'Commercial' }, { type_ar: 'مكتب', macro: 'Commercial' },
  { type_ar: 'عمارة', macro: 'both' }, { type_ar: 'غير معروف', macro: 'both' },
];
const REQ = {
  p_deal: 'بيع', p_cities: ['بيش'], p_districts: ['الخضراء 1'], p_region_ids: [6],
  p_category: 'Residential',
  p_tables: ['aqar_residential_listings'], p_tables2: ['aqar_commercial_listings'], p_types2: ['عمارة'],
};
// The city catalog, as data — the same shape the sweep fetches from loc_catalog_city. الأحساء and
// الهفوف are the real clustered pair (city_ids 3677 and 12, both region 5); the duplicate «الهفوف»
// at 501/region 1 is the real §41.16 ambiguity and is present so the region guard is exercised.
const CITIES = [
  { city_id: 3677, city_ar: 'الاحساء', city_norm: 'الاحساء', region_id: 5 },
  { city_id: 12, city_ar: 'الهفوف', city_norm: 'الهفوف', region_id: 5 },
  { city_id: 501, city_ar: 'الهفوف', city_norm: 'الهفوف', region_id: 1 },
  { city_id: 900, city_ar: 'بيش', city_norm: 'بيش', region_id: 6 },
  { city_id: 901, city_ar: 'عنيزة', city_norm: 'عنيزة', region_id: 4 },
  { city_id: 1, city_ar: 'الرياض', city_norm: 'الرياض', region_id: 1 },
];
const dec = (s: string) => decodeURIComponent(s);

// ── 1. the three formerly-unsupported scopes are now expressed ──────────────────────────────────
const full = dbFilterFromRequest(REQ, TAX, CITIES);
check('a district + region + two-arm + category request is COMPARABLE', full.comparable === true,
  `refused with: ${full.reason}`);

const f = full.comparable ? dec(full.filter) : '';
check('الحي is expressed as an exact served-label match', f.includes('district_ar=in.("الخضراء 1")'), f);
check('المنطقة is expressed as a plain region_id predicate', f.includes('region_id=in.(6)'), f);
check('the second (commercial) scope arm is expressed, not dropped',
  f.includes('aqar_commercial_listings') && f.includes('or(') , f);
check('the two scope arms are ORed, each ANDing its own tables with its own types',
  /or\(and\([^)]*aqar_residential_listings[^)]*\)|or\([^)]*and\(/.test(f) || f.includes('or(source_table.in.("aqar_residential_listings"),and('), f);

// ── 2. the category gate comes from the TAXONOMY, including the 'both' macro ─────────────────────
check('the category gate lists the macro\'s own types', f.includes('شقة') && f.includes('فيلا'), f);
check('a Commercial type is NOT admitted under a Residential search', !f.includes('"محل"'), f);
check('macro=both types are admitted only via the source-table suffix',
  f.includes('عمارة') && f.includes('source_table.like.*_residential_listings'), f);

const com = dbFilterFromRequest({ ...REQ, p_category: 'Commercial' }, TAX, CITIES);
check('a Commercial search switches the suffix and the admitted types',
  com.comparable && dec(com.filter).includes('*_commercial_listings') && dec(com.filter).includes('محل'),
  com.comparable ? dec(com.filter) : com.reason);

// ── 3. it REFUSES rather than approximating ─────────────────────────────────────────────────────
const multi = dbFilterFromRequest({ ...REQ, p_cities: ['بيش', 'عنيزة'] }, TAX, CITIES);
check('MUTATION: districts across TWO cities are refused, not approximated',
  multi.comparable === false && /one canonical rendering is only guaranteed per city/.test(multi.reason),
  `got comparable=${multi.comparable} reason=${multi.reason}`);

const noTax = dbFilterFromRequest(REQ, null, CITIES);
check('MUTATION: no taxonomy ⇒ refuse the category scope rather than guess',
  noTax.comparable === false && /refusing to guess/.test(noTax.reason),
  `got comparable=${noTax.comparable} reason=${noTax.reason}`);

const priced = dbFilterFromRequest({ ...REQ, p_price_max: 900000 }, TAX, CITIES);
check('a price-filtered request is now COMPARABLE (was refused before 2026-08-24)',
  priced.comparable === true, priced.reason);

// ── 3b. NUMERIC PREDICATES: price, area, and the AF numerics ────────────────────────────────────
// Two DIFFERENT unset conventions live in the product and confusing them manufactures false
// mismatches: السعر/المساحة treat 0 as UNSET, while street width / floor / age treat 0 as a REAL
// value. Every assertion below pins one of those, or the deal-mode price contract.
const F = (patch: Record<string, unknown>) => {
  const r = dbFilterFromRequest({ ...REQ, ...patch }, TAX, CITIES);
  return r.comparable ? dec(r.filter) : `NOT-COMPARABLE:${r.reason}`;
};

// price — single deal, بيع
check('a Buy budget is judged against price_total and excludes priceless rows',
  F({ p_price_min: 100, p_price_max: 200 }).includes('price_total.gt.0')
  && F({ p_price_min: 100, p_price_max: 200 }).includes('price_total.gte.100')
  && F({ p_price_min: 100, p_price_max: 200 }).includes('price_total.lte.200'), F({ p_price_min: 100, p_price_max: 200 }));
check('MUTATION: price 0 is UNSET, not a real bound',
  !F({ p_price_min: 0, p_price_max: 0 }).includes('price_total.gte.0')
  && !F({ p_price_min: 0, p_price_max: 0 }).includes('price_total.lte.0'), F({ p_price_min: 0, p_price_max: 0 }));

// price — إيجار شهري must be multiplied to the stored ANNUAL basis
const mo = dbFilterFromRequest({ ...REQ, p_deal: 'إيجار', p_rent_period: 'شهري', p_price_min: 1000, p_price_max: 2000 }, TAX, CITIES);
check('a MONTHLY budget is converted ×12 onto the annual column',
  mo.comparable && dec(mo.filter).includes('price_annual.gte.12000') && dec(mo.filter).includes('price_annual.lte.24000'),
  mo.comparable ? dec(mo.filter) : mo.reason);
const yr = dbFilterFromRequest({ ...REQ, p_deal: 'إيجار', p_rent_period: 'سنوي', p_price_min: 1000, p_price_max: 2000 }, TAX, CITIES);
check('MUTATION: an ANNUAL budget is NOT multiplied',
  yr.comparable && dec(yr.filter).includes('price_annual.gte.1000') && dec(yr.filter).includes('price_annual.lte.2000'),
  yr.comparable ? dec(yr.filter) : yr.reason);

// price — combined Buy+Rent keeps TWO independent budgets over the correct columns
const both = dbFilterFromRequest({ ...REQ, p_deal: null, p_price_min: 5, p_price_max: 6, p_price_min_rent: 7, p_price_max_rent: 8 }, TAX, CITIES);
const bothF = both.comparable ? dec(both.filter) : '';
check('Buy+Rent = Buy ∪ Rent, each side judged by its OWN budget and column',
  bothF.includes('or(and(deal_ar.eq.بيع') && bothF.includes('price_total.gte.5') && bothF.includes('price_total.lte.6')
  && bothF.includes('deal_ar.eq.إيجار') && bothF.includes('price_annual.gte.7') && bothF.includes('price_annual.lte.8'), bothF);
check('MUTATION: in combined mode a side with NO budget stays unconstrained (not excluded)',
  (() => { const x = dbFilterFromRequest({ ...REQ, p_deal: null, p_price_min_rent: 7 }, TAX, CITIES);
           const t = x.comparable ? dec(x.filter) : '';
           return t.includes('or(deal_ar.eq.بيع,') && t.includes('price_annual.gte.7'); })(),
  'a Buy listing must not vanish because the user only set a Rent budget');

// area — 0 unset, and once set an UNKNOWN area is excluded
check('an area bound requires a known area (unknown excluded once set)',
  F({ p_area_min: 150 }).includes('area_m2.not.is.null') && F({ p_area_min: 150 }).includes('area_m2.gte.150'), F({ p_area_min: 150 }));
check('MUTATION: area 0 is UNSET, not a real bound',
  !F({ p_area_min: 0, p_area_max: 0 }).includes('area_m2.gte.0'), F({ p_area_min: 0, p_area_max: 0 }));

// beds / baths — exact and minimum are ORed, never ANDed
check('bedrooms exact and minimum are ORed, matching the product',
  F({ p_beds_exact: [3], p_beds_min: 5 }).includes('or(bedrooms.in.(3),and(bedrooms.not.is.null,bedrooms.gte.5))'),
  F({ p_beds_exact: [3], p_beds_min: 5 }));

// AF numerics — 0 is a REAL value here, the opposite of price/area
check('MUTATION: street width 0 is a REAL bound, not unset',
  F({ p_street_width_min: 0 }).includes('street_width_m.gte.0'), F({ p_street_width_min: 0 }));
check('MUTATION: property age 0 is a REAL bound, not unset',
  F({ p_age_min: 0, p_age_max: 5 }).includes('property_age.gte.0'), F({ p_age_min: 0, p_age_max: 5 }));
check('age UNKNOWN is expressed in both directions',
  F({ p_age_unknown: true }).includes('property_age.is.null')
  && F({ p_age_unknown: false }).includes('property_age.not.is.null'));
check('new-construction=false keeps rows with an unknown age (not silently dropped)',
  F({ p_is_new_construction: false }).includes('or(property_age.is.null,property_age.neq.0)'),
  F({ p_is_new_construction: false }));
check('rating/reviews minimums require the value to exist',
  F({ p_rating_min: 4 }).includes('rating.not.is.null') && F({ p_reviews_min: 10 }).includes('reviews_count.not.is.null'));

// what must STILL be refused
for (const [k, v] of [['p_directions', ['شمال']], ['p_platforms', ['aqar']]] as const) {
  check(`${k} is still honestly refused (would need the RPC's own normaliser)`,
    F({ [k]: v }).startsWith('NOT-COMPARABLE:'), F({ [k]: v }));
}
// المميزات: expressible for the KNOWN vocabulary, refused the moment a token falls outside it —
// that is precisely the case where the oracle and the RPC would legitimately diverge.
check('known amenity tokens map to their boolean columns and are ANDed',
  F({ p_amenities: ['kitchen', 'elevator'] }).includes('kitchen.is.true')
  && F({ p_amenities: ['kitchen', 'elevator'] }).includes('elevator.is.true'), F({ p_amenities: ['kitchen', 'elevator'] }));
check('the ac token maps to air_conditioner, not a column named ac',
  F({ p_amenities: ['ac'] }).includes('air_conditioner.is.true'), F({ p_amenities: ['ac'] }));
check('rnpl and rent_now_pay_later both map to rent_now_pay_later',
  F({ p_amenities: ['rnpl'] }).includes('rent_now_pay_later.is.true')
  && F({ p_amenities: ['rent_now_pay_later'] }).includes('rent_now_pay_later.is.true'));
check('MUTATION: an UNKNOWN amenity token refuses the comparison, never guesses',
  F({ p_amenities: ['kitchen', 'not_a_real_token'] }).startsWith('NOT-COMPARABLE:'),
  F({ p_amenities: ['kitchen', 'not_a_real_token'] }));

// The AF question set must be DISCOVERED, not hardcoded (§1) — a fixed title list made every
// Commercial AF journey report "no question rendered" while production rendered one.
//
// WHAT THIS PINS IS THE INTENT, NOT ONE MECHANISM (widened 2026-08-29). It used to require the
// literal `endsWith('؟')` body-text scan, which was the only discovery the journey had. That scan
// reads the WHOLE page, so on a results screen it also picks up the cards behind the AF overlay —
// measured live, a text reader on that screen returned «رقم رخصة الإعلان / 7100249846» and
// «عمر العقار / 2025» as if they were the question's options. Reading the title from the card's own
// `af-question-title` testID is discovery too, and strictly better scoped. Pinning the old
// expression would have forced the harness to keep the worse of the two.
//
// Both halves still hold: no hardcoded title may appear, AND the title must come from the live DOM.
const jrn = read('e2e/live-sweep/journeys.mjs');
const HARDCODED_TITLE = /['"`][^'"`]{6,}؟['"`]/;          // any Arabic question literal in the harness
const discoversByText = jrn.includes("endsWith('؟')");
const discoversByTestId = /data-testid="af-question-title"/.test(jrn);
check('AF questions are discovered from the page, not a hardcoded title list',
  !HARDCODED_TITLE.test(jrn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, ''))
  && (discoversByText || discoversByTestId),
  'a hardcoded AF title list goes blind the moment a question is added or reworded; the title must '
  + `be read from the live DOM (body-text scan: ${discoversByText}, af-question-title: ${discoversByTestId})`);

// ── 4. independence: the oracle must NOT reimplement the RPC's normalisation ─────────────────────
const sweep = read('e2e/live-sweep/sweep.mjs');
// Comments are stripped first: this must catch a CALL, not a sentence explaining why we do not call
// it. Grepping raw source made the guard fire on its own rationale.
const sweepCode = sweep.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n');
check('the oracle does not call the RPC\'s district normaliser',
  !sweepCode.includes('norm_district_tok') && !sweepCode.includes('norm_direction_ar'),
  'matching the RPC\'s own token function would make agreement self-confirmation, not evidence');
check('the taxonomy is FETCHED, never hardcoded in the harness (§1)',
  sweep.includes('known_type_ar?select=type_ar,macro'),
  'a hardcoded type list rots silently the first time the taxonomy changes');

// ── 5. the ID-set comparison exists, is bounded, and skips honestly ──────────────────────────────
check('the ID set is compared, not only the count',
  sweep.includes('missing') && sweep.includes('extra') && sweep.includes('duplicates'),
  'equal counts are not equal sets: one missing plus one extra passes every count-only check');
check('the ID-set comparison is bounded by the RPC page cap',
  sweep.includes('ID_SET_CAP') && /ID_SET_CAP\s*=\s*\d+/.test(sweep));
check('a set larger than one page is recorded as skipped, not as a pass',
  sweep.includes('idSetSkipped'));
check('duplicates are detected from an ARRAY, so repeats cannot be silently de-duped',
  sweep.includes('rIds.length - rSet.size'));

// ── 5b. الحي: the REQUEST's label is not always the SERVED label ────────────────────────────────
// 2026-08-26. The picker is fed by district_options_ar (loc_catalog's canonical name, «حي المهدية»);
// search_listings_ar stores its OWN canonical rendering of the same حي («المهدية», 8,079 rows in
// الرياض). The RPC matches on norm_district_tok so both are one place to it — but the oracle
// compares the SERVED label exactly, so it filtered on a spelling that matches zero rows and
// reported «RPC 2470 vs independent DB 0»: a confident, total, and entirely false matching failure
// against a product that was exactly right. Measured over every (city, served label) pair the picker
// can reach: 1,874 agree exactly, 176 differ ONLY by the leading «حي », 32 differ otherwise.
//
// The fix must do BOTH halves, and this pins both — a fix that only silenced the layer would be
// worse than the bug (§40.7 / "never silence a barrier to make it green: make it distinguish"):
//   • RESOLVE the 176 — probe the candidate spellings and use the one actually served;
//   • REFUSE the 32 — say so and skip, never emit a filter known to match nothing.
check('the oracle resolves a حي label to the spelling actually served',
  /export function districtLabelVariants/.test(sweep) && sweep.includes('resolveDistrictLabels'),
  'the picker\'s label and the index\'s rendering differ on 208 of 2,082 reachable pairs');
check('«حي X» and «X» are treated as candidate spellings of one حي',
  (() => {
    const v = districtLabelVariants('حي المهدية');
    const w = districtLabelVariants('المهدية');
    return v.includes('حي المهدية') && v.includes('المهدية')
        && w.includes('المهدية') && w.includes('حي المهدية');
  })(),
  'without both spellings the 176 prefix-only pairs filter on a label that matches zero rows');
check('the «حي» prefix is stripped in either orthography (ي and ى)',
  districtLabelVariants('حى الملقا').includes('الملقا'));
check('a حي label is never mangled beyond the prefix',
  (() => {
    const v = districtLabelVariants('حي النرجس');
    return v.every((x) => x === 'حي النرجس' || x === 'النرجس');
  })(),
  'over-normalising would make the oracle match a DIFFERENT حي — a false pass, the worse failure');
check('an unresolvable حي makes the oracle REFUSE the layer, not report a mismatch',
  sweep.includes('matches no served label in this city') && /dbReq\s*=\s*null/.test(sweep),
  'emitting a filter known to match nothing turns the oracle\'s blindness into a product accusation');
check('a RESOLVED حي still flows into the district filter, so the layer keeps comparing',
  (() => {
    const f = dbFilterFromRequest(
      { p_districts: ['المهدية'], p_cities: ['الرياض'], p_deal: 'بيع' }, [{ type_ar: 'شقة', macro: 'Residential' }], CITIES);
    return f.comparable === true && decodeURIComponent(f.filter).includes('"المهدية"');
  })(),
  'refusing everything would silence the layer instead of fixing it');
// MUTATION PROOF — the pre-fix behaviour must FAIL this file.
check('MUTATION: exact-label-only resolution is rejected',
  !((): boolean => {
    const only = districtLabelVariants('حي المهدية');
    return only.length === 1 && only[0] === 'حي المهدية';   // the old behaviour
  })(),
  'variants() returning the request label alone reproduces the 2026-08-26 false defect exactly');

// ── 5c. THE CITY ARM: all three, never the label alone (2026-09-01) ─────────────────────────────
// The RPC matches a city on THREE arms — label, own city_id, and `match_city_ids && city_ids` —
// and the third is what carries loc_city_cluster. While that table was empty all three coincided,
// so a label-only oracle was accidentally exact. The owner-approved الأحساء/الهفوف cluster
// (migration 20260831195108) populated it, and the label-only oracle immediately reported ELEVEN
// false COUNT MISMATCHes across six cohorts against a completely healthy product — every pair
// summing to the RPC's own total from both directions (39+18=57 · 28+26=54 · 6+5=11 · 26+16=42 ·
// 6+6=12 · 5+4=9). This section makes that shape impossible to reintroduce.
const ahsa = dbFilterFromRequest(
  { p_deal: 'بيع', p_cities: ['الاحساء'], p_region_ids: [5], p_category: 'Residential',
    p_tables: ['aqar_residential_listings'], p_types: ['شقة'] }, TAX, CITIES);
const ahsaF = ahsa.comparable ? dec(ahsa.filter) : '';
check('a city search expresses the LABEL arm', ahsa.comparable && ahsaF.includes('city_ar.in.("الاحساء")'), ahsaF || ahsa.reason);
check('a city search expresses the city_id arm', ahsaF.includes('city_id.in.(3677)'), ahsaF);
check('a city search expresses the match_city_ids arm — the one carrying loc_city_cluster',
  ahsaF.includes('match_city_ids.ov.{3677}'),
  'without this arm every clustered city under-counts by its siblings and the oracle accuses production');

// §41.16: the region disambiguates a repeated city NAME. الهفوف is BOTH 12/region 5 (the real
// inventory) and 501/region 1; resolving by name alone would silently pick one.
const hof5 = dbFilterFromRequest({ p_deal: 'بيع', p_cities: ['الهفوف'], p_region_ids: [5] }, TAX, CITIES);
const hof1 = dbFilterFromRequest({ p_deal: 'بيع', p_cities: ['الهفوف'], p_region_ids: [1] }, TAX, CITIES);
check('an ambiguous city NAME resolves through its REGION, not a name-keyed pick (§41.16)',
  hof5.comparable && dec(hof5.filter).includes('.{12}') && hof1.comparable && dec(hof1.filter).includes('.{501}'),
  `region5 → ${hof5.comparable ? dec(hof5.filter) : hof5.reason} | region1 → ${hof1.comparable ? dec(hof1.filter) : hof1.reason}`);

// REFUSE, never approximate — the §41.15 rule applied to the city scope.
const noCat = dbFilterFromRequest({ p_deal: 'بيع', p_cities: ['الاحساء'], p_region_ids: [5] }, TAX, null);
check('MUTATION: no city catalog ⇒ REFUSE, never fall back to a label-only filter',
  noCat.comparable === false && /city catalog unavailable/.test(noCat.reason),
  `got comparable=${noCat.comparable} reason=${noCat.reason}`);
const unknownCity = dbFilterFromRequest({ p_deal: 'بيع', p_cities: ['مدينة لا وجود لها'], p_region_ids: [5] }, TAX, CITIES);
check('MUTATION: an unresolvable city is REFUSED, not silently label-matched',
  unknownCity.comparable === false && /does not resolve/.test(unknownCity.reason),
  `got comparable=${unknownCity.comparable} reason=${unknownCity.reason}`);

// MUTATION PROOF — the pre-fix source must FAIL this file. The defect was a bare `city_ar=in.(…)`
// predicate as the WHOLE city scope; if that shape ever returns, the false-mismatch class is back.
const sweepSrc = read('e2e/live-sweep/sweep.mjs');
check('MUTATION: the label-only `city_ar=in.(…)` city predicate is gone from the oracle',
  !/f \+= `&city_ar=in\./.test(sweepSrc),
  'that exact line is the 2026-09-01 defect — it sees one half of every clustered city');
check('the oracle reads loc_catalog_city to resolve p_cities into the RPC\'s own city_ids',
  sweepSrc.includes('loc_catalog_city?select=city_id,city_ar,city_norm,region_id'),
  'the city_id / match_city_ids arms cannot be expressed without the catalog');

// ── 5d. THE CITY LOOKUP FOLD — resolve the request's spelling, or refuse; never over-refuse ─────
// §5c's first version compared the request's city label to the catalog by EXACT string equality.
// That resolves every label the INDEX serves (measured 2026-09-01: 362/362 served (city, region)
// pairs), but the label the REQUEST carries comes from the app's picker and can render the same city
// with hamza. «أبو عريش» vs the catalog's «ابو عريش» failed to resolve, and the sweep SKIPPED the
// DB-truth layer on a perfectly healthy journey. A skipped layer contributes zero mismatches, which
// reads exactly like agreement — this file's opening paragraph is about precisely that failure — so
// over-refusing is not the safe direction either. Both errors are now pinned.
//
// The fold mirrors normalize_ar() (prosrc, 2026-09-01) and is LOOKUP-ONLY: it turns a name into a
// city_id and never decides whether a row matches. Verified live against the database's own stored
// city_norm over the WHOLE catalog: 4,582 rows, 0 divergences.
check('the fold maps hamza-alef forms onto bare alef (أ إ آ ٱ → ا)',
  ['أبو عريش', 'إبو عريش', 'آبو عريش', 'ٱبو عريش'].every((s) => cityLookupKey(s) === 'ابو عريش'),
  ['أبو عريش', 'إبو عريش', 'آبو عريش', 'ٱبو عريش'].map(cityLookupKey).join(' | '));
check('the fold maps ة→ه and ى→ي', cityLookupKey('مكة') === 'مكه' && cityLookupKey('المرتضى') === 'المرتضي',
  `${cityLookupKey('مكة')} | ${cityLookupKey('المرتضى')}`);
check('the fold DELETES tatweel and bidi marks rather than mapping them',
  cityLookupKey('بـريدة') === 'بريده' && cityLookupKey('‏جدة‎') === 'جده',
  `${cityLookupKey('بـريدة')} | ${cityLookupKey('‏جدة‎')}`);
check('the fold trims and collapses whitespace runs', cityLookupKey('  ابو   عريش ') === 'ابو عريش',
  JSON.stringify(cityLookupKey('  ابو   عريش ')));

// The whole point: a hamza-spelled request must now COMPARE, not skip.
const hamza = dbFilterFromRequest({ p_deal: 'بيع', p_cities: ['أبو عريش'], p_region_ids: [10] }, TAX,
  [{ city_id: 4242, city_ar: 'ابو عريش', city_norm: 'ابو عريش', region_id: 10 }]);
check('MUTATION: a hamza-spelled request RESOLVES instead of skipping the DB-truth layer',
  hamza.comparable === true && dec(hamza.filter).includes('match_city_ids.ov.{4242}'),
  hamza.comparable ? dec(hamza.filter) : hamza.reason);
// …and a genuinely unknown city STILL refuses. Recovering variants must not become "accept anything".
const stillRefuses = dbFilterFromRequest({ p_deal: 'بيع', p_cities: ['مدينة لا وجود لها'], p_region_ids: [10] }, TAX,
  [{ city_id: 4242, city_ar: 'ابو عريش', city_norm: 'ابو عريش', region_id: 10 }]);
check('MUTATION: the fold did NOT turn refusal into accept-anything',
  stillRefuses.comparable === false && /does not resolve/.test(stillRefuses.reason),
  `got comparable=${stillRefuses.comparable} reason=${stillRefuses.reason}`);

// ── 6. a skipped layer can never read as a pass ─────────────────────────────────────────────────
const runner = read('e2e/live-sweep/run.mjs');
check('the run report PRINTS how many journeys skipped the DB-truth layer',
  runner.includes('DB-TRUTH LAYER SKIPPED'),
  'null contributes zero mismatches — unprinted, it is indistinguishable from agreement');
check('the run report prints how many ID-set comparisons actually happened',
  runner.includes('ID-SET COMPARISONS'));
check('the skip REASON is surfaced, not just a count', runner.includes('j.dbSkipped'));

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
