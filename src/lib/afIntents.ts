// ─────────────────────────────────────────────────────────────────────────────
// afIntents — the ONE registry that lets AI Chat reach the Advanced Filter.
//
// PRODUCT PURPOSE (owner 2026-08-29): AI Chat is a natural-language doorway over BOTH the Normal
// Filter and the Advanced Filter. The manual UI is sequential — Normal Filter → results → AF — but a
// user talking to the agent may state normal-filter and AF fields together in their FIRST message,
// and every supported intent must land in the same canonical search state the manual flow produces.
//
// THE PERMANENT INVARIANT THIS FILE EXISTS TO ENFORCE:
//   DeepSeek may UNDERSTAND and PROPOSE an intent.
//   The existing AF certification decides whether Ezhalah is allowed to APPLY it.
// Every entry below is gated by cohortAllows(q, id) — the SAME predicate the AF question uses. There
// is no AI-only filter system and no AI-only vocabulary.
//
// WHY A REGISTRY AND NOT SEVEN HAND-WIRED FIELDS. Seven bespoke branches drift: someone certifies a
// new AF question, nobody teaches the agent, and the two surfaces silently diverge. Here the keys ARE
// the canonical AF question ids, and verify-agent-af-intent-coverage.ts fails the build if any id in
// COHORT_QUESTIONS has no entry here. Drift becomes a red test instead of a silent gap.
//
// NORMALIZATION IS DETERMINISTIC. The model proposes a value from a CLOSED vocabulary; `canonicalize`
// maps it to the exact key the AF `apply` uses, or returns null. A value that cannot be canonicalized
// is NEVER guessed — it is rejected and the caller asks. UNKNOWN stays UNKNOWN; missing data never
// becomes No/false/0.
import type { SearchQuery } from '@/data/search';
import { cohortAllows } from './afCohorts.ts';

export type AfIntentId =
  | 'property_age' | 'street_width' | 'direction' | 'bathrooms'
  | 'rating' | 'rnpl' | 'unit_subtype' | 'furnished' | 'amenities';

export type AfIntent = {
  /** The canonical AF question id. cohortAllows(q, id) is the certification gate — always. */
  id: AfIntentId;
  /** Closed vocabulary the model may emit. Documented to the model; enforced here. */
  vocabulary: readonly string[];
  /** Model value → the exact key AF's own apply() consumes, or null when it cannot be trusted. */
  canonicalize: (raw: string) => string | null;
  /** Writes the canonical backend field. Mirrors the AF question's apply() exactly. */
  apply: (q: SearchQuery, key: string) => SearchQuery;
  /**
   * Removes whatever `apply` wrote — the inverse, living beside it so the two cannot drift.
   *
   * Needed because certification is not only about the value the user states THIS turn. An AF answer
   * is sticky: it survives into later turns by design (mergeConversationState must never erase what
   * the user said). But the COHORT can change under it — «خليها شقة» after a street-width answer —
   * and a carried value whose new cohort does not certify it is exactly the uncertified predicate the
   * AF source-truth rule forbids. Measured live: Apartment/Buy carrying streetWidthMin 20 cuts
   * 38,540 → 585; Apartment/RentAnnual carrying ratingMin 9.5 cuts 23,953 → 0.
   *
   * MUST return `q` UNCHANGED (same reference) when there is nothing set, so the caller can tell
   * "cleared something" from "nothing to clear" without a deep compare — that distinction is what
   * stops a rejection being announced for a filter the user never had.
   */
  clear: (q: SearchQuery) => SearchQuery;
};

const num = (raw: string): number | null => {
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
};
/** Pick the highest rung <= the requested value. "5 bathrooms" → the 4+ rung; "0" → null. */
const rung = (raw: string, rungs: number[]): string | null => {
  const n = num(raw);
  if (n === null || n <= 0) return null;
  const hit = [...rungs].sort((a, b) => b - a).find((r) => n >= r);
  return hit === undefined ? null : String(hit);
};
const oneOf = (vocab: readonly string[]) => (raw: string): string | null => {
  const v = String(raw ?? '').trim();
  return vocab.includes(v) ? v : null;   // EXACT match only — never fuzzy
};

// Age buckets, byte-identical to the AF question's own cases.
const AGE_APPLY: Record<string, Partial<SearchQuery>> = {
  new:  { isNewConstruction: true,  ageMin: null, ageMax: null },
  '1_2': { isNewConstruction: null, ageMin: 1,  ageMax: 2 },
  '3_5': { isNewConstruction: null, ageMin: 3,  ageMax: 5 },
  '6_9': { isNewConstruction: null, ageMin: 6,  ageMax: 9 },
  '10p': { isNewConstruction: null, ageMin: 10, ageMax: null },
};
const AGE_KEYS = Object.keys(AGE_APPLY);

// "Less than/under/up to N years" (live bug, 2026-08-30): NONE of the 5 named buckets alone
// truthfully means "under 5" — "1_2" excludes 3-5, "3_5" excludes new+1_2 — so the model must never
// guess the closest-sounding bucket for a threshold that doesn't match one exactly. Confirmed against
// the live RPC (location_search_candidates_ar): p_age_min/p_age_max are independent numeric bounds
// applied as `property_age between coalesce(p_age_min,0) and coalesce(p_age_max,32767)`, and "new" IS
// `property_age = 0` server-side — so an ageMax-only range with no ageMin ALREADY includes "new" for
// free. property_age is therefore a genuine integer field, not a fixed 5-way tag, and a plain number
// of years is just as certified a use of it as any named bucket (same source field, different
// threshold). MAX_AGE_YEARS is a sanity bound on the input, not a business rule.
const MAX_AGE_YEARS = 60;
const canonicalizeAge = (raw: string): string | null => {
  const exact = oneOf(AGE_KEYS)(raw);
  if (exact !== null) return exact;
  const n = num(raw);
  return n !== null && n >= 1 && n <= MAX_AGE_YEARS ? `max:${Math.floor(n)}` : null;
};
const applyAge = (q: SearchQuery, key: string): SearchQuery => {
  const m = /^max:(\d+)$/.exec(key);
  return m ? { ...q, isNewConstruction: null, ageMin: null, ageMax: Number(m[1]) } : { ...q, ...AGE_APPLY[key] };
};
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب', 'شمال شرق', 'شمال غرب', 'جنوب شرق', 'جنوب غرب'] as const;
const UNIT_SUBTYPES = ['استديو', 'شقق مخدومة', 'شقة'] as const;
// RATING IS A 0–10 SCALE, NOT 0–5. «تقييم عالي» must never silently become 4.0/4.5 — that is not
// merely a guess, it is a guess on the wrong scale, and it would match almost everything.
const RATING_KEYS = ['9.5', '9.0', '9.0_rc10'] as const;

export const AF_INTENTS: Record<AfIntentId, AfIntent> = {
  property_age: {
    id: 'property_age',
    vocabulary: AGE_KEYS, // canonicalizeAge ALSO accepts a plain integer "N" ("less than N years")
    canonicalize: canonicalizeAge,
    apply: applyAge,
    clear: (q) => (q.ageMin == null && q.ageMax == null && q.isNewConstruction == null
      ? q : { ...q, ageMin: null, ageMax: null, isNewConstruction: null }),
  },
  street_width: {
    id: 'street_width',
    vocabulary: ['15', '20', '25', '30'],
    canonicalize: (raw) => rung(raw, [15, 20, 25, 30]),
    apply: (q, key) => {
      const n = parseInt(key, 10);
      return Number.isFinite(n) && n > 0 ? { ...q, streetWidthMin: Math.max(n, q.streetWidthMin ?? 0) } : q;
    },
    clear: (q) => (q.streetWidthMin == null ? q : { ...q, streetWidthMin: null }),
  },
  direction: {
    id: 'direction',
    vocabulary: DIRECTIONS,
    canonicalize: oneOf(DIRECTIONS),
    apply: (q, key) => ({ ...q, directions: [...new Set([...(q.directions ?? []), key])] }),
    clear: (q) => (q.directions?.length ? { ...q, directions: null } : q),
  },
  bathrooms: {
    id: 'bathrooms',
    vocabulary: ['1', '2', '3', '4'],
    canonicalize: (raw) => rung(raw, [1, 2, 3, 4]),
    apply: (q, key) => {
      const n = parseInt(key, 10);
      return Number.isFinite(n) && n > 0 ? { ...q, bathMin: Math.max(n, q.bathMin ?? 0) } : q;
    },
    clear: (q) => (q.bathMin == null ? q : { ...q, bathMin: null }),
  },
  rating: {
    id: 'rating',
    vocabulary: RATING_KEYS,
    canonicalize: oneOf(RATING_KEYS),
    apply: (q, key) =>
      key === '9.0_rc10'
        ? { ...q, ratingMin: Math.max(9.0, q.ratingMin ?? 0), reviewsMin: Math.max(10, q.reviewsMin ?? 0) }
        : { ...q, ratingMin: Math.max(Number(key), q.ratingMin ?? 0) },
    // reviewsMin only ever arrives WITH a rating (the 9.0_rc10 rung), so it clears with it.
    clear: (q) => (q.ratingMin == null && q.reviewsMin == null ? q : { ...q, ratingMin: null, reviewsMin: null }),
  },
  rnpl: {
    // RNPL writes into q.amenities like an amenity token, but it is its OWN AF question with its OWN
    // certification (3 cohorts vs amenities' 24). Gating it on 'amenities' would let RNPL through
    // wherever generic amenities happen to be certified — a real trap found while mapping this out.
    id: 'rnpl',
    vocabulary: ['rnpl'],
    canonicalize: oneOf(['rnpl']),
    apply: (q, key) => ({ ...q, amenities: [...new Set([...(q.amenities ?? []), key])] }),
    // RNPL lives in q.amenities but owns its own gate, so it clears ONLY its own token — the generic
    // amenity sweep must not take it, and it must not take theirs.
    clear: (q) => (q.amenities?.some((t) => t === 'rnpl' || t === 'rent_now_pay_later')
      ? { ...q, amenities: q.amenities.filter((t) => t !== 'rnpl' && t !== 'rent_now_pay_later') } : q),
  },
  unit_subtype: {
    id: 'unit_subtype',
    vocabulary: UNIT_SUBTYPES,
    canonicalize: oneOf(UNIT_SUBTYPES),
    apply: (q, key) => ({ ...q, unitSubtypes: [key] }),
    clear: (q) => (q.unitSubtypes?.length ? { ...q, unitSubtypes: null } : q),
  },
  furnished: {
    id: 'furnished',
    vocabulary: ['yes', 'no'],
    canonicalize: oneOf(['yes', 'no']),
    apply: (q, key) => ({ ...q, furnishedPref: key === 'yes' }),
    clear: (q) => (q.furnishedPref == null ? q : { ...q, furnishedPref: null }),
  },
  amenities: {
    // Per-token certification is finer than the question gate (villa-only tokens, commercial trios),
    // so the amenity path keeps using partitionRequestedAmenities(). This entry exists so the
    // registry is COMPLETE — the coverage barrier requires every AF question id to be present.
    id: 'amenities',
    vocabulary: [],
    canonicalize: () => null,
    apply: (q) => q,
    // Per-token, and deliberately NOT "drop every token": rnpl carries its own certification, so the
    // generic sweep hands it to the rnpl entry above rather than deciding for it.
    clear: (q) => {
      const keep = (q.amenities ?? []).filter((t) => t === 'rnpl' || t === 'rent_now_pay_later');
      return keep.length === (q.amenities?.length ?? 0) ? q : { ...q, amenities: keep.length ? keep : null };
    },
  },
};

/** Ids the generic apply loop owns. amenities is handled by its own per-token gate. */
export const GENERIC_INTENT_IDS: AfIntentId[] =
  (Object.keys(AF_INTENTS) as AfIntentId[]).filter((id) => id !== 'amenities');

/**
 * Apply the model's proposed AF intents through the REAL certification gate.
 *
 * Returns the new query plus the intents that could NOT be applied, so the caller can ask instead of
 * pretending. Three distinct refusals, none of them silent:
 *   - the cohort does not certify the question  → 'id'            (ask, or explain)
 *   - the value is outside the closed vocabulary → 'id:value'     (never fuzzy-matched)
 *   - the value is a vague word with no truthful threshold → the model should not have sent it
 */
export function applyAfIntents(
  q: SearchQuery, proposed: Record<string, unknown>,
): { q: SearchQuery; rejected: string[] } {
  let out = q;
  const rejected: string[] = [];
  for (const id of GENERIC_INTENT_IDS) {
    const raw = proposed?.[id];
    if (raw === undefined || raw === null || raw === '' || raw === 'none') continue;
    // AN EMPTY ARRAY IS NOT A STATED INTENT. The model's contract says to omit a key the user did
    // not mention, but it does not always: a live production turn for «فيها مصعد وموقف» came back
    // carrying every unstated AF key as "" or [] (direction: []). The empty STRING was already
    // skipped above; an empty ARRAY fell through to the certification check and was pushed onto
    // `rejected`, which is surfaced to the user — so the reply could apologise for failing to apply
    // a direction the user never asked for. Nothing was ever wrongly FILTERED (no value survives
    // canonicalize), but a false "couldn't apply that" is still a lie about what we did.
    if (Array.isArray(raw) && raw.length === 0) continue;
    const intent = AF_INTENTS[id];
    const values = Array.isArray(raw) ? raw : [raw];
    // Certification FIRST: an uncertified cohort must not even canonicalize, so a rejection can never
    // be mistaken for "applied".
    if (!cohortAllows(out, id)) { rejected.push(id); continue; }
    for (const v of values) {
      const key = intent.canonicalize(String(v));
      if (key === null) { rejected.push(`${id}:${String(v)}`); continue; }
      out = intent.apply(out, key);
    }
  }
  return { q: out, rejected };
}
