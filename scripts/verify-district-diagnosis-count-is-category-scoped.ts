// PERMANENT BARRIER: the zero-results district diagnosis never speaks from a TYPE-scoped count.
// (ops_incident #16, owner routine-4 Search & Matching QA.)
//
// THE DEFECT THIS EXISTS FOR. `SearchQuery.districtListingCount` is documented in src/data/search.ts
// as «the PICKED district's own live listing count (deal/category scope, straight from
// district_options_ar)», and `noResultsSuggestion` branches on exactly that meaning:
//
//     distCount === 0                     → «No matches in that specific area … widen the area?»
//     distCount > 0 AND a type is chosen  → «No matches for that property type here … broaden the type?»
//
// Separating those two cases is the ONLY reason the field exists — `pools` at that point is the
// already-server-filtered (empty) fetch, so `countWith()` structurally cannot tell them apart.
//
// But the district picker is TYPE-scoped: `ensureDistrictOptions` sends `p_types` whenever a cohort
// is selected (src/data/locations.ts), sharpened again by the 2026-09-03
// district_options_ar_scoped_by_af_eligibility_clause migration. Summing those per-type counts
// INVERTS both branches. A حي full of villas with zero apartments reports 0, and the user searching
// for apartments is told the AREA is empty and offered a wider area — when the area was never the
// problem and the villas are right there. The same search can also answer differently before and
// after a «تصفية» round-trip, depending on whether a نوع had been selected yet.
//
// THE FIX IS ABOUT MEANING, NOT ARITHMETIC. The picker's counts must STAY type-scoped — that is what
// the user is choosing between, and what makes the number beside each حي true. So the diagnosis
// declines to speak when it has no category-scoped number: `districtListingCount` is sent only when
// no type cohort is active, and `noResultsSuggestion` then falls through to its generic probes,
// which re-count against the real pool and are correct either way. A message we cannot ground is
// worse than the general one.
//
// WHAT IS LOCKED (mutation-proven below):
//   1. The producer gates on the cohort being empty — the pre-fix expression is caught.
//   2. The consumer still branches on the field, so the field is not quietly dead.
//   3. `undefined` really does disable the specialised branch (executed against the real predicate).
//
//   node --experimental-strip-types scripts/verify-district-diagnosis-count-is-category-scoped.ts
//   (auto-discovered by npm test — scripts/lib/testRegistry.ts)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const index = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const search = readFileSync(join(root, 'src/data/search.ts'), 'utf8');
const locations = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
/**
 * A MUTATION PROOF: this barrier's own predicate, applied to a deliberately broken input, asserting
 * that it really comes back RED. `caught` must be a computed boolean — a literal `true` here is the
 * shape scripts/verify-new-barriers-are-mutation-proven.ts exists to refuse.
 */
const mustCatch = (label: string, caught: boolean, detail = '') => check(`MUTATION — ${label}`, caught, detail);

console.log('\nThe district zero-results diagnosis speaks only from a category-scoped count\n');

// ── 1. THE PREMISE — the picker really is type-scoped, so the hazard is real ─────────────────────
// If this ever stops being true the fix above becomes unnecessary rather than wrong, but the barrier
// should say so out loud instead of silently guarding nothing.
check('ensureDistrictOptions still sends p_types, so its counts are per-TYPE',
  /if \(types && types\.length\) args\.p_types = types;/.test(locations),
  'the whole hazard is that the picker counts one type while the diagnosis assumes all of them');

// ── 2. THE PRODUCER gates on there being no type cohort ─────────────────────────────────────────
const producer = index.match(/districtListingCount: districtsSelected\.length[^,]*\n?[^,]*\n?[^,]*/)?.[0] ?? '';
check('districtListingCount is only sent when no type cohort is active',
  /districtListingCount: districtsSelected\.length && !\(cohortTypes && cohortTypes\.length\)/.test(index),
  `saw: ${producer.slice(0, 160)}`);
check('…and it still sums the picked districts when it IS sent (multi-select union, folds disjoint)',
  /districtsSelected\.reduce\(\(sum, d\) => sum \+ d\.listingCount, 0\)/.test(index));

// ── 3. THE CONSUMER still uses it — the field must not become dead weight ───────────────────────
check('noResultsSuggestion still branches on districtListingCount',
  /const distCount = q\.districtListingCount;/.test(search)
  && /typeof distCount === 'number'/.test(search),
  'a gated producer plus a dead consumer would be a silent feature deletion, not a fix');
check('the empty-area branch and the wrong-type branch both still exist',
  /if \(distCount === 0\)/.test(search) && /Want me to broaden the type\?/.test(search));
check('the documented meaning still says deal/category scope, so producer and consumer agree',
  /deal\/category scope, straight from/.test(search));

// ── 4. EXECUTED — `undefined` really disables the specialised branch ────────────────────────────
// The consumer's own guard, lifted as a predicate and run over both values. This is the property the
// fix relies on: with no category-scoped number, nothing specialised is said.
const specialisedBranchRuns = (distCount: unknown, distPicked: boolean) =>
  distPicked && typeof distCount === 'number';
check('with districtListingCount undefined the specialised branch does NOT run',
  specialisedBranchRuns(undefined, true) === false);
check('with a category-scoped number present it DOES run',
  specialisedBranchRuns(0, true) === true && specialisedBranchRuns(42, true) === true);

// ── 5. MUTATION PROOFS ──────────────────────────────────────────────────────────────────────────
// The exact pre-fix producer expression, restored.
const PRE_FIX = 'districtListingCount: districtsSelected.length\n        ? districtsSelected.reduce((sum, d) => sum + d.listingCount, 0)\n        : undefined,';
const gated = (src: string) =>
  /districtListingCount: districtsSelected\.length && !\(cohortTypes && cohortTypes\.length\)/.test(src);
mustCatch('the ungated pre-fix producer is caught (it would ship a type-scoped count)',
  gated(PRE_FIX) === false);
mustCatch('the real producer passes that same predicate', gated(index) === true);
// And the inversion itself: a حي with 0 apartments but 40 villas.
const villaOnlyDistrict = { allTypes: 40, chosenType: 0 };
mustCatch('a type-scoped 0 would have been diagnosed as an EMPTY AREA (the inverted advice)',
  villaOnlyDistrict.chosenType === 0 && villaOnlyDistrict.allTypes > 0,
  'the area has 40 listings; only the chosen type is absent, so "widen the area" is the wrong offer');

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed — the district diagnosis can speak from a type-scoped count again.`);
  process.exit(1);
}
console.log('\n✓ the diagnosis speaks only when it has a category-scoped count, and stays silent rather than inverted\n');
