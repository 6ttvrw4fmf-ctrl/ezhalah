// PERMANENT BARRIER — Category → Group(s) → Type(s) → Advanced Filter (owner decision 2026-08-20).
//
// THE RULE, in the owner's words:
//   "multiple groups = OR inside the group dimension; multiple types = OR inside the type dimension;
//    all other dimensions remain AND; AF questions for multiple selected types = safe intersection
//    across all selected types/cohorts; if period is also combined, intersect across both type AND
//    period simultaneously; never use question union if answering that question would silently
//    remove one selected cohort/type."
//
// WHY OR ACROSS GROUPS IS NOT A PREFERENCE: a listing belongs to exactly one group, so AND across two
// groups matches nothing. "Apartments + Villas" under AND returns zero rows — the feature would look
// broken rather than wrong. Same for exact types.
//
// WHY INTERSECTION FOR AF QUESTIONS: the shared SQL predicates are strict-NULL-excluding — a row with
// no value for the answered field FAILS the filter, it does not pass through as "unknown". So a
// question certified for only one of the selected types amputates the other type's inventory the
// moment it is answered. The identical argument already governs mixed PERIODS in cohortAllows(); this
// extends it to the TYPE dimension, and both intersect at once.
//
// EXECUTED, NOT GREPPED. The scope helpers were deliberately placed in pure modules (@/lib/afCohorts,
// @/lib/searchDefaults, @/data/propertyTypes) precisely so this file can call the REAL shipped
// functions. Three assertions are mutation-proven — flip the operator in the source and they fail:
//   M1 multi-group OR → AND        M2 AF union instead of intersection      M3 stale type kept
//
//   node --experimental-strip-types scripts/verify-multi-group-scope.ts     (wired into `npm test`)
import type { SearchQuery } from '../src/data/search.ts';
import { groupMembers, groupsMembers, pruneTypesToGroups, typeArForSelection, typeArForTypes } from '../src/data/propertyTypes.ts';
import { effectiveGroups, effectiveTypes, toggleGroup, typesForGroups, migrateGroups, sanitizeForFilterRestore, hasActiveFilters, HOME_DEFAULT_QUERY, setCategory } from '../src/lib/searchDefaults.ts';
import { cohortAllows, scopeCleanTypes, intersectChips } from '../src/lib/afCohorts.ts';
import { detailForContext } from '../src/data/taxonomy.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};
const q = (over: Partial<SearchQuery> = {}): SearchQuery =>
  ({ ...HOME_DEFAULT_QUERY(), category: 'Residential', ...over }) as SearchQuery;

const APTS = 'Apartments & Co-living';
const VILLAS = 'Villas & Houses';
const PLOTS = 'Residential Plots';
const RETAIL = 'Retail & Workspace';

// ── 1. THE GROUP DIMENSION ───────────────────────────────────────────────────────────────────────
check('effectiveGroups: none → []', effectiveGroups(q()).length === 0);
check('effectiveGroups: one → that one', effectiveGroups(q({ typeGroups: [VILLAS] })).join() === VILLAS);
check('effectiveGroups: many → all, in order',
  effectiveGroups(q({ typeGroups: [APTS, VILLAS] })).join('|') === `${APTS}|${VILLAS}`);

// M1 — MULTI-GROUP IS OR. Mutation-proof: an AND/intersection implementation returns the EMPTY set
// here (no clean type is in two groups), so this assertion cannot pass under AND.
const arApts = typeArForSelection(APTS) ?? [];
const arVillas = typeArForSelection(VILLAS) ?? [];
const arBoth = typeArForTypes([APTS, VILLAS]) ?? [];
const union = new Set([...arApts, ...arVillas]);
check('M1 multi-group = OR: the two groups resolve to the UNION of their Arabic types',
  arBoth.length === union.size && [...union].every((a) => arBoth.includes(a)),
  `union=${union.size} got=${arBoth.length}`);
check('M1 non-vacuous: the union is strictly larger than either group alone',
  arBoth.length > arApts.length && arBoth.length > arVillas.length);
check('M1 an AND reading would be empty (no clean type belongs to two groups)',
  groupMembers(APTS).filter((ty) => groupMembers(VILLAS).includes(ty)).length === 0);

// Types shown under several groups = union of members.
check('type boxes = union of members', (() => {
  const shown = typesForGroups(q({ typeGroups: [APTS, VILLAS] }));
  return groupMembers(APTS).every((t) => shown.includes(t))
      && groupMembers(VILLAS).every((t) => shown.includes(t))
      && shown.length === new Set(shown).size;                 // deduped
})());
check('groupsMembers([]) is empty; unknown group contributes nothing',
  groupsMembers([]).length === 0 && groupsMembers(['No Such Group']).length === 0);

// ── 2. THE TYPE DIMENSION (OR) ───────────────────────────────────────────────────────────────────
check('multi-type = OR: 4 picked types resolve to the union of each type alone', (() => {
  const picked = ['Apartment', 'Studio', 'Villa', 'Duplex'];
  const got = typeArForTypes(picked) ?? [];
  const want = new Set(picked.flatMap((t) => typeArForSelection(t) ?? []));
  return got.length === want.size && [...want].every((a) => got.includes(a));
})());
check('effectiveTypes covers single (agent) and multi (filter) shapes',
  effectiveTypes(q({ type: 'Villa' })).join() === 'Villa'
  && effectiveTypes(q({ types: ['Villa', 'Duplex'] })).join('|') === 'Villa|Duplex');

// ── 3. M3 — INVALID TYPES ARE DROPPED WHEN THEIR GROUP GOES ──────────────────────────────────────
check('M3 pruneTypesToGroups keeps only types still covered by a selected group',
  (pruneTypesToGroups(['Villa', 'Apartment'], [VILLAS]) ?? []).join() === 'Villa');
check('M3 pruning to no groups yields null (not [])',
  pruneTypesToGroups(['Villa'], []) === null);
check('M3 toggleGroup removes the orphaned type when its group is deselected', (() => {
  // Villas + Apartments, one type from each, then Villas is switched off.
  const before = q({ typeGroups: [APTS, VILLAS], types: ['Apartment', 'Villa'] });
  const after = toggleGroup(before, VILLAS);
  return effectiveGroups(after).join() === APTS && (after.types ?? []).join() === 'Apartment';
})(), 'a type whose group was removed must not survive — the type row is hidden, so it would be an invisible active filter');
check('M3 toggleGroup ADDING a group keeps existing valid types', (() => {
  const after = toggleGroup(q({ typeGroups: [APTS], types: ['Apartment'] }), VILLAS);
  return (after.types ?? []).join() === 'Apartment' && effectiveGroups(after).length === 2;
})());
check('toggleGroup preserves user-typed price/area (they are type-independent)', (() => {
  const after = toggleGroup(q({ typeGroups: [APTS], priceMin: '5000', areaMax: '300' }), VILLAS);
  return after.priceMin === '5000' && after.areaMax === '300';
})());
check('toggleGroup clears type-DERIVED state (single type / detail / bed context)', (() => {
  const after = toggleGroup(q({ typeGroups: [APTS], type: 'Apartment', detail: '3', contextBedsList: ['3'] }), VILLAS);
  return after.type === null && after.detail === null && after.contextBedsList === null;
})());
check('deselecting the last group leaves typeGroups null (never [])',
  toggleGroup(q({ typeGroups: [APTS] }), APTS).typeGroups === null);

// ── 3b. CHANGING CATEGORY CLEARS THE SCOPE BENEATH IT ────────────────────────────────────────────
// REGRESSION GUARD: the old inline handler cleared `typeGroup`. When that field was replaced by
// `typeGroups`, the write silently became a no-op — TypeScript cannot catch an extra property on an
// object spread — so switching category would have kept Residential groups selected under
// Commercial. Executed against the real writer so it cannot rot the same way twice.
check('changing category clears groups, types and every type-derived field', (() => {
  const before = q({ category: 'Residential', typeGroups: [APTS, VILLAS], types: ['Apartment'], detail: '3', contextBedsList: ['3'] });
  const after = setCategory(before, 'Commercial');
  return after.category === 'Commercial'
    && after.typeGroups === null && after.types === null
    && after.type === null && after.detail === null && after.contextBedsList === null;
})(), 'a Residential group must never survive a switch to Commercial');
// Owner ruling 2026-08-30: a search always lands on exactly one category, so a re-tap is a NO-OP
// rather than a deselect — and it must not wipe the groups the user has already chosen underneath.
check('re-tapping the active category keeps it selected and preserves the scope', (() => {
  const before = q({ category: 'Residential', typeGroups: [APTS] });
  const after = setCategory(before, 'Residential');
  return after.category === 'Residential' && after.typeGroups === before.typeGroups;
})());

// ── 4. M2 — AF QUESTIONS INTERSECT ACROSS TYPES (never union) ────────────────────────────────────
// Apartment/Buy certifies bathrooms; Residential Building/Buy does NOT. Union would offer it and
// delete every Residential Building row on answer.
const aptBldgBuy = q({ deal: 'Buy', types: ['Apartment', 'Residential Building'] });
check('M2 a question certified for only ONE selected type is NOT offered',
  cohortAllows(aptBldgBuy, 'bathrooms') === false);
check('M2 non-vacuous: a question certified for BOTH selected types IS offered',
  cohortAllows(q({ deal: 'Buy', types: ['Apartment', 'Villa'] }), 'property_age') === true,
  'kills the always-false mutant — intersection must still allow shared questions');
check('M2 single-type behaviour is unchanged (Apartment/Buy still offers bathrooms)',
  cohortAllows(q({ deal: 'Buy', types: ['Apartment'] }), 'bathrooms') === true);
check('an UNCERTIFIED type in the scope zeroes every question',
  ['property_age', 'amenities', 'bathrooms', 'direction', 'rnpl'].every(
    (id) => cohortAllows(q({ deal: 'Buy', types: ['Apartment', 'Camp'] }), id) === false));
check('an empty scope offers nothing ([].every() must not read as "allow all")',
  ['property_age', 'amenities', 'bathrooms'].every((id) => cohortAllows(q(), id) === false));
check('a cross-category type cannot be offered questions',
  cohortAllows(q({ category: 'Residential', deal: 'Buy', types: ['Apartment', 'Office'] }), 'property_age') === false);

// ── 5. BOTH DIMENSIONS INTERSECT SIMULTANEOUSLY (type × period) ──────────────────────────────────
const bothPeriodMulti = q({ deal: 'Rent', rentPeriod: 'both', types: ['Apartment', 'Room'] });
check('type × period: an Annual-only question is refused on a combined-period multi-type scope',
  cohortAllows(bothPeriodMulti, 'rnpl') === false);
check('type × period: a Monthly-only question is refused too',
  cohortAllows(bothPeriodMulti, 'rating') === false);
check('period intersection still works on a SINGLE type (unchanged behaviour)',
  cohortAllows(q({ deal: 'Rent', rentPeriod: 'both', types: ['Apartment'] }), 'rnpl') === false
  && cohortAllows(q({ deal: 'Rent', rentPeriod: 'annual', types: ['Apartment'] }), 'rnpl') === true);

// ── 6. AMENITY CHIPS INTERSECT ───────────────────────────────────────────────────────────────────
check('chips: two commercial types share the certified utility trio',
  (intersectChips(['Office', 'Shop']) ?? []).sort().join() === ['electricity', 'sanitation', 'water_supply'].sort().join());
check('chips: disagreeing types offer NONE rather than one side’s list',
  (intersectChips(['Office', 'Apartment']) ?? ['x']).length === 0);
check('chips: types with no cohort list keep the base set (null)',
  intersectChips(['Apartment', 'Villa']) === null);

// ── 7. SCOPE FROM GROUPS (no explicit type) ──────────────────────────────────────────────────────
check('scopeCleanTypes: explicit types win', scopeCleanTypes(q({ typeGroups: [APTS], types: ['Villa'] })).join() === 'Villa');
check('scopeCleanTypes: group-only expands to the group members',
  scopeCleanTypes(q({ typeGroups: [PLOTS] })).join() === groupMembers(PLOTS).join());
check('group-only AF is the members’ intersection, not a free pass',
  cohortAllows(q({ deal: 'Buy', typeGroups: [RETAIL] }), 'street_width')
    === groupMembers(RETAIL).every((ty) => cohortAllows(q({ deal: 'Buy', types: [ty] }), 'street_width')));

// ── 8. BEDROOMS INTERSECT (a land group must not offer a bed filter that deletes land rows) ──────
check('beds: dwelling group alone → shown', detailForContext('Residential', [VILLAS])?.showBeds === true);
check('beds: dwelling + land groups → hidden (intersection)', detailForContext('Residential', [VILLAS, PLOTS])?.showBeds === false);
check('beds: bare Residential (no group) unchanged → shown', detailForContext('Residential', [])?.showBeds === true);
check('beds: Commercial unchanged → hidden', detailForContext('Commercial', [])?.showBeds === false);

// ── 9. PERSISTED STATE: OLD SAVED SEARCHES, RESTORE, RESET ───────────────────────────────────────
check('migrateGroups converts a legacy single typeGroup to the array', (() => {
  const out = migrateGroups({ typeGroup: VILLAS } as Partial<SearchQuery>);
  return (out.typeGroups ?? []).join() === VILLAS && !('typeGroup' in out);
})(), 'an old saved search must reopen with its group intact');
check('migrateGroups never overwrites an existing multi-select', (() => {
  const out = migrateGroups({ typeGroup: VILLAS, typeGroups: [APTS, PLOTS] } as Partial<SearchQuery>);
  return (out.typeGroups ?? []).join('|') === `${APTS}|${PLOTS}`;
})());
check('migrateGroups on a query with neither field yields null',
  migrateGroups({} as Partial<SearchQuery>).typeGroups === null);
check('restore keeps groups AND prunes types orphaned by them', (() => {
  const restored = sanitizeForFilterRestore(q({ typeGroups: [VILLAS], types: ['Villa', 'Apartment'] }));
  return (restored.typeGroups ?? []).join() === VILLAS && (restored.types ?? []).join() === 'Villa';
})());
check('restore migrates a LEGACY entry (single group) end to end', (() => {
  const restored = sanitizeForFilterRestore({ ...q(), typeGroup: VILLAS, types: ['Villa'] } as unknown as SearchQuery);
  return (restored.typeGroups ?? []).join() === VILLAS && (restored.types ?? []).join() === 'Villa';
})());
check('Clear All / New Chat default carries no group or type',
  !HOME_DEFAULT_QUERY().typeGroups && !HOME_DEFAULT_QUERY().types);
check('a selected group counts as an active filter (Clear All appears)',
  hasActiveFilters(q({ typeGroups: [VILLAS] })) === true && hasActiveFilters(HOME_DEFAULT_QUERY()) === false);

console.log(failed === 0 ? '\n✅ multi-group / multi-type scope contract holds.' : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
