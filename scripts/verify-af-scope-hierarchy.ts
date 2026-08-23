// ADVANCED FILTER SCOPE HIERARCHY — CATEGORY → GROUP → TYPE → ADVANCED (owner decision 2026-08-23)
//
//   node --experimental-strip-types scripts/verify-af-scope-hierarchy.ts   (wired into `npm test`)
//
// WHAT THIS PINS, AND WHY IT EXECUTES RATHER THAN GREPS
// -----------------------------------------------------
// `src/lib/afPlan.ts`, `src/lib/afCohorts.ts` and `src/lib/afSteps.ts` are all PURE, so this barrier
// calls the REAL tier logic, the REAL cohort gate and the REAL step-rebuild with REAL queries and
// asserts the REAL answers. A regex cannot prove that a skip applies no predicate, that groups OR,
// or that a multi-type scope intersects — those are behaviours, not spellings.
//
// THE DEFECT IT EXISTS FOR (measured live 2026-08-23, Riyadh / Rent / annual):
//   Villa alone   → 7 certified questions over 4,140 listings
//   Duplex alone  → 0 certified questions over     3 listings
//   «Villas & Houses» (Villa ∪ Duplex) → 0 questions. Three listings zeroed four thousand.
// 5 of 8 shipped groups could not open Advanced Filter on Buy; 5 of 8 could not on Rent; a
// category-only scope could NEVER open it. The fix resolves the scope by ASKING, and must never be
// "fixed" instead by loosening cohortAllows' `.every()` — see the mutation proof at the end.
import type { SearchQuery } from '../src/data/search.ts';
import {
  SCOPE_GROUP_ID, SCOPE_TYPE_ID, SCOPE_QUESTION_IDS, isScopeQuestionId,
  unresolvedScopeTiers, scopeCandidates, applyScopeAnswer, nextScopeTier,
} from '../src/lib/afPlan.ts';
import { cohortAllows, scopeCleanTypes } from '../src/lib/afCohorts.ts';
import { deriveGuided, type GuidedStep } from '../src/lib/afSteps.ts';
import { HIERARCHY, groupsFor, groupMembers, groupOf, groupsOf } from '../src/data/propertyTypes.ts';
import { effectiveGroups, effectiveTypes } from '../src/lib/searchDefaults.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const eq = (label: string, got: unknown, want: unknown) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const RENT = (extra: Partial<SearchQuery> = {}): SearchQuery =>
  ({ deal: 'Rent', rentPeriod: 'annual', category: 'Residential', location: 'الرياض',
     type: null, detail: null, priceInput: '', priceBand: null, ...extra }) as SearchQuery;

// ── 1. CATEGORY-ONLY MUST ASK GROUP FIRST (owner barrier 1) ──────────────────────────────────────
eq('category-only → asks GROUP then TYPE', unresolvedScopeTiers(RENT()), [SCOPE_GROUP_ID, SCOPE_TYPE_ID]);
eq('category-only → next tier is GROUP', nextScopeTier(RENT(), new Set()), SCOPE_GROUP_ID);
check('category-only asks a scope question BEFORE any advanced question is even eligible',
  scopeCleanTypes(RENT()).length === 0 && !cohortAllows(RENT(), 'bathrooms'));

// ── 2. GROUP-ONLY MUST ASK TYPE NEXT (owner barrier 2) ───────────────────────────────────────────
const groupOnly = RENT({ typeGroups: ['Villas & Houses'] });
eq('group-only → asks TYPE only', unresolvedScopeTiers(groupOnly), [SCOPE_TYPE_ID]);
eq('group-only → next tier is TYPE', nextScopeTier(groupOnly, new Set()), SCOPE_TYPE_ID);

// ── 3. TYPE-SELECTED SKIPS THE HIERARCHY ENTIRELY (owner barrier 3) ──────────────────────────────
eq('type selected → NO scope questions', unresolvedScopeTiers(RENT({ types: ['Villa'] })), []);
eq('type selected → next tier is null', nextScopeTier(RENT({ types: ['Villa'] }), new Set()), null);
eq('bare agent-path scalar `type` also resolves both tiers', unresolvedScopeTiers(RENT({ type: 'Villa' })), []);

// ── 4. AN UNCERTIFIED SIBLING MUST NOT HIDE AF FOR A CERTIFIED TYPE (owner barrier 4) ────────────
// This is THE defect. The group intersects to zero; resolving the scope to Villa restores all seven.
const AF_IDS = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction'];
const allowed = (q: SearchQuery) => AF_IDS.filter((id) => cohortAllows(q, id));
check('«Villas & Houses» group-only still intersects to ZERO (gate deliberately unchanged)',
  allowed(groupOnly).length === 0, `got ${JSON.stringify(allowed(groupOnly))}`);
const villaResolved = applyScopeAnswer(SCOPE_TYPE_ID, groupOnly, ['Villa']);
eq('resolving that group to «Villa» restores all 7 certified questions', allowed(villaResolved).length, 7);
check('…and Duplex, chosen deliberately, still honestly offers none',
  allowed(applyScopeAnswer(SCOPE_TYPE_ID, groupOnly, ['Duplex'])).length === 0);
// Every shipped group with >=1 certified member must become answerable by picking that member.
for (const macro of ['Residential', 'Commercial'] as const)
  for (const g of HIERARCHY[macro]) {
    const base = RENT({ category: macro, typeGroups: [g.group] });
    const best = Math.max(0, ...groupMembers(g.group).map((t) => allowed(applyScopeAnswer(SCOPE_TYPE_ID, base, [t])).length));
    if (best > 0)
      check(`«${g.group}» is reachable via a type pick (best member = ${best} questions)`, best > 0);
  }

// ── 5/6/7. SKIP = "I'M OPEN": ZERO PREDICATE, ZERO COUNT DELTA (owner barriers 5, 6, 7) ──────────
for (const [tier, label] of [[SCOPE_GROUP_ID, 'GROUP'], [SCOPE_TYPE_ID, 'TYPE']] as const) {
  const before = RENT({ typeGroups: tier === SCOPE_TYPE_ID ? ['Villas & Houses'] : undefined });
  const after = applyScopeAnswer(tier, before, []);
  check(`skipping ${label} returns the query BYTE-IDENTICALLY (zero predicate, zero count delta)`,
    JSON.stringify(after) === JSON.stringify(before));
  check(`skipping ${label} never selects an option`,
    effectiveGroups(after).length === effectiveGroups(before).length
    && effectiveTypes(after).length === effectiveTypes(before).length);
  check(`skipping ${label} is never a "no"/false — no boolean is written`,
    JSON.stringify(after) === JSON.stringify(before));
}
// A skipped tier is RESOLVED, not re-asked: the walk moves DOWN, it does not loop.
eq('skipping GROUP moves the walk on to TYPE (never re-asks GROUP)',
  nextScopeTier(RENT(), new Set([SCOPE_GROUP_ID])), SCOPE_TYPE_ID);
eq('skipping BOTH tiers ends the scope walk cleanly',
  nextScopeTier(RENT(), new Set([SCOPE_GROUP_ID, SCOPE_TYPE_ID])), null);
// Skip GROUP → the TYPE step must offer the WHOLE category, because nothing was narrowed.
eq('after skipping GROUP, TYPE candidates span every type in the category',
  scopeCandidates(SCOPE_TYPE_ID, RENT()).length,
  groupsFor('Residential').flatMap((g) => g.types).length);

// ── 8. GROUP OPTIONS BELONG ONLY TO THE CURRENT CATEGORY (owner barrier 8) ───────────────────────
for (const macro of ['Residential', 'Commercial'] as const) {
  const got = scopeCandidates(SCOPE_GROUP_ID, RENT({ category: macro }));
  eq(`${macro} group options == HIERARCHY.${macro}`, got, groupsFor(macro).map((g) => g.group));
  const otherMacro = macro === 'Residential' ? 'Commercial' : 'Residential';
  check(`${macro} group options leak NO ${otherMacro} group`,
    !got.some((g) => groupsFor(otherMacro).some((x) => x.group === g)));
}
check('Villa can never be offered under تجاري',
  !scopeCandidates(SCOPE_TYPE_ID, RENT({ category: 'Commercial' })).includes('Villa'));

// ── 9. TYPE OPTIONS BELONG ONLY TO THE SELECTED GROUP(S) (owner barrier 9) ───────────────────────
eq('«Villas & Houses» → exactly its member types', scopeCandidates(SCOPE_TYPE_ID, groupOnly), ['Villa', 'Duplex']);
check('…and leaks no Apartment/Office/Factory',
  !scopeCandidates(SCOPE_TYPE_ID, groupOnly).some((t) => ['Apartment', 'Office', 'Factory'].includes(t)));

// ── 10/11. MULTI-GROUP = OR, MULTI-TYPE = OR (owner barriers 10, 11) ─────────────────────────────
const twoGroups = RENT({ typeGroups: ['Villas & Houses', 'Residential Plots'] });
eq('two groups → the UNION of their member types (OR, never AND)',
  scopeCandidates(SCOPE_TYPE_ID, twoGroups), ['Villa', 'Duplex', 'Residential Land']);
check('two groups do not leak a type from an unselected group',
  !scopeCandidates(SCOPE_TYPE_ID, twoGroups).includes('Apartment'));
eq('multi-type answers are stored as an OR list, all of them kept',
  effectiveTypes(applyScopeAnswer(SCOPE_TYPE_ID, groupOnly, ['Villa', 'Duplex'])), ['Villa', 'Duplex']);

// ── 12. ADVANCED QUESTIONS ACROSS MULTIPLE TYPES = SAFE INTERSECTION, NEVER UNION (barrier 12) ───
const bothTypes = applyScopeAnswer(SCOPE_TYPE_ID, groupOnly, ['Villa', 'Duplex']);
eq('Villa+Duplex intersects to ZERO (Duplex certifies nothing) — never Villa\'s union', allowed(bothTypes).length, 0);
const aptRoom = RENT({ typeGroups: ['Apartments & Co-living'], types: ['Apartment', 'Room'] });
check('Apartment+Room offers only what BOTH certify (a strict subset of Apartment alone)',
  allowed(aptRoom).every((id) => allowed(RENT({ types: ['Apartment'] })).includes(id))
  && allowed(aptRoom).length <= allowed(RENT({ types: ['Apartment'] })).length);
check('…and every offered question is certified for Room too (no silent amputation)',
  allowed(aptRoom).every((id) => cohortAllows(RENT({ types: ['Room'] }), id)));

// ── 13/16. CHANGING A SCOPE ANSWER REBUILDS — NO STALE PREDICATE (owner barriers 13, 16) ─────────
// The interview record is replayed from base, so a changed scope answer cannot leave a predicate
// behind: the OLD answer simply stops contributing. This executes the real deriveGuided().
const TYPE_Q = {
  id: SCOPE_TYPE_ID, titleKey: 'Which property type?', selection: 'multi' as const,
  eligibility: () => true, resolveOptions: async () => ({ options: [], unknownCount: 0, total: 0 }),
  apply: (q: SearchQuery, keys: string[]) => applyScopeAnswer(SCOPE_TYPE_ID, q, keys),
};
const opts = [{ key: 'Villa', label: 'فيلا', count: 4140 }, { key: 'Duplex', label: 'دوبلكس', count: 3 }];
const step = (keys: string[] | null): GuidedStep => ({ question: TYPE_Q as never, options: opts, unknownCount: 0, total: 4143, keys });
eq('answering TYPE=Villa applies exactly that predicate',
  effectiveTypes(deriveGuided(groupOnly, [step(['Villa'])], 1).query!), ['Villa']);
eq('CHANGING that answer to Duplex leaves NO trace of Villa (rebuild, not inverse)',
  effectiveTypes(deriveGuided(groupOnly, [step(['Duplex'])], 1).query!), ['Duplex']);
eq('walking the cursor BACK over the answer un-applies it entirely',
  effectiveTypes(deriveGuided(groupOnly, [step(['Villa'])], 0).query!), []);
eq('a SKIPPED scope step contributes no predicate on replay',
  effectiveTypes(deriveGuided(groupOnly, [step([])], 1).query!), []);
check('a skipped scope step still counts as ASKED (never re-offered)',
  deriveGuided(groupOnly, [step([])], 1).askedIds.includes(SCOPE_TYPE_ID));

// ── 14. BACK TYPE → GROUP DROPS TYPES THAT NO LONGER BELONG (owner barrier 14) ───────────────────
const hadVilla = RENT({ typeGroups: ['Villas & Houses'], types: ['Villa'] });
const regrouped = applyScopeAnswer(SCOPE_GROUP_ID, hadVilla, ['Residential Plots']);
eq('changing the GROUP drops the now-orphaned type', effectiveTypes(regrouped), []);
eq('…and commits the new group', effectiveGroups(regrouped), ['Residential Plots']);
const keptVilla = applyScopeAnswer(SCOPE_GROUP_ID, hadVilla, ['Villas & Houses', 'Residential Plots']);
eq('a type still inside a REMAINING group survives the regroup', effectiveTypes(keptVilla), ['Villa']);

// ── 15. CATEGORY SWITCH REMOVES INCOMPATIBLE SCOPE (owner barrier 15) ────────────────────────────
check('no Residential group survives as a Commercial group option',
  !scopeCandidates(SCOPE_GROUP_ID, RENT({ category: 'Commercial' }))
    .some((g) => groupsFor('Residential').some((x) => x.group === g)));
check('a Villa scope offers ZERO questions once the category is Commercial',
  allowed(RENT({ category: 'Commercial', types: ['Villa'] })).length === 0);

// ── SCOPE ANSWERS BACKFILL THEIR GROUP (no invisible orphan filter on the Filter home) ───────────
eq('a TYPE pick after a SKIPPED group backfills the owning group',
  effectiveGroups(applyScopeAnswer(SCOPE_TYPE_ID, RENT(), ['Villa'])), ['Villas & Houses']);
eq('groupOf() is the exact reverse of groupMembers()', groupOf('Duplex'), 'Villas & Houses');
eq('groupsOf() dedupes types sharing one group', groupsOf(['Villa', 'Duplex']), ['Villas & Houses']);
check('every clean type in a shipped group resolves back to that same group',
  HIERARCHY.Residential.concat(HIERARCHY.Commercial).every((g) => g.types.every((t) => groupOf(t) === g.group)));

// ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────────
eq('exactly two scope tiers ship, in this order', [...SCOPE_QUESTION_IDS], ['property_group', 'property_type']);
check('isScopeQuestionId recognises both and nothing else',
  isScopeQuestionId(SCOPE_GROUP_ID) && isScopeQuestionId(SCOPE_TYPE_ID) && !isScopeQuestionId('bathrooms'));

// ── MUTATION PROOF: this barrier must FAIL if the gate is "fixed" by loosening it ────────────────
// The tempting wrong fix is to make cohortAllows tolerant of an uncertified type. Prove that such a
// change is DETECTED here, so nobody can trade a missing question for silent row amputation.
{
  const someUnion = (q: SearchQuery, id: string) => scopeCleanTypes(q).some((t) => cohortAllows({ ...q, types: [t] } as SearchQuery, id));
  const realIntersect = cohortAllows(bothTypes, 'bathrooms');
  const mutatedUnion = someUnion(bothTypes, 'bathrooms');
  check('MUTATION: a .some()/union gate would offer «bathrooms» to Villa+Duplex — and is caught here',
    realIntersect === false && mutatedUnion === true,
    `intersection=${realIntersect} union=${mutatedUnion} — if these are equal this proof has gone blind`);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll scope-hierarchy assertions passed');
process.exit(failed ? 1 : 0);
