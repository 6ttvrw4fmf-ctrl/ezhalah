// ─────────────────────────────────────────────────────────────────────────────
// afCertify — THE Advanced-Filter certification pass, and the only one.
//
// PURE ON PURPOSE. This logic used to live inside src/data/agent.ts, which imports react-native,
// @/i18n and the Supabase client — so no barrier could execute it, and every check guarding it was a
// regex over the source. Two of the defects fixed here (2026-09-01) had passing text barriers sitting
// on top of them the whole time. Here it is a leaf module a test can simply import, which is the
// repo's own "never test a copy of production code" rule made structural rather than aspirational.
//
// WHY IT RUNS ON THE MERGED STATE. cohortAllows() reads type, category, deal and rentPeriod. A
// follow-up turn carries only what the model chose to restate, and the model is explicitly told not
// to restate what is established — so «وتكون فيها مصعد» arrives with no type, scopeCleanTypes() is []
// and the gate refuses a filter the conversation plainly certifies. The cohort is only real after
// mergeConversationState.
//
// WHAT IT OWNS: this turn's af / amenities / furnished intents, the CARRIED state whose cohort may
// have changed under it, and the rejection list the reply reads from. All four in one place, because
// two writers is precisely how a verdict reached against an empty cohort rode out to the user as
// «that option is not available in this search» for a filter the other pass had just applied.
import type { SearchQuery } from '@/data/search';
import { cohortAllows, partitionRequestedAmenities } from './afCohorts.ts';
import { applyAfIntents, AF_INTENTS, GENERIC_INTENT_IDS } from './afIntents.ts';

/** Only the fields certification reads. Structural, so this module never imports the agent. */
export type CertifiableBackendQuery = {
  af?: unknown;
  amenities?: string[];
  furnished?: string;
};

/** RNPL writes into q.amenities but owns its own cohort gate, so the generic sweep must skip it. */
const isRnpl = (t: string) => t === 'rnpl' || t === 'rent_now_pay_later';

export function certifyAfOnMergedState(
  merged: SearchQuery,
  b: CertifiableBackendQuery,
): { q: SearchQuery; rejected: string[] } {
  let q = merged;
  const rejected: string[] = [];

  // ── 1. af intents ────────────────────────────────────────────────────────────────────────────
  const af = (b as { af?: unknown }).af;
  if (af && typeof af === 'object') {
    const res = applyAfIntents(q, af as Record<string, unknown>);
    q = res.q;
    rejected.push(...res.rejected);
  }

  // ── 2. amenities, on the merged cohort ───────────────────────────────────────────────────────
  // Only the ADDITION happens here; removing what the cohort refuses is left to the sweep in step 4,
  // which has to handle carried tokens anyway. Filtering the stated tokens out again here was tried
  // and proved EQUIVALENT under mutation — two ways to remove the same token, one of them untestable.
  if (Array.isArray(b.amenities) && b.amenities.length) {
    const { certified, rejected: rej } = partitionRequestedAmenities(q, b.amenities);
    if (certified.length) q = { ...q, amenities: [...new Set([...(q.amenities ?? []), ...certified])] };
    rejected.push(...rej);   // must still be ANNOUNCED even when the token never reached the query
  }

  // ── 3. furnished, on the merged cohort ───────────────────────────────────────────────────────
  // Certification is coverage-driven, not a formality: annual-rent apartments are 46.4% known for
  // furnished, MONTHLY apartments 0.0% (5 rows of 30,544). Applying it there turns UNKNOWN into No
  // and collapses 30,544 listings to 4. Clearing a refused value is step 4's job, for the same
  // reason as above — an explicit clear() here was also provably equivalent.
  if (b.furnished === 'yes' || b.furnished === 'no') {
    if (cohortAllows(q, 'furnished')) q = { ...q, furnishedPref: b.furnished === 'yes' };
    else rejected.push('furnished');
  }

  // ── 4. THE CARRIED STATE ─────────────────────────────────────────────────────────────────────
  // An AF answer is sticky by design and mergeConversationState must never erase it — but the cohort
  // can change under it. «خليها شقة» after a street-width answer leaves streetWidthMin live in a
  // cohort that never certified street width: the uncertified predicate the AF source-truth rule
  // forbids. Measured live: Apartment/Buy + carried streetWidthMin 20 → 38,540 becomes 585;
  // Apartment/RentAnnual + carried ratingMin 9.5 → 23,953 becomes 0.
  //
  // This does not contradict «a clarification must never reset state». That rule governs the MERGE,
  // which still carries everything. This is the later, separate question of what may be APPLIED — and
  // a dropped filter is SPOKEN through the rejection list, never silently binned. Trading a silent
  // wrong filter for a silent missing one would be no better.
  //
  // Runs after 1-3 so a value restated this turn is judged once, against its final cohort.
  for (const id of GENERIC_INTENT_IDS) {
    if (cohortAllows(q, id)) continue;
    const cleared = AF_INTENTS[id].clear(q);
    if (cleared === q) continue;             // nothing was set — nothing to announce
    q = cleared;
    rejected.push(id);
  }

  // Per-token amenity sweep. Finer than the question gate: a carried `car_entrance` must go when the
  // scope stops being pure-Villa, even though 'amenities' itself is still certified.
  if (q.amenities?.length) {
    const generic = q.amenities.filter((t) => !isRnpl(t));
    if (generic.length) {
      const { certified, rejected: rej } = partitionRequestedAmenities(q, generic);
      if (rej.length) {
        const keep = q.amenities.filter((t) => isRnpl(t) || certified.includes(t));
        q = { ...q, amenities: keep.length ? keep : null };
        rejected.push(...rej);
      }
    }
  }

  return { q, rejected: [...new Set(rejected)] };
}
