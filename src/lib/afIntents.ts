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
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب', 'شمال شرق', 'شمال غرب', 'جنوب شرق', 'جنوب غرب'] as const;
const UNIT_SUBTYPES = ['استديو', 'شقق مخدومة', 'شقة'] as const;
// RATING IS A 0–10 SCALE, NOT 0–5. «تقييم عالي» must never silently become 4.0/4.5 — that is not
// merely a guess, it is a guess on the wrong scale, and it would match almost everything.
const RATING_KEYS = ['9.5', '9.0', '9.0_rc10'] as const;

export const AF_INTENTS: Record<AfIntentId, AfIntent> = {
  property_age: {
    id: 'property_age',
    vocabulary: AGE_KEYS,
    canonicalize: oneOf(AGE_KEYS),
    apply: (q, key) => ({ ...q, ...AGE_APPLY[key] }),
  },
  street_width: {
    id: 'street_width',
    vocabulary: ['15', '20', '25', '30'],
    canonicalize: (raw) => rung(raw, [15, 20, 25, 30]),
    apply: (q, key) => {
      const n = parseInt(key, 10);
      return Number.isFinite(n) && n > 0 ? { ...q, streetWidthMin: Math.max(n, q.streetWidthMin ?? 0) } : q;
    },
  },
  direction: {
    id: 'direction',
    vocabulary: DIRECTIONS,
    canonicalize: oneOf(DIRECTIONS),
    apply: (q, key) => ({ ...q, directions: [...new Set([...(q.directions ?? []), key])] }),
  },
  bathrooms: {
    id: 'bathrooms',
    vocabulary: ['1', '2', '3', '4'],
    canonicalize: (raw) => rung(raw, [1, 2, 3, 4]),
    apply: (q, key) => {
      const n = parseInt(key, 10);
      return Number.isFinite(n) && n > 0 ? { ...q, bathMin: Math.max(n, q.bathMin ?? 0) } : q;
    },
  },
  rating: {
    id: 'rating',
    vocabulary: RATING_KEYS,
    canonicalize: oneOf(RATING_KEYS),
    apply: (q, key) =>
      key === '9.0_rc10'
        ? { ...q, ratingMin: Math.max(9.0, q.ratingMin ?? 0), reviewsMin: Math.max(10, q.reviewsMin ?? 0) }
        : { ...q, ratingMin: Math.max(Number(key), q.ratingMin ?? 0) },
  },
  rnpl: {
    // RNPL writes into q.amenities like an amenity token, but it is its OWN AF question with its OWN
    // certification (3 cohorts vs amenities' 24). Gating it on 'amenities' would let RNPL through
    // wherever generic amenities happen to be certified — a real trap found while mapping this out.
    id: 'rnpl',
    vocabulary: ['rnpl'],
    canonicalize: oneOf(['rnpl']),
    apply: (q, key) => ({ ...q, amenities: [...new Set([...(q.amenities ?? []), key])] }),
  },
  unit_subtype: {
    id: 'unit_subtype',
    vocabulary: UNIT_SUBTYPES,
    canonicalize: oneOf(UNIT_SUBTYPES),
    apply: (q, key) => ({ ...q, unitSubtypes: [key] }),
  },
  furnished: {
    id: 'furnished',
    vocabulary: ['yes', 'no'],
    canonicalize: oneOf(['yes', 'no']),
    apply: (q, key) => ({ ...q, furnishedPref: key === 'yes' }),
  },
  amenities: {
    // Per-token certification is finer than the question gate (villa-only tokens, commercial trios),
    // so the amenity path keeps using partitionRequestedAmenities(). This entry exists so the
    // registry is COMPLETE — the coverage barrier requires every AF question id to be present.
    id: 'amenities',
    vocabulary: [],
    canonicalize: () => null,
    apply: (q) => q,
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
