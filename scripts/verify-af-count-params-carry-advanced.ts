// Regression guard (2026-08-20, Advanced Filter major certification).
//
// THE BUG THIS EXISTS TO PREVENT
// ------------------------------
// A count surface that reflects the user's scope must apply the user's ADVANCED answers too, or the
// number it shows is larger than what selecting it returns. This has been the same bug twice:
//
//   * 2026-07-24 — the property-age bucket badges ignored an already-selected amenity filter and
//     showed "counts far larger than what Search actually returns" (fixed in fetchAgeOptionCounts).
//   * 2026-08-20 — `fetchDistrictEligibleCounts`, the helper written specifically so that "count and
//     outcome cannot disagree", re-ran the results RPC through rpcCountFilterParams() only, which
//     carries the NORMAL filter (types/beds/price/area) and no advanced params at all. Measured live
//     on Riyadh / Rent-Annual / شقة with amenities=[elevator] + bathMin=3: the top 8 districts
//     advertised 4,141 listings and returned 511 on click — an 8.1x overstatement, every row wrong.
//     The same omission also kept AF-only narrowing out of `districtNarrowingSig`, so the live-count
//     path did not even run for an advanced-only answer, and a changed answer did not invalidate.
//
// The fix is ONE shared definition (rpcAdvancedFilterParams) that every advanced-aware count surface
// spreads. This guard pins that: a new advanced question that forgets to register here, or a count
// surface that stops spreading it, fails CI instead of silently overstating in production.
//
// Offline: pure source analysis, no DB and no network.
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-af-count-params-carry-advanced: every advanced-filter answer must reach the');
console.log('  count surfaces that claim to reflect the user\'s current filter state.');

const remote = readFileSync('src/data/remote.ts', 'utf8');
const index = readFileSync('src/app/index.tsx', 'utf8');
const search = readFileSync('src/data/search.ts', 'utf8');

// ── (A) the shared definition exists and is exported ────────────────────────────────────────────
const helperMatch = remote.match(/export function rpcAdvancedFilterParams\(q: SearchQuery\)\s*\{([\s\S]*?)\n\}/);
check('rpcAdvancedFilterParams() exists and is exported', !!helperMatch);
const helperBody = helperMatch?.[1] ?? '';

// ── (B) it carries every advanced RPC param the search path can send ────────────────────────────
// These are the p_* params location_search_candidates_ar applies BEYOND the normal filter. If the
// RPC gains a new advanced predicate, add it here and to the helper in the same change.
const REQUIRED_PARAMS = [
  'p_amenities', 'p_bath_min', 'p_furnished', 'p_street_width_min', 'p_directions',
  'p_rating_min', 'p_reviews_min', 'p_unit_subtypes', 'p_age_min', 'p_age_max',
  'p_is_new_construction',
];
for (const p of REQUIRED_PARAMS) {
  check(`    helper carries ${p}`, helperBody.includes(p));
}

// ── (C) the district count path spreads it ──────────────────────────────────────────────────────
// This is the surface that regressed. Its promise is exact equality with the results RPC.
const districtFn = remote.match(/export async function fetchDistrictEligibleCounts\(([\s\S]*?)\n\}/);
check('fetchDistrictEligibleCounts() found', !!districtFn);
check(
  '    district count base spreads rpcAdvancedFilterParams(q)',
  (districtFn?.[1] ?? '').includes('...rpcAdvancedFilterParams(q)'),
  'without it every district overstates whenever an advanced question is answered',
);

// ── (D) advanced answers are part of the district-count invalidation signature ───────────────────
// Two failures ride on this: an advanced-ONLY narrowing must still trigger the live-count path, and
// changing an answer must invalidate the cached numbers rather than leave the previous ones on screen.
const sigMatch = index.match(/const districtNarrowingSig = JSON\.stringify\(\[([\s\S]*?)\]\);/);
check('districtNarrowingSig found in src/app/index.tsx', !!sigMatch);
const sig = sigMatch?.[1] ?? '';
for (const f of ['query.amenities', 'query.bathMin', 'query.furnishedPref', 'query.ratingMin',
                 'query.unitSubtypes', 'query.ageMin', 'query.isNewConstruction']) {
  check(`    districtNarrowingSig includes ${f}`, sig.includes(f));
}

// ── (E) completeness: every advanced field on SearchQuery is represented in the helper ───────────
// Catches the real-world failure mode — a new advanced question adds a SearchQuery field and a
// question definition, and nobody remembers the count surfaces.
const AF_QUERY_FIELDS: Array<[string, string]> = [
  ['amenities', 'p_amenities'],
  ['bathMin', 'p_bath_min'],
  ['furnishedPref', 'p_furnished'],
  ['streetWidthMin', 'p_street_width_min'],
  ['directions', 'p_directions'],
  ['ratingMin', 'p_rating_min'],
  ['reviewsMin', 'p_reviews_min'],
  ['unitSubtypes', 'p_unit_subtypes'],
];
for (const [field, param] of AF_QUERY_FIELDS) {
  if (new RegExp(`^\\s*${field}\\??:`, 'm').test(search)) {
    check(`    SearchQuery.${field} maps to ${param} in the helper`, helperBody.includes(param));
  }
}

// ── (F) the age-bucket count path spreads it too, MINUS its own dimension ───────────────────────
// It used to hand-copy 8 of the helper's keys, so a newly added advanced question would silently
// stop being carried here (the 2026-07-24 bug, re-armed). It must spread the shared builder — but
// strip p_age_min/p_age_max/p_is_new_construction, because this RPC applies those to the very scope
// it then buckets: verified live 2026-08-25 (Riyadh/Rent-Monthly, p_age_min=3,p_age_max=5) every
// bucket but 3_5 collapsed to 0. AGE_QUESTION.apply REPLACES the age answer, so the buckets must be
// priced un-narrowed by it or a re-ask can never change the answer.
const ageFn = remote.match(/export async function fetchPropertyAgeOptionCounts\(([\s\S]*?)\n\}/);
check('fetchPropertyAgeOptionCounts() found', !!ageFn);
const ageBody = ageFn?.[1] ?? '';
check(
  '    age count spreads rpcAdvancedFilterParams(q) via ageAgnostic()',
  /\.\.\.ageAgnostic\(rpcAdvancedFilterParams\(q\)\)/.test(ageBody),
  'a hand-copied param list stops carrying any advanced question added later',
);
for (const p of REQUIRED_PARAMS) {
  check(`    age count does not re-list ${p} by hand`, !ageBody.includes(p));
}
const stripFn = remote.match(/function ageAgnostic<[\s\S]*?\n\}/)?.[0] ?? '';
check('ageAgnostic() found', !!stripFn);
for (const p of ['p_age_min', 'p_age_max', 'p_is_new_construction']) {
  check(`    ageAgnostic() strips ${p}`, stripFn.includes(p),
    'sending it collapses every other age bucket to 0');
}

console.log(
  failures === 0
    ? '\n✓ verify-af-count-params-carry-advanced: all checks passed.'
    : `\n❌ verify-af-count-params-carry-advanced: ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
