// CARRYING A COMMITTED ADVANCED FILTER BACK ONTO THE FILTER SCREEN — safely (owner P0 2026-09-01).
//
// THE DEFECT THIS CLOSES. Every Advanced Filter answer lived only in agent.tsx component state. The
// Filter home, its Trending city/district counts and its «بحث» all read the shared store's
// SearchQuery, so returning to the Filter screen and searching again re-ran the PRE-AF query.
// Measured live on production 2026-09-01 (الرياض / إيجار / سنوي / تجاري / محل, «عمر العقار: جديد»):
// the committed set was 243; going back to the Filter screen and pressing «بحث» — through a Trending
// city card, a Trending district card, a different city, or with Trending never touched at all —
// returned 566, with `p_is_new_construction` simply absent from the request body. Same for
// amenities (248 → 566). Trending's own row counts were computed from the same stripped query, so
// the numbers it advertised were the numbers it delivered: consistently, silently wrong together.
//
// THE COUNTER-REQUIREMENT IT MUST NOT BREAK. sanitizeForFilterRestore is a strict allowlist for a
// measured P1: an AF predicate parked in the Filter store with NO on-screen control representing it
// silently amputated an unrelated search (a leaked ratingMin returned 0 of 11,552 on
// الرياض/شراء/فيلا). Both rules are permanent and they are only reconcilable one way — the carried
// predicates must be VISIBLE and REMOVABLE on the Filter screen. `q.afFacets` is what makes them so,
// which is why it is the permission slip the sanitizer checks.
//
// THIS MODULE IS PURE (no ./remote, no React) so a barrier can EXECUTE it instead of grepping for
// it — the same reason afCohorts/afPlan/afRanking were extracted.
import type { SearchQuery } from '@/data/search';
import { cohortAllows } from './afCohorts.ts';
import { isScopeQuestionId } from './afPlan.ts';
import { AF_PREDICATE_FIELDS } from './searchDefaults.ts';

export { AF_PREDICATE_FIELDS };

export type CommittedFacet = { id: string; keys: string[]; labels: string[] };

/** The question objects this module needs. Structurally satisfied by AdvancedQuestion. */
type Applier = { id: string; apply: (q: SearchQuery, keys: string[]) => SearchQuery };

/**
 * Which committed facets are STILL certified for the query's current cohort.
 *
 * The Filter screen can move the cohort under a carried answer — change فئة, deselect the group,
 * pick a different نوع, switch شراء/إيجار or شهري/سنوي. The AF's shared SQL predicates are
 * strict-NULL-excluding, so replaying `bathMin: 3` onto a type whose bathroom coverage was never
 * certified does not narrow honestly — it deletes every row that never stated a bathroom count,
 * i.e. it turns UNKNOWN into No. cohortAllows() is the same gate that decided the question could be
 * ASKED; it is the only gate that may decide the answer can still be APPLIED.
 *
 * Scope facets (group/type) are never dropped by this: they carry no strict predicate of their own,
 * and dropping one would widen the search past anything the user asked for.
 *
 * Note this is a READ-TIME derivation, not a write: changing the type away and back re-admits the
 * user's own still-visible answer rather than destroying it. Deliberate — what is searched, what is
 * counted and what is on screen are all derived from this one call, so they cannot disagree.
 */
export function certifiedFacets(q: SearchQuery, facets: readonly CommittedFacet[]): CommittedFacet[] {
  return facets.filter((f) => isScopeQuestionId(f.id) || cohortAllows(q, f.id));
}

/**
 * The query that must actually be searched, counted and displayed on the Filter screen.
 *
 * Clears every AF predicate, then re-applies only the still-certified facets through each
 * question's OWN apply() — never a hand-written inverse, and spanning BOTH pools (ADVANCED_QUESTIONS
 * ∪ SCOPE_QUESTIONS) because a scope facet whose question could not be resolved would be silently
 * dropped and quietly widen the search. That is byte-for-byte the rebuild removeGuidedFacet already
 * performs in agent.tsx, so removing a chip on either screen means the same thing.
 *
 * A query with no facets is returned UNTOUCHED (identity), so nothing in the app changes shape until
 * an Advanced Filter round has actually committed something.
 */
export function reconcileCommittedAf(q: SearchQuery, questions: readonly Applier[]): SearchQuery {
  const facets = q.afFacets ?? [];
  if (!facets.length) return q;
  const kept = certifiedFacets(q, facets);
  const out: SearchQuery = { ...stripCommittedAf(q), afFacets: kept };
  return kept.reduce((acc, f) => {
    const question = questions.find((x) => x.id === f.id);
    return question ? question.apply(acc, f.keys) : acc;
  }, out);
}

/**
 * The query as it was BEFORE any Advanced Filter answer — every AF predicate and the receipt gone.
 *
 * This is the interview's true origin, and it is DERIVED rather than carried: because the AF writes
 * only the fields in AF_PREDICATE_FIELDS, removing them reconstructs the pre-AF query exactly, with
 * no second copy to drift. Used when a Filter search arrives already carrying committed answers, so
 * a NEW round anchors its removable pills to the same origin an uninterrupted conversation would
 * have — otherwise removing a carried chip would rebuild from a base that still contained it, and
 * the removal would silently do nothing.
 *
 * Scope-tier fields survive on purpose: a committed property type is a Normal-tier field with its own
 * control on the Filter screen, and stripping it would widen the search past anything the user asked
 * for (the same reason scope pills are not removable in the chat).
 */
export function stripCommittedAf(q: SearchQuery): SearchQuery {
  const out: SearchQuery = { ...q };
  delete out.afFacets;
  for (const field of AF_PREDICATE_FIELDS) delete (out as Record<string, unknown>)[field];
  return out;
}

/** Drop one committed facet by index — the Filter screen's chip «×», same semantics as the agent's pills. */
export function withoutFacet(q: SearchQuery, index: number, questions: readonly Applier[]): SearchQuery {
  const facets = q.afFacets ?? [];
  return reconcileCommittedAf({ ...q, afFacets: facets.filter((_, i) => i !== index) }, questions);
}
