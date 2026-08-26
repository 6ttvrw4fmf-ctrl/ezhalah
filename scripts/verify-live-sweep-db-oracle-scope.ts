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
import { dbFilterFromRequest } from '../e2e/live-sweep/sweep.mjs';

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
const dec = (s: string) => decodeURIComponent(s);

// ── 1. the three formerly-unsupported scopes are now expressed ──────────────────────────────────
const full = dbFilterFromRequest(REQ, TAX);
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

const com = dbFilterFromRequest({ ...REQ, p_category: 'Commercial' }, TAX);
check('a Commercial search switches the suffix and the admitted types',
  com.comparable && dec(com.filter).includes('*_commercial_listings') && dec(com.filter).includes('محل'),
  com.comparable ? dec(com.filter) : com.reason);

// ── 3. it REFUSES rather than approximating ─────────────────────────────────────────────────────
const multi = dbFilterFromRequest({ ...REQ, p_cities: ['بيش', 'عنيزة'] }, TAX);
check('MUTATION: districts across TWO cities are refused, not approximated',
  multi.comparable === false && /one canonical rendering is only guaranteed per city/.test(multi.reason),
  `got comparable=${multi.comparable} reason=${multi.reason}`);

const noTax = dbFilterFromRequest(REQ, null);
check('MUTATION: no taxonomy ⇒ refuse the category scope rather than guess',
  noTax.comparable === false && /refusing to guess/.test(noTax.reason),
  `got comparable=${noTax.comparable} reason=${noTax.reason}`);

const priced = dbFilterFromRequest({ ...REQ, p_price_max: 900000 }, TAX);
check('a price-filtered request is now COMPARABLE (was refused before 2026-08-24)',
  priced.comparable === true, priced.reason);

// ── 3b. NUMERIC PREDICATES: price, area, and the AF numerics ────────────────────────────────────
// Two DIFFERENT unset conventions live in the product and confusing them manufactures false
// mismatches: السعر/المساحة treat 0 as UNSET, while street width / floor / age treat 0 as a REAL
// value. Every assertion below pins one of those, or the deal-mode price contract.
const F = (patch: Record<string, unknown>) => {
  const r = dbFilterFromRequest({ ...REQ, ...patch }, TAX);
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
const mo = dbFilterFromRequest({ ...REQ, p_deal: 'إيجار', p_rent_period: 'شهري', p_price_min: 1000, p_price_max: 2000 }, TAX);
check('a MONTHLY budget is converted ×12 onto the annual column',
  mo.comparable && dec(mo.filter).includes('price_annual.gte.12000') && dec(mo.filter).includes('price_annual.lte.24000'),
  mo.comparable ? dec(mo.filter) : mo.reason);
const yr = dbFilterFromRequest({ ...REQ, p_deal: 'إيجار', p_rent_period: 'سنوي', p_price_min: 1000, p_price_max: 2000 }, TAX);
check('MUTATION: an ANNUAL budget is NOT multiplied',
  yr.comparable && dec(yr.filter).includes('price_annual.gte.1000') && dec(yr.filter).includes('price_annual.lte.2000'),
  yr.comparable ? dec(yr.filter) : yr.reason);

// price — combined Buy+Rent keeps TWO independent budgets over the correct columns
const both = dbFilterFromRequest({ ...REQ, p_deal: null, p_price_min: 5, p_price_max: 6, p_price_min_rent: 7, p_price_max_rent: 8 }, TAX);
const bothF = both.comparable ? dec(both.filter) : '';
check('Buy+Rent = Buy ∪ Rent, each side judged by its OWN budget and column',
  bothF.includes('or(and(deal_ar.eq.بيع') && bothF.includes('price_total.gte.5') && bothF.includes('price_total.lte.6')
  && bothF.includes('deal_ar.eq.إيجار') && bothF.includes('price_annual.gte.7') && bothF.includes('price_annual.lte.8'), bothF);
check('MUTATION: in combined mode a side with NO budget stays unconstrained (not excluded)',
  (() => { const x = dbFilterFromRequest({ ...REQ, p_deal: null, p_price_min_rent: 7 }, TAX);
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
const jrn = read('e2e/live-sweep/journeys.mjs');
check('AF questions are discovered from the page, not a hardcoded title list',
  !jrn.includes("'كم عرض الشارع تفضل؟'") && jrn.includes("endsWith('؟')"),
  'a hardcoded AF title list goes blind the moment a question is added or reworded');

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
