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
import { cohortAllows, certifiedAmenityKeys } from './afCohorts.ts';
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
 * SCOPE facets (group/type) are NOT carried at all — they are dropped here, and this is the one
 * place that decision lives. A facet is a RECEIPT: it exists to license a predicate the Filter UI
 * has no control for. A scope answer has the opposite property — applyScopeAnswer writes only
 * typeGroups/types/type, all three are Normal-tier fields the sanitizer's allowlist already carries,
 * and the group boxes and type boxes ARE their on-screen control. So a scope receipt licenses
 * nothing, and re-applying it is not merely redundant, it OVERWRITES the user:
 *   الرياض/إيجار/سنوي/سكني/شقة with a committed property_type facet, measured 2026-09-01 —
 *   deselect «شقة» → raw store types=null → re-render put ["Apartment"] straight back (a NO-OP tap);
 *   pick «فيلا»    → raw store ["Villa"] → re-render ["Apartment"] (the user's own pick discarded);
 *   a property_GROUP facet + a type picked outside it → the SPECIFIC type deleted and the search
 *   widened to the whole group; a type facet + a category switch → Residential types rendered and
 *   searched under تجاري, with no group box selected that could explain them.
 * The type/group rows write the RAW store while they render from the reconciled query, so every
 * scope edit was overwritten on the very next render: dead controls, and the widening direction the
 * carry exists to forbid. Dropping the facet keeps the user's own scope edit — and the interview's
 * own scope answer still rides, as the types/typeGroups it wrote.
 *
 * Note this is a READ-TIME derivation, not a write: changing the type away and back re-admits the
 * user's own still-visible answer rather than destroying it. Deliberate — what is searched, what is
 * counted and what is on screen are all derived from this one call, so they cannot disagree.
 */
export function certifiedFacets(q: SearchQuery, facets: readonly CommittedFacet[]): CommittedFacet[] {
  return facets
    .filter((f) => !isScopeQuestionId(f.id) && cohortAllows(q, f.id))
    .map((f) => (f.id === AMENITY_TOKEN_QUESTION_ID ? certifiedAmenityFacet(q, f) : f))
    .filter((f): f is CommittedFacet => f !== null);
}

/**
 * The «amenities» question is the ONE question whose certification is per-ANSWER, not per-question.
 *
 * cohortAllows(q,'amenities') answers "may this cohort be asked about amenities at all"; it does not
 * answer "is THIS token certified here". Production already draws that finer line — afCertify.ts
 * step 4 runs partitionRequestedAmenities() over chat-requested tokens for exactly this reason: a
 * `car_entrance` committed on فيلا must go when the scope stops being pure-Villa, even though the
 * amenities question itself is still certified for شقة. Without this the carry replayed it, and the
 * shared predicate is strict-NULL-excluding, so every Apartment row that never stated car_entrance
 * was deleted — UNKNOWN turned into No, which is the failure this whole module refuses.
 *
 * Only this question: certifiedAmenityKeys() is the token authority for the amenities question's own
 * option list, and «rnpl» is deliberately NOT in it. rnpl writes an amenity token too, but it has a
 * 1:1 question-level gate (cohortAllows(q,'rnpl')) which IS its per-token gate — it has exactly one
 * token — so running it through this list would drop a certified answer and WIDEN the search. The
 * pair is pinned by verify-af-survives-filter-reentry.ts, which executes every question's apply()
 * and fails if a third one learns to write `amenities`.
 *
 * A chip and its predicate always die together: if no token survives the facet goes, and if the
 * labels are not index-parallel to the keys (so the chip cannot be split honestly) the whole facet
 * goes rather than leave a control that overstates what is actually being filtered.
 */
const AMENITY_TOKEN_QUESTION_ID = 'amenities';
function certifiedAmenityFacet(q: SearchQuery, f: CommittedFacet): CommittedFacet | null {
  const allowed = new Set(certifiedAmenityKeys(q));
  const keep = f.keys.map((_, i) => i).filter((i) => allowed.has(String(f.keys[i] ?? '').trim().toLowerCase()));
  if (keep.length === f.keys.length) return f;
  if (!keep.length || f.keys.length !== f.labels.length) return null;
  return { ...f, keys: keep.map((i) => f.keys[i]), labels: keep.map((i) => f.labels[i]) };
}

/**
 * The query that must actually be searched, counted and displayed on the Filter screen.
 *
 * Clears every AF predicate, then re-applies only the still-certified facets through each
 * question's OWN apply() — never a hand-written inverse. That is byte-for-byte the rebuild
 * removeGuidedFacet already performs in agent.tsx, so removing a chip on either screen means the
 * same thing. Scope facets never reach this reduce (certifiedFacets drops them, see above), so the
 * scope half of the question pool is inert here — the scope answer rides as the types/typeGroups it
 * wrote, under the Filter screen's own group and type boxes.
 *
 * A query that NEVER HAD an Advanced Filter round is returned UNTOUCHED (identity), so a plain
 * Normal-Filter search is never forced through a strip that could disturb it.
 *
 * "Never had one" is `q.afFacets` being ABSENT — not being empty. The distinction is the whole
 * defect: clearing the LAST chip leaves `afFacets: []`, and an `if (!facets.length) return q` shortcut
 * skipped the branch where stripCommittedAf() runs, so the cleared predicate stayed live with no
 * control left on screen to see or remove it (measured: `{ afFacets: [], isNewConstruction: true }`
 * still sending p_is_new_construction, and surviving a Trending tap). That is verbatim the
 * invisible-filter P1 sanitizeForFilterRestore exists to prevent, reached through the very chip row
 * this module added. Removing an INTERMEDIATE chip always worked; only the transition to zero failed,
 * which is exactly why every barrier stayed green. An empty array now means "had answers, has none
 * now" and takes the strip — one predicate-clearing path for the first chip and the last.
 */
export function reconcileCommittedAf(q: SearchQuery, questions: readonly Applier[]): SearchQuery {
  if (!q.afFacets) return q;
  const kept = certifiedFacets(q, q.afFacets);
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

/**
 * Drop one committed facet by index — the Filter screen's chip «×», same semantics as the agent's pills.
 *
 * Always hands reconcileCommittedAf an ARRAY, empty included: an empty one is what tells it "this
 * query had answers and has none now", so removing the last chip strips its predicate exactly the
 * way removing an intermediate one does.
 */
export function withoutFacet(q: SearchQuery, index: number, questions: readonly Applier[]): SearchQuery {
  const facets = q.afFacets ?? [];
  return reconcileCommittedAf({ ...q, afFacets: facets.filter((_, i) => i !== index) }, questions);
}
