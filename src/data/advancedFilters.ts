import type { SearchQuery } from './search';
import { effectiveTypes, hasClientOnlyNarrowing } from './search';
import { fetchPropertyAgeOptionCounts, fetchApartmentGuidedCounts, type AgeOptionCounts, type GuidedCounts } from './remote';
import { isAgeFilterScope as isAgeFilterScopeFor } from '@/lib/ageFilterTypes';
import { CLEAN_MACRO } from './propertyTypes';
import { t } from '@/i18n';
// Pure ranking/gating engine (2026-08-22 extraction — see src/lib/afRanking.ts header): re-exported
// verbatim so every existing importer of this file is unaffected; scoreQuestion's OWN mutation-proof
// barrier (scripts/verify-af-narrowing-gate.ts) imports afRanking.ts directly instead of this file,
// the same way scripts/verify-mixed-period-af-gating.ts imports afCohorts.ts directly.
import {
  type AdvancedOption, type AdvancedQuestionResult,
  MIN_OPTIONS_SINGLE, MIN_OPTIONS_MULTI, minOptionsFor,
  INTERVIEW_STOP_AT, MIN_TOTAL_TO_SHOW, MIN_REAL_OPTION_COUNT, meaningful,
  SALIENCE, ASK_FIRST_TIER, askTier, scoreQuestion as scoreQuestionPure,
} from '@/lib/afRanking';
export {
  type AdvancedOption, type AdvancedQuestionResult,
  MIN_OPTIONS_SINGLE, MIN_OPTIONS_MULTI, minOptionsFor,
  INTERVIEW_STOP_AT, MIN_TOTAL_TO_SHOW, MIN_REAL_OPTION_COUNT,
};

// ── Advanced Filter engine — governed by docs/ADVANCED_FILTER_DESIGN_CONTRACT.md ─────────────────
// A question is PURE DATA + RULES. It supplies ONLY the seven fields of AdvancedQuestion below; it
// never renders UI, sets a style, picks an interaction, or gates at a call site. One shared component
// (AdvancedQuestionCard) + one orchestrator (agent.tsx) own everything else — layout, progress,
// footer, spacing, typography, motion, skip, count presentation, and interaction. Adding a filter
// (Floor Number, Street Width, …) = adding ONE AdvancedQuestion object here. If a change needs the
// card, it changes the contract for ALL questions, on purpose.

// AdvancedOption/AdvancedQuestionResult (one selectable option + a resolved question's live options,
// pre-filtered to the meaningful-option floor) now live in @/lib/afRanking — imported/re-exported above.

// THE CONTRACT BOUNDARY — a question supplies exactly these eight fields, nothing else.
export type AdvancedQuestion = {
  id: string;                                   // stable identity, e.g. 'property_age'
  titleKey: string;                             // i18n key — the headline
  descriptionKey?: string;                      // i18n key — optional one-line subtitle
  brandImage?: string;                          // optional asset TOKEN (e.g. 'ejari-rnpl') — the card's
                                                // own registry maps it to an image and owns the slot/style
  selection: 'single' | 'multi';                // arity — the ONLY behavioural switch
  eligibility: (q: SearchQuery) => boolean;      // the question's own scope gate (never at a call site)
  resolveOptions: (q: SearchQuery) => Promise<AdvancedQuestionResult>; // live options for the scope
  apply: (q: SearchQuery, keys: string[]) => SearchQuery;              // merge the answer into the query
};

// minOptionsFor / INTERVIEW_STOP_AT / MIN_TOTAL_TO_SHOW / MIN_REAL_OPTION_COUNT / meaningful() now
// live in @/lib/afRanking (imported/re-exported above) — unchanged in value or behavior, just pure.

// Minimum USEFUL questions to open the interview at all (owner 2026-08-22). "Useful" = passes
// scoreQuestion() above — real narrowing power over the CURRENT eligible set, not merely
// structurally eligible (cohortAllows/isAgeFilterScope). A cohort with only one useful question
// would open Advanced Filter, spend the user's attention on that single weak question, and still
// close on a set the >25 result-count gate alone left large — not a niche shortlist, just a tax on
// the user's time. This SECOND, independent condition composes with INTERVIEW_STOP_AT/
// MIN_TOTAL_TO_SHOW (the result-count gate) — both must hold before Advanced Filter may open; this
// constant governs the OPENING decision only, never the continuation loop (rankQuestions/
// presentGuided keep asking down to the last useful question, however many remain).
export const MIN_USEFUL_QUESTIONS_TO_SHOW = 2;

// Engine-level LIVE result count for a query — the footer «Show {N}» on every card. Generic: the count
// RPC applies whatever the query carries (types/scope/amenities/bath/age), so this works for every
// question and type. null on error → the card holds the last good number rather than flashing.
export async function liveResultCount(q: SearchQuery): Promise<number | null> {
  const c = await fetchApartmentGuidedCounts(q);
  return c ? c.cnt_selected : null;
}

// ── Questions ────────────────────────────────────────────────────────────────────────────────────

// Property age — eligible for the 7 age-supported types (its gate now lives HERE, per the contract,
// not at the agent.tsx call site). 5 strict buckets; each is exactly what Search returns if picked.
const AGE_BUCKETS: Array<{ key: string; labelKey: string; count: (c: AgeOptionCounts) => number }> = [
  { key: 'new', labelKey: 'New construction', count: (c) => c.cnt_new },
  { key: '1_2', labelKey: '1–2 years', count: (c) => c.cnt_1_2 },
  { key: '3_5', labelKey: '3–5 years', count: (c) => c.cnt_3_5 },
  { key: '6_9', labelKey: '6–9 years', count: (c) => c.cnt_6_9 },
  { key: '10p', labelKey: '10+ years', count: (c) => c.cnt_10p },
];

const AGE_QUESTION: AdvancedQuestion = {
  id: 'property_age',
  titleKey: 'How old is the property?',
  selection: 'single',
  eligibility: (q) => isAgeFilterScopeFor(q, effectiveTypes(q)),
  async resolveOptions(q) {
    const counts = await fetchPropertyAgeOptionCounts(q);
    if (!counts || counts.cnt_total < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0, total: counts?.cnt_total ?? 0 };
    const options = meaningful(AGE_BUCKETS.map((b) => ({ key: b.key, label: t(b.labelKey), count: b.count(counts) })));
    return { options, unknownCount: counts.cnt_unknown, total: counts.cnt_total };
  },
  apply(q, keys) {
    switch (keys[0]) {
      case 'new': return { ...q, isNewConstruction: true, ageMin: null, ageMax: null };
      case '1_2': return { ...q, isNewConstruction: null, ageMin: 1, ageMax: 2 };
      case '3_5': return { ...q, isNewConstruction: null, ageMin: 3, ageMax: 5 };
      case '6_9': return { ...q, isNewConstruction: null, ageMin: 6, ageMax: 9 };
      case '10p': return { ...q, isNewConstruction: null, ageMin: 10, ageMax: null };
      default: return q;
    }
  },
};

// Cohort gating lives in @/lib/afCohorts (moved 2026-08-20): that module is PURE, so barriers can
// EXECUTE cohortAllows() against real queries instead of regexing this file, which is what makes the
// multi-type intersection mutation-provable. The cohort DATA moved with it, unchanged. Buy+Rent
// combined gating (q.dealCombined — owner feature 2026-08-20) lives there too, intersecting with
// the multi-type/multi-period dimensions rather than being bolted on separately — see afCohorts.ts.
import { COHORT_QUESTIONS, COHORT_CHIPS, cohortAllows, scopeCleanTypes, intersectChips } from '@/lib/afCohorts';
// Merge picked strict amenity tokens (kitchen/parking/elevator/furnished/rnpl) into q.amenities.
function addAmenities(q: SearchQuery, keys: string[]): SearchQuery {
  return keys.length ? { ...q, amenities: [...new Set([...(q.amenities ?? []), ...keys])] } : q;
}

// Build a chip/tier question's options from the guided counts, applying the scope-size + per-option floors.
function guidedOptions(
  counts: GuidedCounts | null,
  defs: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }>,
): AdvancedQuestionResult {
  if (!counts || counts.cnt_total_base < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0, total: counts?.cnt_total_base ?? 0 };
  return { options: meaningful(defs.map((d) => ({ key: d.key, label: t(d.labelKey), count: d.count(counts) }))), unknownCount: 0, total: counts.cnt_total_base };
}

// Installments (RNPL) — one strict chip. NEUTRAL metadata filter only (no payment calc/estimate/
// ranking/advice). Placed first. Carries the official EJARI×رايز partnership badge (owner 2026-07-21)
// via the brandImage TOKEN — the card owns the asset + slot; this config only names it.
const RNPL_QUESTION: AdvancedQuestion = {
  id: 'rnpl',
  titleKey: 'Would you rather pay the rent in instalments?',
  descriptionKey: 'Rent now and pay monthly instead of one annual payment',
  brandImage: 'ejari-rnpl',
  selection: 'multi',
  eligibility: (q) => cohortAllows(q, 'rnpl'),
  async resolveOptions(q) {
    return guidedOptions(await fetchApartmentGuidedCounts(q),
      [{ key: 'rnpl', labelKey: 'Offers installments', count: (c) => c.cnt_rnpl }]);
  },
  apply: addAmenities,
};

// Amenities — Kitchen · Parking · Elevator · Furnished (strict tokens; Furnished = confirmed furnished).
const AMENITIES_QUESTION: AdvancedQuestion = {
  id: 'amenities',
  titleKey: 'What amenities matter to you?',
  descriptionKey: 'Results update as you choose',
  selection: 'multi',
  eligibility: (q) => cohortAllows(q, 'amenities'),
  async resolveOptions(q) {
    const defs: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }> = [
      { key: 'kitchen',  labelKey: 'Kitchen',  count: (c) => c.cnt_kitchen },
      { key: 'parking',  labelKey: 'Parking',  count: (c) => c.cnt_parking },
      { key: 'elevator', labelKey: 'Elevator', count: (c) => c.cnt_elevator },
      // Air conditioning + private entrance (added 2026-08-10). Both were fully built and
      // completely unreachable: the columns were populated, the `ac` / `private_entrance` slugs
      // already worked in location_search_candidates_ar's p_amenities block, and only the COUNT
      // path was missing — so no chip could satisfy the "count == what Search returns" contract.
      // cnt_ac / cnt_private_entrance were added to apartment_guided_counts_ar the same day and
      // verified equal to the results RPC (6,208 and 2,575 on Annual Rent → Apartment).
      { key: 'ac',               labelKey: 'Air conditioning', count: (c) => c.cnt_ac },
      { key: 'private_entrance', labelKey: 'Private entrance', count: (c) => c.cnt_private_entrance },
      // Maid + driver room (2026-08-11): the p_amenities slugs always worked; only the COUNT path
      // was missing until cnt_maid_room/cnt_driver_room were added to apartment_guided_counts_ar.
      { key: 'maid_room',   labelKey: 'Maid room',   count: (c) => c.cnt_maid_room },
      { key: 'driver_room', labelKey: 'Driver room', count: (c) => c.cnt_driver_room },
    ];
    // Villa-form chips (2026-08-16): aqar villa ads carry مدخل سيارة and صرف صحي checkboxes the
    // apartment forms don't — both near-perfect two-sided splits (buy car entrance 5,594/5,943,
    // sanitation 7,377/2,829; both ≥52% known on FRESH rows). Villa-scoped so the certified
    // cohorts' cards are unchanged.
    // Multi-type safe: only when EVERY selected type is Villa — a Villa+Apartment scope must not be
    // offered a chip that only villa ads carry. (owner 2026-08-20 intersection rule.)
    const scope = scopeCleanTypes(q);
    if (scope.length > 0 && scope.every((ty) => ty === 'Villa')) {
      defs.push({ key: 'car_entrance', labelKey: 'Car entrance', count: (c) => c.cnt_car_entrance });
      defs.push({ key: 'sanitation',   labelKey: 'Sewage connection', count: (c) => c.cnt_sanitation });
    }
    // Commercial/rural chip scoping (2026-08-16): mapped clean types render EXACTLY their
    // COHORT_CHIPS list — the utility trio (+kitchen for Rest House) — and none of the
    // residential chips. Unmapped types keep the behavior above, byte-for-byte.
    // INTERSECTION across the selected types (owner 2026-08-20). Previously keyed on the single type,
    // so ANY multi-type scope fell through to the residential base chips — an Office+Shop scope
    // rendered kitchen/elevator/AC. null = no selected type constrains chips (base set, unchanged);
    // [] = the types disagree, so offer none rather than one side's chip.
    const chipAllow = intersectChips(scope);
    if (chipAllow) {
      defs.push({ key: 'sanitation',   labelKey: 'Sewage connection', count: (c) => c.cnt_sanitation });
      defs.push({ key: 'electricity',  labelKey: 'Electricity',       count: (c) => c.cnt_electricity });
      defs.push({ key: 'water_supply', labelKey: 'Water supply',      count: (c) => c.cnt_water_supply });
      const chosen = defs.filter((d) => chipAllow.includes(d.key));
      return guidedOptions(await fetchApartmentGuidedCounts(q), chosen);
    }
    // Furnished chip: Annual Rent only (Buy furnished ≈2%; owner: no Furnished filter on Buy).
    if (cohortAllows(q, 'furnished')) defs.push({ key: 'furnished', labelKey: 'Furnished', count: (c) => c.cnt_furnished });
    return guidedOptions(await fetchApartmentGuidedCounts(q), defs);
  },
  apply: addAmenities,
};

// Minimum bathrooms — single ladder; STRICT (>= N, unknown-bathroom listings excluded). Skip = "Any".
const BATHROOMS_QUESTION: AdvancedQuestion = {
  id: 'bathrooms',
  titleKey: 'How many bathrooms?',
  selection: 'single',
  eligibility: (q) => cohortAllows(q, 'bathrooms'),
  async resolveOptions(q) {
    // Only rungs ABOVE the current answer can narrow. apartment_guided_counts_ar computes cnt_bath1..4
    // over the `scoped` CTE, which ALREADY has the user's previous p_bath_min applied — so with
    // bathMin=3 live, cnt_bath1 == cnt_bath2 == cnt_bath3 == 1,117 (probed 2026-08-04), i.e. the lower
    // rungs are duplicates of the current state, not offers. Offering them made the card promise 1,117
    // and (pre-fix) deliver 2,984 — see the apply() note below. Dropping them leaves only the rungs
    // that mean something; when none do, `minOptionsFor('single')` retires the question entirely.
    const floor = q.bathMin ?? 0;
    const rungs: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }> = [
      { key: '1', labelKey: '1+', count: (c) => c.cnt_bath1 },
      { key: '2', labelKey: '2+', count: (c) => c.cnt_bath2 },
      { key: '3', labelKey: '3+', count: (c) => c.cnt_bath3 },
      { key: '4', labelKey: '4+', count: (c) => c.cnt_bath4 },
    ];
    return guidedOptions(await fetchApartmentGuidedCounts(q), rungs.filter((d) => parseInt(d.key, 10) > floor));
  },
  // INTERSECT, never replace (bug fix 2026-08-04). Every option's `count` is defined by the contract as
  // "exactly what Search returns if picked", and it is computed WITH the previous answer applied — so an
  // answer that relaxes the previous one would deliver a set larger than the number the user tapped.
  // Live pre-fix repro: narrow to «٣+» (1,117 results) → re-open «خلّنا نحدد الطلب أكثر» → the «١+» pill
  // reads 1,117 → tapping it installed bathMin=1 and returned 2,984, of which 1,867 had FEWER bathrooms
  // than the user had asked for (breaking strict-options too, not just count honesty). Math.max keeps
  // the card monotone: the answer can only ever narrow, so the pill's number always holds.
  apply: (q, keys) => {
    const n = parseInt(keys[0] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? { ...q, bathMin: Math.max(n, q.bathMin ?? 0) } : q;
  },
};

// Furnished preference — single-select (تفضلها مفروشة؟), Rent-only like the furnished chip. TRUE
// tri-state: «مفروشة» = confirmed furnished, «غير مفروشة» = confirmed unfurnished (explicit source
// no — cnt_unfurnished counts furnished IS FALSE), Skip = no preference (unknowns stay eligible).
const FURNISHED_QUESTION: AdvancedQuestion = {
  id: 'furnished',
  titleKey: 'Do you prefer it furnished?',
  selection: 'single',
  eligibility: (q) => cohortAllows(q, 'furnished'),
  async resolveOptions(q) {
    return guidedOptions(await fetchApartmentGuidedCounts(q), [
      { key: 'yes', labelKey: 'Furnished',   count: (c) => c.cnt_furnished },
      { key: 'no',  labelKey: 'Unfurnished', count: (c) => c.cnt_unfurnished },
    ]);
  },
  apply: (q, keys) =>
    keys[0] === 'yes' ? { ...q, furnishedPref: true }
    : keys[0] === 'no' ? { ...q, furnishedPref: false }
    : q,
};

// The question POOL — each self-gates via its own eligibility() + resolveOptions(). The ASK ORDER is
// NOT this array: rankQuestions() below re-ranks the pool against the user's CURRENT candidate set
// after every answer (owner 2026-08-11 — a Jeddah search may open with furnished where a Riyadh
// search opens with bathrooms). The card and orchestrator are driven entirely by the config
// (title/description/options/selection) and never branch on a question id.
// Street width (عرض الشارع) — the Residential-Building buyer's signature attribute (96-97% known).
// Cumulative single-select ladder like bathrooms; STRICT >= N, unknown excluded; monotone via
// Math.max so a later answer can only narrow (same count-honesty argument as the bathroom rungs).
const STREET_WIDTH_QUESTION: AdvancedQuestion = {
  id: 'street_width',
  titleKey: 'How wide should the street be?',
  selection: 'single',
  eligibility: (q) => cohortAllows(q, 'street_width'),
  async resolveOptions(q) {
    const floor = q.streetWidthMin ?? 0;
    const rungs: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }> = [
      { key: '15', labelKey: '15 m or wider', count: (c) => c.cnt_stw15 },
      { key: '20', labelKey: '20 m or wider', count: (c) => c.cnt_stw20 },
      { key: '25', labelKey: '25 m or wider', count: (c) => c.cnt_stw25 },
      { key: '30', labelKey: '30 m or wider', count: (c) => c.cnt_stw30 },
    ];
    return guidedOptions(await fetchApartmentGuidedCounts(q), rungs.filter((r) => parseInt(r.key, 10) > floor));
  },
  apply: (q, keys) => {
    const n = parseInt(keys[0] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? { ...q, streetWidthMin: Math.max(n, q.streetWidthMin ?? 0) } : q;
  },
};

// Preferred direction (اتجاه العقار) — ResBldg 83-84% known, Apartment/Buy 50%. Multi-select over
// the 8 normalized source values; picking several = OR (p_directions is a membership filter).
const DIRECTION_DEFS: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }> = [
  { key: 'شمال', labelKey: 'North', count: (c) => c.cnt_dir_n },
  { key: 'جنوب', labelKey: 'South', count: (c) => c.cnt_dir_s },
  { key: 'شرق', labelKey: 'East', count: (c) => c.cnt_dir_e },
  { key: 'غرب', labelKey: 'West', count: (c) => c.cnt_dir_w },
  { key: 'شمال شرق', labelKey: 'North-east', count: (c) => c.cnt_dir_ne },
  { key: 'شمال غرب', labelKey: 'North-west', count: (c) => c.cnt_dir_nw },
  { key: 'جنوب شرق', labelKey: 'South-east', count: (c) => c.cnt_dir_se },
  { key: 'جنوب غرب', labelKey: 'South-west', count: (c) => c.cnt_dir_sw },
];
const DIRECTION_QUESTION: AdvancedQuestion = {
  id: 'direction',
  titleKey: 'Which direction do you prefer?',
  descriptionKey: 'Results update as you choose',
  selection: 'multi',
  eligibility: (q) => cohortAllows(q, 'direction'),
  async resolveOptions(q) {
    return guidedOptions(await fetchApartmentGuidedCounts(q), DIRECTION_DEFS);
  },
  apply: (q, keys) => (keys.length ? { ...q, directions: [...new Set([...(q.directions ?? []), ...keys])] } : q),
};

// ── Monthly-only questions (owner order 2026-08-18) ─────────────────────────────────────────────
// Gathern property rating — the Monthly differentiator. SOURCE-DECLARED 1-10 scale (schema.org
// bestRating 10 / worstRating 1, verified against the live page); a PROPERTY/UNIT rating on
// @type: VacationRental, never a host rating. STRICT + UNKNOWN-safe: `s.rating >= p_rating_min`
// can never admit a NULL-rated listing, so unrated inventory (all non-Gathern + 444 «لا يوجد
// تقييم» rows) is excluded by construction, never counted as low-rated. The third option answers
// the owner's confidence question ("10.0 with 1 review ≠ 9.7 with 100 reviews") with the simplest
// honest cut the data supports: the same 9.0 floor, but only listings with 10+ reviews.
const RATING_QUESTION: AdvancedQuestion = {
  id: 'rating',
  titleKey: 'What rating would you prefer?',
  selection: 'single',
  eligibility: (q) => cohortAllows(q, 'rating'),
  async resolveOptions(q) {
    const floor = q.ratingMin ?? 0;
    const rungs: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }> = [
      { key: '9.5',      labelKey: '9.5+',                        count: (c) => c.cnt_rating95 },
      { key: '9.0',      labelKey: '9.0+',                        count: (c) => c.cnt_rating90 },
      { key: '9.0_rc10', labelKey: '9.0+ with 10+ reviews',       count: (c) => c.cnt_rating90_rc10 },
    ];
    // Monotone like BATHROOMS: only rungs that can still NARROW the current answer are offered.
    return guidedOptions(await fetchApartmentGuidedCounts(q),
      rungs.filter((d) => parseFloat(d.key) > floor || (d.key === '9.0_rc10' && (q.reviewsMin ?? 0) < 10 && floor <= 9.0)));
  },
  apply: (q, keys) => {
    const k = keys[0];
    if (k === '9.5')      return { ...q, ratingMin: Math.max(9.5, q.ratingMin ?? 0) };
    if (k === '9.0')      return { ...q, ratingMin: Math.max(9.0, q.ratingMin ?? 0) };
    if (k === '9.0_rc10') return { ...q, ratingMin: Math.max(9.0, q.ratingMin ?? 0), reviewsMin: Math.max(10, q.reviewsMin ?? 0) };
    return q;
  },
};

// Gathern unit subtype — Monthly-only sub-classification (استديو / شقق مخدومة / شقة). The canonical
// taxonomy is untouched: type_ar stays شقة for all three, so no cohort, count or barrier moves.
// STRICT: a chip matches unit_subtype_ar exactly; non-Gathern rows (NULL subtype) stay UNKNOWN and
// are excluded from any subtype answer — never bucketed as «شقة عادية» by default.
const UNIT_SUBTYPE_QUESTION: AdvancedQuestion = {
  id: 'unit_subtype',
  titleKey: 'What kind of unit?',
  selection: 'single',
  eligibility: (q) => cohortAllows(q, 'unit_subtype') && !(q.unitSubtypes?.length),
  async resolveOptions(q) {
    return guidedOptions(await fetchApartmentGuidedCounts(q), [
      { key: 'استديو',      labelKey: 'Studio unit',        count: (c) => c.cnt_sub_studio },
      { key: 'شقق مخدومة',  labelKey: 'Serviced apartment', count: (c) => c.cnt_sub_serviced },
      { key: 'شقة',         labelKey: 'Regular apartment',  count: (c) => c.cnt_sub_regular },
    ]);
  },
  apply: (q, keys) => (keys[0] ? { ...q, unitSubtypes: [keys[0]] } : q),
};

export const ADVANCED_QUESTIONS: AdvancedQuestion[] = [
  RNPL_QUESTION, AGE_QUESTION, AMENITIES_QUESTION, BATHROOMS_QUESTION, FURNISHED_QUESTION,
  STREET_WIDTH_QUESTION, DIRECTION_QUESTION, RATING_QUESTION, UNIT_SUBTYPE_QUESTION,
];

// Contextual ranking + the narrowing gate (owner 2026-08-11; narrowing-gate rework 2026-08-22) now
// live in @/lib/afRanking (SALIENCE, ASK_FIRST_TIER, askTier, scoreQuestion — imported above as
// scoreQuestionPure). This thin wrapper is the only thing that still needs the full AdvancedQuestion
// object (for its id/selection) so rankQuestions() below is unchanged; the pure gate itself takes
// just the id/selection/result, which is what makes it directly testable.
export function scoreQuestion(
  question: AdvancedQuestion, result: AdvancedQuestionResult,
): { score: number; options: AdvancedOption[] } | null {
  return scoreQuestionPure(question.id, question.selection, result);
}

export type RankedQuestion = {
  question: AdvancedQuestion; options: AdvancedOption[]; unknownCount: number; total: number; score: number;
};

// Probe every still-unasked eligible question against the CURRENT query, score, and rank. The
// orchestrator calls this at entry AND after every answer — that re-anchoring on the shrinking set
// is the whole architecture (350 → answer → analyze 140 → answer → analyze 48 → …).
export async function rankQuestions(q: SearchQuery, askedIds: ReadonlySet<string>): Promise<RankedQuestion[]> {
  const pool = eligibleQuestions(q).filter((question) => !askedIds.has(question.id));
  const probes = await Promise.all(pool.map((question) => question.resolveOptions(q)));
  const ranked: RankedQuestion[] = [];
  pool.forEach((question, i) => {
    const scored = scoreQuestion(question, probes[i]);
    if (scored) ranked.push({ question, options: scored.options, unknownCount: probes[i].unknownCount, total: probes[i].total, score: scored.score });
  });
  // Ask-first tier wins ONLY among questions that already cleared the usefulness gates above
  // (scoreQuestion returned non-null); within a tier, the contextual score decides. So installments
  // opens the interview whenever it is genuinely useful, and silently steps aside when it is not.
  return ranked.sort((a, b) =>
    askTier(b.question.id) - askTier(a.question.id) || b.score - a.score);
}

// THE engine gate — every caller asks HERE which questions may run, so no call site re-derives it.
//
// Beyond each question's own eligibility(), there is one ENGINE-WIDE precondition: every option this
// engine renders carries a live `count` that the contract defines as "exactly what Search returns if
// picked", and every one of those counts comes from a count RPC. When the query carries a narrower
// that only the CLIENT applies — an agent keyword, a legacy size band, a per-m² Buy budget — the RPC
// never sees it, so every count (and the «اعرض N نتيجة» footer, which is the same RPC) is computed
// over a strictly larger set than the user will actually receive. Measured live 2026-08-04: 475
// promised vs ~28 delivered on an age bucket; 9,314 vs 324 in the worst probe.
//
// This is the same lie the exact «لقينا N إعلان» headline used to tell (9,647 vs 134, bug-hunt
// 2026-07-30) and it is suppressed there by this exact predicate (agent.tsx). The narrowers cannot be
// pushed to the RPC — per-m² budgets and substring keyword matching are not RPC features — so an
// honest count is unavailable, and a question whose counts cannot be honest must not be asked. The
// callers' existing "nothing qualifies" path already handles it: a manual tap falls through to the
// plain refine chips (which promise no numbers), and the auto path closes silently.
export function eligibleQuestions(q: SearchQuery): AdvancedQuestion[] {
  if (hasClientOnlyNarrowing(q)) return [];
  return ADVANCED_QUESTIONS.filter((question) => question.eligibility(q));
}
