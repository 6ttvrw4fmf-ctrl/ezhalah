// R1.1 — CATEGORY IS SINGLE-SELECT (canonical AF Product Contract §1.1)
//
// «Every group and property type shown afterward must belong to that category» (owner permanent
// rule). Category is a single toggle: tapping the current category clears it, tapping the other
// category CLEARS every downstream field (typeGroups, type, types, detail, beds, size). A
// cross-category scope must therefore be structurally impossible to construct via the normal UI,
// and even if one arrived via a URL, cohortAllows() must offer ZERO AF questions.
//
// This is enforced by EXECUTING the pure `setCategory()` and `cohortAllows()` from the plain
// modules (no browser, no RPC), which is what makes the invariant mutation-provable. Adding this
// barrier is the one action the ADVANCED_FILTER_PRODUCT_CONTRACT.md audit called out.

import { setCategory, HOME_DEFAULT_QUERY } from '../src/lib/searchDefaults.ts';
import { cohortAllows } from '../src/lib/afCohorts.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

console.log('\nAF R1.1: category is single-select\n');

// ── 1. setCategory clears the whole scope beneath it ────────────────────────────────────────────
const seed = {
  ...HOME_DEFAULT_QUERY(),
  category: 'Residential' as const,
  typeGroups: ['Apartments & Co-living'],
  type: 'Apartment',
  types: ['Apartment', 'Villa'],
  detail: '3',
  contextBeds: 3,
  contextBedsList: [3, 4],
  contextSize: { min: 100, max: 200 },
} as any;

const swapped = setCategory(seed, 'Commercial');
check('switching category sets category = Commercial', swapped.category === 'Commercial');
check('typeGroups cleared on switch', swapped.typeGroups === null);
check('type cleared on switch', swapped.type === null);
check('types cleared on switch', swapped.types === null);
check('detail cleared on switch', swapped.detail === null);
check('contextBeds cleared on switch', swapped.contextBeds === null);
check('contextBedsList cleared on switch', swapped.contextBedsList === null);
check('contextSize cleared on switch', swapped.contextSize === null);

const toggledOff = setCategory(seed, 'Residential');
check('tapping the SAME category clears it (null, not the same value)', toggledOff.category === null);
check('toggling off also clears typeGroups/type/types/detail', toggledOff.typeGroups === null && toggledOff.type === null && toggledOff.types === null && toggledOff.detail === null);

// ── 2. cohortAllows returns FALSE for a cross-category scope even if one is constructed ─────────
// A Residential-category scope with a Commercial type must yield zero AF questions — cohortAllows
// checks `q.category !== CLEAN_MACRO[type]` and rejects the whole scope.
const crossCategory = { category: 'Residential', type: 'Factory' } as any; // Factory is Commercial
check('cross-category (Res + Factory) offers zero AF questions — property_age',
  cohortAllows(crossCategory, 'property_age') === false);
check('cross-category (Res + Factory) offers zero AF questions — amenities',
  cohortAllows(crossCategory, 'amenities') === false);
check('cross-category (Res + Factory) offers zero AF questions — street_width',
  cohortAllows(crossCategory, 'street_width') === false);

const crossCategory2 = { category: 'Commercial', type: 'Apartment' } as any;
check('cross-category (Com + Apartment) offers zero AF questions',
  cohortAllows(crossCategory2, 'property_age') === false
  && cohortAllows(crossCategory2, 'amenities') === false);

// Sanity: a matched scope DOES allow at least one certified question — the negatives above
// prove the guard is doing the work, not that cohortAllows always returns false.
const matched = { category: 'Residential', type: 'Apartment', deal: 'Rent' } as any;
check('sanity: matched scope (Res + Apartment + Rent) DOES allow property_age',
  cohortAllows(matched, 'property_age') === true);

console.log(failed ? `\n✗ ${failed} check(s) FAILED — category single-select contract broken` : '\n✓ AF R1.1 intact: category is single-select, cross-category scope offers zero AF questions');
process.exit(failed ? 1 : 0);
