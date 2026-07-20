import type { SearchQuery } from './search';
import { effectiveTypes } from './search';
import { fetchPropertyAgeOptionCounts, fetchApartmentGuidedCounts, fetchGuidedLiveCount, type AgeOptionCounts, type GuidedCounts } from './remote';
import { t } from '@/i18n';

// Reusable advanced-question engine («خلّنا نحدد الطلب أكثر»). عمر العقار (below) is the first and, for
// this build, ONLY entry — it exists to be the reference template. Adding الواجهة / الحمامات / الفرش /
// رقم الدور / عرض الشارع later means adding ONE more AdvancedQuestionConfig object to ADVANCED_QUESTIONS
// and nothing else: AdvancedQuestionCard.tsx and agent.tsx's age-flow orchestration are driven entirely
// by this config and must never gain a field-specific branch (owner instruction: do not hardcode the
// engine to age). Reached ONLY from the results screen's existing «خلّنا نحدد الطلب أكثر» button, in a
// strict Residential+Apartment scope — never before first results, never for other types (2026-07-13).

// One tappable choice inside a question card, with its LIVE count already resolved for the user's
// full current normal-filter scope (deal/category/group/type/region/city/district/price/area/bedrooms
// + any earlier-answered advanced question). `count` is always the combined cross-platform total —
// per-platform contribution is tracked separately and never rendered (rule: one combined count only).
export type AdvancedOption = {
  key: string;
  label: string;
  count: number;
};

export type AdvancedQuestionResult = {
  options: AdvancedOption[]; // pre-filtered to count > 0 — callers render exactly this list, no re-filtering
  unknownCount: number;      // disclosed as a caption, never a selectable bucket (unknown stays eligible, never "0")
};

export type AdvancedQuestionConfig = {
  key: string;
  titleKey: string; // i18n key for the card's question title
  // 'single' (default) = the age/bathrooms bucket card: tap one option → applyAnswer → advance.
  // 'multi' = the amenities/RNPL chip card: toggle any chips, live count on the continue button,
  // applyMulti(q, selectedKeys) merges them, and the second alternative is always "no preference".
  // A multi question is eligible with >= 1 option (single needs MIN_OPTIONS_TO_SHOW). (2026-07-20)
  mode?: 'single' | 'multi';
  fetchOptions: (q: SearchQuery) => Promise<AdvancedQuestionResult>;
  applyAnswer: (q: SearchQuery, optionKey: string) => SearchQuery;
  // multi only: merge a set of picked chip keys into the query in one step (unselected = no change).
  applyMulti?: (q: SearchQuery, keys: string[]) => SearchQuery;
  // multi only: live combined count for a tentative chip selection (drives the continue button). null
  // on error → the card holds the last good number rather than flashing a wrong one.
  liveCount?: (q: SearchQuery, keys: string[]) => Promise<number | null>;
};

// Fewer than this many real (count > 0) options → the caller falls back to whatever else it does for
// "narrow further" (agent.tsx falls back to the pre-existing refine chips). A "choice" between zero or
// one real answers isn't a meaningful question.
export const MIN_OPTIONS_TO_SHOW = 2;

// Owner 2026-07-16: don't even attempt the question unless the current scope has enough total
// matching listings to make it worth asking — grounded in real Buy/Rent × city distributions (see
// project memory): there's a natural gap in the live data between ~112 and ~192-653 total listings.
export const MIN_TOTAL_TO_SHOW = 150;

// Owner 2026-07-16 (finalized spec): a bucket only counts as a real, meaningful option once it has
// at least this many listings. property_age_option_counts_ar is STRICT for every bucket (unknown-age
// listings match none of them — see the migration), so cnt_X is already the true per-bucket signal;
// no separate "real vs raw" adjustment is needed here anymore.
export const MIN_REAL_BUCKET_COUNT = 5;

// Owner 2026-07-16 (finalized spec, LOCKED): exactly these 5 options, «أقل من سنة» retired as a
// separate bucket (its only real signal was property_age=0, identical to «جديد» — an indistinguishable
// duplicate). Every bucket is a STRICT filter — unknown-age listings never match ANY of them, at both
// count time (this RPC) and search time (location_search_candidates_ar's p_age_min/p_age_max clause).
const AGE_BUCKETS: Array<{
  key: string;
  labelKey: string;
  count: (c: AgeOptionCounts) => number;
}> = [
  { key: 'new', labelKey: 'New construction', count: (c) => c.cnt_new },
  { key: '1_2', labelKey: '1–2 years', count: (c) => c.cnt_1_2 },
  { key: '3_5', labelKey: '3–5 years', count: (c) => c.cnt_3_5 },
  { key: '6_9', labelKey: '6–9 years', count: (c) => c.cnt_6_9 },
  { key: '10p', labelKey: '10+ years', count: (c) => c.cnt_10p },
];

// Internal-only concentration visibility (rule 6): logs which platforms back a bucket so a
// near-single-platform field can be caught in monitoring, without ever surfacing a per-platform
// number in the UI. No ops-console ingestion is wired yet (see dashboard-first-monitoring-rule in
// memory) — a real sink is a deliberate follow-up, not something this PR should invent.
function logAgeConcentration(breakdown: AgeOptionCounts['platform_breakdown']): void {
  if (!breakdown) return;
  if (__DEV__) console.log('[advancedFilters] property_age platform breakdown', breakdown);
}

const AGE_QUESTION: AdvancedQuestionConfig = {
  key: 'property_age',
  titleKey: 'How old is the property?',
  async fetchOptions(q) {
    const counts = await fetchPropertyAgeOptionCounts(q);
    if (!counts) return { options: [], unknownCount: 0 };
    // Owner 2026-07-16: too few total matching listings → the question can't meaningfully narrow
    // anything down. Return empty rather than special-case this — the caller's existing
    // MIN_OPTIONS_TO_SHOW fallback (to the plain refine-chip flow) handles it identically to "no
    // real buckets", so this stays a single code path.
    if (counts.cnt_total < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0 };
    logAgeConcentration(counts.platform_breakdown);
    const options = AGE_BUCKETS
      // rule 4 (updated 2026-07-16): only options with a MEANINGFUL number of matching listings —
      // cnt_X is already strict (unknown-age excluded), so this is the true per-bucket signal. The
      // displayed `count` is exactly what Search returns if this option is picked — same strict
      // predicate at both count time and search time (see property_age_option_counts_ar /
      // location_search_candidates_ar's p_age_min/p_age_max clause).
      .filter((b) => b.count(counts) >= MIN_REAL_BUCKET_COUNT)
      .map((b) => ({ key: b.key, label: t(b.labelKey), count: b.count(counts) }));
    return { options, unknownCount: counts.cnt_unknown };
  },
  applyAnswer(q, key) {
    switch (key) {
      case 'new': return { ...q, isNewConstruction: true, ageMin: null, ageMax: null };
      case '1_2': return { ...q, isNewConstruction: null, ageMin: 1, ageMax: 2 };
      case '3_5': return { ...q, isNewConstruction: null, ageMin: 3, ageMax: 5 };
      case '6_9': return { ...q, isNewConstruction: null, ageMin: 6, ageMax: 9 };
      case '10p': return { ...q, isNewConstruction: null, ageMin: 10, ageMax: null };
      default: return q;
    }
  },
};

// ── Annual-Rent apartment guided flow (owner 2026-07-20) ─────────────────────────────────────────
// Three more questions join عمر العقار, gated to a single-Apartment / Residential / Rent / ANNUAL
// scope. Monthly rent shows NO guided questions; Buy uses its own flow and never includes Furnished
// (that scoping lives in each question's fetchOptions via isAnnualRentApartment). Age keeps its own
// broader 7-type eligibility (AGE_QUESTION above) — it is simply first-after-RNPL in the queue.
function isAnnualRentApartment(q: SearchQuery): boolean {
  const types = effectiveTypes(q);
  return types.length === 1 && types[0] === 'Apartment'
    && q.category === 'Residential' && q.deal === 'Rent' && q.rentPeriod !== 'monthly';
}

// Union the picked chip keys into q.amenities (strict RPC tokens: kitchen/parking/elevator/furnished/rnpl).
function mergeAmenities(q: SearchQuery, keys: string[]): string[] {
  return [...new Set([...(q.amenities ?? []), ...keys])];
}
function addAmenities(q: SearchQuery, keys: string[]): SearchQuery {
  return keys.length ? { ...q, amenities: mergeAmenities(q, keys) } : q;
}

// Build a chip (multi) question's options from the guided counts: only chips with real (> 0)
// availability appear; below the ≥150 scope gate, or on a failed count, no options → engine skips.
// unknownCount is 0 (chips are strict positive filters — no unknown bucket to disclose).
function chipOptions(
  counts: GuidedCounts | null,
  chips: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }>,
): AdvancedQuestionResult {
  if (!counts || counts.cnt_total_base < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0 };
  const options = chips
    .filter((ch) => ch.count(counts) > 0)
    .map((ch) => ({ key: ch.key, label: t(ch.labelKey), count: ch.count(counts) }));
  return { options, unknownCount: 0 };
}

// Step 1 — RNPL / installments («استأجر الآن وادفع لاحقًا»). ONE strict chip: tap = require a
// source-advertised installment option (rent_now_pay_later=true); untapped = no preference. NEUTRAL
// metadata filter only — no payment calc, estimate, ranking, or advice. Placed FIRST in the queue.
const RNPL_QUESTION: AdvancedQuestionConfig = {
  key: 'rnpl',
  titleKey: 'Do you prefer listings with installment options?',
  mode: 'multi',
  async fetchOptions(q) {
    if (!isAnnualRentApartment(q)) return { options: [], unknownCount: 0 };
    return chipOptions(await fetchApartmentGuidedCounts(q),
      [{ key: 'rnpl', labelKey: 'Offers installments', count: (c) => c.cnt_rnpl }]);
  },
  applyAnswer: (q, key) => addAmenities(q, [key]),
  applyMulti: (q, keys) => addAmenities(q, keys),
  liveCount: (q, keys) => fetchGuidedLiveCount(q, mergeAmenities(q, keys), q.bathMin ?? null),
};

// Step 3 — amenities (Kitchen · Parking · Elevator · Furnished). Multi strict chips; Furnished is a
// strict amenity token here (NOT the lenient p_furnished), so "Furnished" means confirmed furnished.
const AMENITIES_QUESTION: AdvancedQuestionConfig = {
  key: 'amenities',
  titleKey: 'What amenities matter to you?',
  mode: 'multi',
  async fetchOptions(q) {
    if (!isAnnualRentApartment(q)) return { options: [], unknownCount: 0 };
    return chipOptions(await fetchApartmentGuidedCounts(q), [
      { key: 'kitchen',   labelKey: 'Kitchen',   count: (c) => c.cnt_kitchen },
      { key: 'parking',   labelKey: 'Parking',   count: (c) => c.cnt_parking },
      { key: 'elevator',  labelKey: 'Elevator',  count: (c) => c.cnt_elevator },
      { key: 'furnished', labelKey: 'Furnished', count: (c) => c.cnt_furnished },
    ]);
  },
  applyAnswer: (q, key) => addAmenities(q, [key]),
  applyMulti: (q, keys) => addAmenities(q, keys),
  liveCount: (q, keys) => fetchGuidedLiveCount(q, mergeAmenities(q, keys), q.bathMin ?? null),
};

// Step 4 — minimum bathrooms. Single-select ladder (Skip = "Any"); STRICT (>= N, unknown-bathroom
// listings excluded — owner 2026-07-20). Tiers below MIN_REAL_BUCKET_COUNT are hidden by the scope.
const BATHROOMS_QUESTION: AdvancedQuestionConfig = {
  key: 'bathrooms',
  titleKey: 'How many bathrooms?',
  mode: 'single',
  async fetchOptions(q) {
    if (!isAnnualRentApartment(q)) return { options: [], unknownCount: 0 };
    const counts = await fetchApartmentGuidedCounts(q);
    if (!counts || counts.cnt_total_base < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0 };
    const options = ([
      { key: '1', labelKey: '1+', count: counts.cnt_bath1 },
      { key: '2', labelKey: '2+', count: counts.cnt_bath2 },
      { key: '3', labelKey: '3+', count: counts.cnt_bath3 },
      { key: '4', labelKey: '4+', count: counts.cnt_bath4 },
    ] as const)
      .filter((tier) => tier.count >= MIN_REAL_BUCKET_COUNT)
      .map((tier) => ({ key: tier.key, label: t(tier.labelKey), count: tier.count }));
    return { options, unknownCount: 0 };
  },
  applyAnswer: (q, key) => ({ ...q, bathMin: parseInt(key, 10) || null }),
};

// The engine's question queue — asked in this exact order for Apartment → Annual Rent (owner
// 2026-07-20): installments → property age → amenities → minimum bathrooms. Each self-gates in its
// fetchOptions (age is broader; the other three are annual-apartment only), so a scope that fails a
// step's gate simply skips it. AdvancedQuestionCard + the agent.tsx orchestration stay generic —
// driven entirely by `mode`, never by a question's identity.
export const ADVANCED_QUESTIONS: AdvancedQuestionConfig[] = [
  RNPL_QUESTION, AGE_QUESTION, AMENITIES_QUESTION, BATHROOMS_QUESTION,
];
