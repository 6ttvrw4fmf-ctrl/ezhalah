// THE SCOPE PREFIX of the Advanced Filter interview (owner decision 2026-08-23).
//
//   CATEGORY → PROPERTY GROUP → PROPERTY TYPE → certified ADVANCED questions
//
// WHY THIS EXISTS
// ---------------
// «سكني» / «تجاري» is only the CATEGORY. It is not enough information to start asking about
// bathrooms, age or amenities — and, measured, it is not enough to ask ANYTHING: `cohortAllows()`
// intersects across every clean type in scope (afCohorts.ts:220) and treats an uncertified type as
// an EMPTY cohort (afCohorts.ts:226), so a category-only scope resolved to zero questions and the
// interview never opened at all. A GROUP-only scope was barely better: on 2026-08-23, 5 of the 8
// shipped groups could not open Advanced Filter on Buy and 5 of 8 could not on Rent. «Villas &
// Houses» is the worked example — in Riyadh / Rent / annual, `Villa` alone certifies SEVEN
// questions over 4,140 listings, and `Duplex`'s THREE listings zeroed all of them.
//
// The fix is to RESOLVE THE SCOPE, never to loosen the gate. Asking the user which group and which
// type they actually want makes the cohort intersection non-empty by narrowing, which is why
// afCohorts.ts:219-226 is deliberately untouched: relaxing `.every()` to a union would offer a
// question uncertified for a scoped type, and because the shared SQL predicates are strict-NULL-
// excluding, answering it would silently amputate that type's rows — the user asks for شقة+غرفة and
// gets zero غرفة back.
//
// WHY A SEPARATE MODULE, AND NOT `ADVANCED_QUESTIONS`
// ---------------------------------------------------
// A scope question is a PREREQUISITE, not a ranked peer: the advanced pool's own eligibility depends
// on its answer, and `rankQuestions()` probes that whole pool in one Promise.all. Routing scope
// questions through `scoreQuestion()` would also let its four usefulness gates delete a taxonomy
// branch — `MIN_REAL_OPTION_COUNT` (5) hides a real group with 4 listings, the narrowing gate
// (`optionNarrowsMeaningfully()`, owner 2026-08-25) retires a group with one populated type, and the 26-result floor retires the type
// step exactly where a narrow scope still needs it. A scope step must show what the taxonomy
// actually contains, so it deliberately bypasses that ranker.
//
// This module is PURE (no ./remote, no @/i18n) so a barrier can EXECUTE the real tier logic instead
// of grepping for it — the same reason afCohorts/afRanking/afSteps were extracted.
import type { SearchQuery } from '@/data/search';
import { groupsFor, groupsMembers, groupsOf, pruneTypesToGroups, type Macro } from '../data/propertyTypes.ts';
import { effectiveGroups, effectiveTypes } from './searchDefaults.ts';

export const SCOPE_GROUP_ID = 'property_group';
export const SCOPE_TYPE_ID = 'property_type';
export const SCOPE_QUESTION_IDS = [SCOPE_GROUP_ID, SCOPE_TYPE_ID] as const;
export type ScopeTier = (typeof SCOPE_QUESTION_IDS)[number];

// Category is never ASKED — it is chosen in the Filter home and is a precondition of the interview
// (emptyQuery() defaults it to Residential). It sits above the two asked tiers and, when the user
// changes it there, `setCategory()` already clears the group/type beneath it.
const DEFAULT_MACRO: Macro = 'Residential';
const macroOf = (q: SearchQuery): Macro => (q.category as Macro) ?? DEFAULT_MACRO;

export const isScopeQuestionId = (id: string): boolean =>
  (SCOPE_QUESTION_IDS as readonly string[]).includes(id);

// Which scope tiers are still UNRESOLVED, in ask order.
//
// An explicit TYPE pick resolves BOTH tiers — the user who already chose «فيلا» is not asked which
// group فيلا is in, nor which type they meant (owner: "IF THE USER ALREADY SELECTED A PROPERTY TYPE
// … Start directly with the certified Villa advanced questions"). A GROUP pick resolves only its own
// tier and the TYPE tier is still asked, scoped to that group.
export function unresolvedScopeTiers(q: SearchQuery): ScopeTier[] {
  if (effectiveTypes(q).length) return [];
  return effectiveGroups(q).length ? [SCOPE_TYPE_ID] : [SCOPE_GROUP_ID, SCOPE_TYPE_ID];
}

// The candidate option KEYS for a tier, straight from the canonical HIERARCHY — never hardcoded.
//
// GROUP: the groups of the current category only, so Villa can never be offered under «تجاري».
// TYPE:  the union of the SELECTED groups' member types (groups are OR'd, so a listing qualifies by
//        belonging to any of them). When the group step was SKIPPED there is no group predicate to
//        respect, so the candidates are every type in the category — skip means "I'm open", which
//        widens what may be OFFERED without narrowing anything (owner).
export function scopeCandidates(tier: ScopeTier, q: SearchQuery): string[] {
  const macro = macroOf(q);
  if (tier === SCOPE_GROUP_ID) return groupsFor(macro).map((g) => g.group);
  const groups = effectiveGroups(q);
  return groups.length ? groupsMembers(groups) : groupsFor(macro).flatMap((g) => g.types);
}

// Merge a scope answer into the query.
//
// EMPTY KEYS = SKIP = "I do not care / I am open" — it applies ZERO predicate and returns the query
// byte-identically, so the result count cannot move. Skip is never a "no", never false, and never
// silently selects the first option (owner, permanent).
//
// This writes ONLY the three scope fields. It deliberately does NOT mirror the Filter home's extra
// type-change side effects (clearing detail/priceBand, forcing beds=1 for Room): those are
// Normal-tier predicates, and the interview writing one would both break the owner's Normal-vs-
// Advanced boundary and desynchronise the option count from the search it promises — the count for
// each option is computed from THIS function, so count == search holds by construction.
export function applyScopeAnswer(tier: ScopeTier, q: SearchQuery, keys: string[]): SearchQuery {
  if (!keys.length) return q;
  if (tier === SCOPE_GROUP_ID)
    // Deselecting a group must take its orphaned types with it — the same prune the Filter home runs,
    // so a type can never survive as an active filter with no visible control (propertyTypes.ts).
    return { ...q, typeGroups: keys, types: pruneTypesToGroups(q.types, keys), type: null };
  // A type pick BACKFILLS its group when the group step was skipped: the Filter home gates the whole
  // type row on having a selected group, so a type with no group would render as an invisible filter.
  const groups = effectiveGroups(q);
  return { ...q, typeGroups: groups.length ? groups : groupsOf(keys), types: keys, type: null };
}

// The next scope tier to ask, or null when the scope is fully resolved. `askedIds` carries the ids
// already answered OR skipped this interview — a skipped tier is RESOLVED (the user said "I'm open"),
// so it is never re-asked, and the walk simply moves on to the tier below it.
export function nextScopeTier(q: SearchQuery, askedIds: ReadonlySet<string>): ScopeTier | null {
  return unresolvedScopeTiers(q).find((t) => !askedIds.has(t)) ?? null;
}
