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
check('a price-filtered request is still honestly refused (unchanged behaviour)',
  priced.comparable === false && priced.reason.includes('p_price_max'), priced.reason);

// ── 4. independence: the oracle must NOT reimplement the RPC's normalisation ─────────────────────
const sweep = read('e2e/live-sweep/sweep.mjs');
check('the oracle does not call the RPC\'s district normaliser',
  !sweep.includes('norm_district_tok'),
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
