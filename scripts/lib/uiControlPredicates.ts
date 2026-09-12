// THE ONE DECISION BEHIND «EVERY VISIBLE FILTER CONTROL MUST ACTUALLY FILTER» — SHARED BY BOTH HALVES.
//
// WHY THIS FILE EXISTS (routine #10, ops_incident #126, 2026-09-12).
// -------------------------------------------------------------------
// `scripts/verify-ui-controls-have-predicates.ts` was ONE file doing two incompatible jobs, and it
// was measured (2026-09-06) as one of five checks in the REQUIRED `npm test` whose verdict is decided
// by production's state rather than by the diff. But the split was not merely a placement problem:
//
//   Measured 2026-09-12 by execution, with the endpoint blackholed:
//     EZHALAH_SUPABASE_URL="https://127.0.0.1:9" node --experimental-strip-types \
//       scripts/verify-ui-controls-have-predicates.ts
//   → 20 assertions that read ONLY committed source never executed at all (10 of them the
//     boundary-rule teeth below, plus 4 more afPlan/scope assertions, deed_location_text, and the
//     5 "interview question exists in the pool" checks).
//
// Those 20 included the owner's 2026-08-11 BOUNDARY RULE teeth — "the scope prefix never writes
// Normal-Filter 'bedrooms' / 'priceMin' / 'location' / …", which read `src/lib/afPlan.ts` and nothing
// else. They sat inside `if (Array.isArray(registry) && registry.length) { … }`, so a momentary
// production blip took the owner-boundary guard dark while the run still looked like it had simply
// failed to reach the network. A PR that violated the boundary rule in afPlan.ts would have been
// reported as `TypeError: fetch failed`.
//
// That is this routine's own defect class, stated in docs/ops/BARRIER_ENGINEER.md PART 1: coverage
// that reads as protection while protecting nothing. The repair is AGENTS.md's SPLIT recipe — the
// hermetic predicate and its mutation proofs stay in `npm test`; the live read moves to a declared
// workflow home; and **both halves import the SAME predicate from here**, so the offline mutation
// proof is a statement about the code that actually decides production's verdict, not about a copy
// of it. A barrier holding its own COPY of the logic it guards is the `extractPrice` defect of
// 2026-08-29 (docs/ops/BARRIER_ENGINEER.md PART 1.6).

/** One row of `af_field_registry`, as PostgREST returns it. */
export type RegistryRow = {
  canonical_key: string;
  ui_exposed: boolean;
  not_exposed_reason: string | null;
  filter_tier?: string;
};

/**
 * Chip keys that predate the registry and are stored there under a different canonical spelling.
 * Not an exemption list: both keys DO have rows, under these names.
 */
export const REGISTRY_KEY: Record<string, string> = {
  ac: 'air_conditioner',
  rnpl: 'installment_available',
};

/**
 * Which registry fields each interview question is allowed to ask about.
 *
 * The owner's boundary rule (2026-08-11): the interview must NEVER auto-ask Normal-Filter territory.
 * `filter_tier` is that boundary expressed as DATA, so every field here must be 'advanced' tier.
 */
export const INTERVIEW_FIELDS: Record<string, string[]> = {
  property_age: ['property_age'],
  rnpl: ['installment_available'],
  bathrooms: ['bathrooms'],
  furnished: ['furnished'],
  amenities: ['kitchen', 'parking', 'elevator', 'air_conditioner', 'private_entrance', 'maid_room', 'driver_room', 'furnished'],
};

/**
 * EVERY Advanced Filter question the app can put in front of a user, and the registry field(s) each
 * one narrows on. This is the EXPOSURE surface — strictly wider than INTERVIEW_FIELDS above, which
 * is only the subset the owner's `filter_tier` boundary rule speaks about.
 *
 * WHY IT EXISTS (routine #9, 2026-09-12). registryProblems()'s exposure rules — «a field the
 * registry marks backend-only must never acquire a chip» and «a chip the registry cannot DESCRIBE is
 * refused» — were applied to `chipKeys` alone, and chipKeys is amenityChipKeys(): the 22 AMENITY
 * tokens, by construction. Four of the nine live questions narrow on something that is not an
 * amenity, so the rules could not see them. MEASURED against the live registry that same day, with
 * the check GREEN:
 *
 *   direction        → direction_ar     registry says ui_exposed=false, «9% coverage — too thin to
 *                                       be useful yet». Actual coverage 98,431/213,219 = 46.2%, and
 *                                       the question is in COHORT_QUESTIONS for Apartment/Buy,
 *                                       ResBldg, Villa and more. The app sends p_directions
 *                                       (src/data/remote.ts) and renders a chip (src/lib/afEvidence.ts).
 *   street_width     → street_width_m   registry says ui_exposed=false, «12.5% coverage today».
 *                                       Actual 89,075/213,219 = 41.8%; same story.
 *   rating           → rating, reviews_count   NO REGISTRY ROW AT ALL.
 *   unit_subtype     → unit_subtype_ar         NO REGISTRY ROW AT ALL.
 *
 * That is the precise failure this file's live half names in its own header — «a source check alone
 * would stay green if a field were flipped to ui_exposed=false in production while its chip kept
 * rendering» — and it was green over two of them for as long as they have existed.
 *
 * A question id absent from this map is a FAILURE, not a skip: the discovery below reads the ids out
 * of the real src/data/advancedFilters.ts, so a question added tomorrow goes red here until someone
 * says which registry field it narrows on. That is the property the hand-written list above lost —
 * it silently fell four questions behind and nothing noticed.
 */
export const AF_QUESTION_FIELDS: Record<string, string[]> = {
  property_age: ['property_age'],
  rnpl: ['installment_available'],
  bathrooms: ['bathrooms'],
  furnished: ['furnished'],
  // The amenity question's own fields are the chip keys, judged separately and by name.
  amenities: [],
  street_width: ['street_width_m'],
  direction: ['direction_ar'],
  // The 9.0+rc10 rung sets BOTH ratingMin and reviewsMin (advancedFilters.ts RATING_QUESTION.apply),
  // so one question narrows on two registry fields. Listing only `rating` would leave reviews_count
  // undeclared while a user can already filter on it.
  rating: ['rating', 'reviews_count'],
  unit_subtype: ['unit_subtype_ar'],
};

/**
 * The Advanced Filter question ids, DERIVED from the real src/data/advancedFilters.ts.
 *
 * Discovery, not a list: every `id: '...'` that belongs to an `AdvancedQuestion` declaration. A new
 * question is picked up automatically and then fails AF_QUESTION_FIELDS' completeness rule until it
 * is mapped — the fail-closed direction. Parsed rather than imported because that module pulls in
 * i18n and the remote layer, neither of which a hermetic check may load.
 */
export function afQuestionIds(advancedSrc: string): string[] {
  return [...advancedSrc.matchAll(/:\s*AdvancedQuestion\s*=\s*\{\s*\n\s*id:\s*'([a-z_]+)'/g)]
    .map((m) => m[1]);
}

/**
 * The amenity chip keys, DERIVED from `src/data/advancedFilters.ts`.
 *
 * Shared rather than duplicated: the live half judges these exact keys against the registry, so a
 * second derivation would let the two halves disagree about which chips even exist — the two-copy
 * defect this file was created to remove.
 *
 * Only the AMENITY-bearing questions carry `p_amenities` slugs. The age question's keys ('new',
 * '1_2', …) are age buckets applied via p_age_min/p_age_max and the bathroom rungs are numeric and
 * applied via p_bath_min — neither is an amenity, so the scan is scoped to the questions that
 * actually call addAmenities().
 */
export function amenityChipKeys(advancedSrc: string): string[] {
  const blocks = [...advancedSrc.matchAll(/const (RNPL_QUESTION|AMENITIES_QUESTION)[\s\S]*?apply: addAmenities/g)]
    .map((m) => m[0]).join('\n');
  return [...blocks.matchAll(/\{\s*key:\s*'([a-z_]+)'\s*,\s*labelKey:/g)].map((m) => m[1]);
}

/**
 * Turn an HTTP status + parsed body into the value registryProblems() is allowed to judge.
 *
 * A NON-200 IS NEVER DATA, even when its body happens to parse as a plausible array. That is not a
 * hypothetical: the sibling split checks were created because a statement-timeout 500 and a rotated
 * anon key's 401 were both being read as answers, and PostgREST returns a JSON body on every one of
 * them. So the status decides, and the body is preserved only as diagnostic detail.
 *
 * Kept here rather than inline in the live half so it is the SAME decision the offline half proves
 * on every PR — the live half re-proves it too, as its siblings do.
 */
export function registryPayload(status: number, body: unknown): unknown {
  if (status === 200) return body;
  return { httpStatus: status, body };
}

/**
 * Every way the LIVE field registry can disagree with the shipped UI. Empty means the contract holds.
 *
 * FAILS CLOSED ON AN UNUSABLE READ, and that is the first rule here rather than an afterthought.
 * AGENTS.md's owner-locked rule — **A FAILED FETCH IS NOT AN EMPTY ANSWER** — binds a barrier's own
 * reads exactly as it binds the product's (docs/ops/BARRIER_ENGINEER.md PART 1.5). PostgREST answers
 * an error with a JSON OBJECT (`{"message": …}`), not a throw, and `supabase-js NEVER THROWS` either:
 * so a failed registry read arrives here as a perfectly well-formed value. If this function treated
 * a non-array, or an empty array, as "nothing to report", the whole live half would report a clean
 * bill of health at exactly the moment it learned nothing — the manufactured negative this routine
 * exists to prevent.
 *
 * `chipKeys` must come from amenityChipKeys() so both halves judge the same chips.
 */
export function registryProblems(
  registry: unknown, chipKeys: string[], controlFields: string[] = [],
): string[] {
  const problems: string[] = [];

  if (!Array.isArray(registry)) {
    problems.push('af_field_registry did not read back as an array — a failed PostgREST read arrives '
      + `as a JSON object, never as a throw, so this is an UNANSWERED question, not a clean registry: `
      + `${JSON.stringify(registry).slice(0, 200)}`);
    return problems;
  }
  if (registry.length === 0) {
    problems.push('af_field_registry read back EMPTY — an empty result and an unauthorised/filtered '
      + 'read are indistinguishable here, so this cannot be interpreted as "no hidden fields exist"');
    return problems;
  }

  const rows = registry as RegistryRow[];

  // ── a field the registry marks backend-only must never acquire a chip ──────────────────────────
  // Those flags are not stylistic: they record that a field is free prose (deed_location_text), has
  // zero positive inventory fleet-wide (pool/gym/garden), or is too thin to help (floor at 17%).
  // Exposing one anyway puts a question in front of users that cannot answer them.
  // THE EXPOSED SURFACE IS EVERY CONTROL, NOT EVERY AMENITY CHIP (widened 2026-09-12, routine #9).
  // `chipKeys` is amenityChipKeys() — the 22 amenity tokens, by construction — so these two rules
  // could not see the four live questions that narrow on something else (direction, street width,
  // rating/reviews, unit subtype). Two of those four are ui_exposed=false in the live registry with
  // stale coverage reasons while the app asks them of real users, which is the exact leak this rule
  // exists to catch, and it was green. `controlFields` carries the rest of the surface, derived from
  // the real question pool (AF_QUESTION_FIELDS + afQuestionIds), never a second hand-written list.
  const exposed = new Set([...chipKeys, ...controlFields]);
  const backendOnly = rows.filter((f) => !f.ui_exposed).map((f) => f.canonical_key);
  const leaked = backendOnly.filter((k) => exposed.has(k) || exposed.has(REGISTRY_KEY[k] ?? ' '));
  if (leaked.length) {
    problems.push(`ui_exposed=false in the registry but exposed to users as a filter control: ${leaked.join(', ')}`);
  }

  // ── a chip the registry cannot DESCRIBE is refused ──────────────────────────────────────────────
  // The leak check above only sees rows that exist, so a chip whose key has NO row at all
  // (optical_fibers, before 20260902220000 registered it) slipped past it silently.
  const registered = new Set(rows.map((f) => f.canonical_key));
  const undescribed = [...chipKeys, ...controlFields].filter((k) => !registered.has(REGISTRY_KEY[k] ?? k));
  if (undescribed.length) {
    problems.push('no af_field_registry row describes these user-facing filter controls: '
      + `${[...new Set(undescribed)].join(', ')}`);
  }

  const noReason = rows.filter((f) => !f.ui_exposed && !f.not_exposed_reason).map((f) => f.canonical_key);
  if (noReason.length) {
    problems.push(`backend-only fields that do not record WHY they are hidden: ${noReason.join(', ')}`);
  }

  // ── the owner boundary rule as DATA: every interview field is 'advanced' tier ───────────────────
  const tier = new Map(rows.map((f) => [f.canonical_key, f.filter_tier ?? 'backend']));
  for (const [qid, fields] of Object.entries(INTERVIEW_FIELDS)) {
    for (const fkey of fields) {
      const t = tier.get(fkey);
      if (t !== 'advanced') {
        problems.push(`interview field '${fkey}' (question '${qid}') is filter_tier='${t}', not `
          + "'advanced' — Normal-Filter territory must never be auto-asked (owner rule 2026-08-11)");
      }
    }
  }
  // Bedrooms is the named case: 'normal' tier, and even when unset the interview may not ask it.
  if (tier.get('bedrooms') !== 'normal') {
    problems.push(`'bedrooms' is filter_tier='${tier.get('bedrooms')}', expected 'normal' — if it `
      + 'genuinely moved tier that is an owner product decision, not a registry edit');
  }

  return problems;
}
