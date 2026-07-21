import type { SearchQuery } from './search';
import { effectiveTypes } from './search';
import { fetchPropertyAgeOptionCounts, fetchApartmentGuidedCounts, type AgeOptionCounts, type GuidedCounts } from './remote';
import { isAgeFilterScope as isAgeFilterScopeFor } from '@/lib/ageFilterTypes';
import { t } from '@/i18n';

// ── Advanced Filter engine — governed by docs/ADVANCED_FILTER_DESIGN_CONTRACT.md ─────────────────
// A question is PURE DATA + RULES. It supplies ONLY the seven fields of AdvancedQuestion below; it
// never renders UI, sets a style, picks an interaction, or gates at a call site. One shared component
// (AdvancedQuestionCard) + one orchestrator (agent.tsx) own everything else — layout, progress,
// footer, spacing, typography, motion, skip, count presentation, and interaction. Adding a filter
// (Floor Number, Street Width, …) = adding ONE AdvancedQuestion object here. If a change needs the
// card, it changes the contract for ALL questions, on purpose.

// One selectable option in a question, with its LIVE count for the user's full current scope
// (deal/category/type/region/city/district/price/area/bedrooms + any earlier-answered question).
export type AdvancedOption = {
  key: string;
  label: string;   // already i18n-resolved
  count: number;   // combined cross-platform total — exactly what Search returns if picked
};

export type AdvancedQuestionResult = {
  options: AdvancedOption[]; // pre-filtered to the meaningful-option floor; callers render exactly this
  unknownCount: number;      // disclosed as a caption when > 0; never a selectable option
};

// THE CONTRACT BOUNDARY — a question supplies exactly these seven fields, nothing else.
export type AdvancedQuestion = {
  id: string;                                   // stable identity, e.g. 'property_age'
  titleKey: string;                             // i18n key — the headline
  descriptionKey?: string;                      // i18n key — optional one-line subtitle
  selection: 'single' | 'multi';                // arity — the ONLY behavioural switch
  eligibility: (q: SearchQuery) => boolean;      // the question's own scope gate (never at a call site)
  resolveOptions: (q: SearchQuery) => Promise<AdvancedQuestionResult>; // live options for the scope
  apply: (q: SearchQuery, keys: string[]) => SearchQuery;              // merge the answer into the query
};

// A question shows only when it clears the scope-size floor AND has at least this many options for its
// arity (single needs a real choice of ≥2; a single meaningful multi chip is a valid yes/no). This is
// the ONLY single-vs-multi threshold difference; the per-OPTION floor below is shared by both.
export const MIN_OPTIONS_SINGLE = 2;
export const MIN_OPTIONS_MULTI = 1;
export function minOptionsFor(selection: 'single' | 'multi'): number {
  return selection === 'multi' ? MIN_OPTIONS_MULTI : MIN_OPTIONS_SINGLE;
}

// Scope-size floor: don't ask a question unless the current scope has enough matching listings to be
// worth narrowing (owner 2026-07-16, grounded in real Buy/Rent × city distributions).
export const MIN_TOTAL_TO_SHOW = 150;

// Per-OPTION floor — one value for EVERY question (contract §9; the old >0-chips vs >=5-buckets split
// is banned). An option backed by fewer than this many listings is not a meaningful choice and is hidden.
export const MIN_REAL_OPTION_COUNT = 5;

// Filter a resolved option list to the shared per-option floor.
function meaningful(options: AdvancedOption[]): AdvancedOption[] {
  return options.filter((o) => o.count >= MIN_REAL_OPTION_COUNT);
}

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
    if (!counts || counts.cnt_total < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0 };
    const options = meaningful(AGE_BUCKETS.map((b) => ({ key: b.key, label: t(b.labelKey), count: b.count(counts) })));
    return { options, unknownCount: counts.cnt_unknown };
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

// The RNPL / amenities / bathrooms questions apply ONLY to a single-Apartment / Residential / Rent /
// ANNUAL scope (owner 2026-07-20). This is each question's own eligibility() gate.
function isAnnualRentApartment(q: SearchQuery): boolean {
  const types = effectiveTypes(q);
  return types.length === 1 && types[0] === 'Apartment'
    && q.category === 'Residential' && q.deal === 'Rent' && q.rentPeriod !== 'monthly';
}

// Merge picked strict amenity tokens (kitchen/parking/elevator/furnished/rnpl) into q.amenities.
function addAmenities(q: SearchQuery, keys: string[]): SearchQuery {
  return keys.length ? { ...q, amenities: [...new Set([...(q.amenities ?? []), ...keys])] } : q;
}

// Build a chip/tier question's options from the guided counts, applying the scope-size + per-option floors.
function guidedOptions(
  counts: GuidedCounts | null,
  defs: Array<{ key: string; labelKey: string; count: (c: GuidedCounts) => number }>,
): AdvancedQuestionResult {
  if (!counts || counts.cnt_total_base < MIN_TOTAL_TO_SHOW) return { options: [], unknownCount: 0 };
  return { options: meaningful(defs.map((d) => ({ key: d.key, label: t(d.labelKey), count: d.count(counts) }))), unknownCount: 0 };
}

// Installments (RNPL) — one strict chip. NEUTRAL metadata filter only (no payment calc/estimate/
// ranking/advice). Placed first.
const RNPL_QUESTION: AdvancedQuestion = {
  id: 'rnpl',
  titleKey: 'Do you prefer listings with installment options?',
  descriptionKey: 'Results update as you choose',
  selection: 'multi',
  eligibility: isAnnualRentApartment,
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
  eligibility: isAnnualRentApartment,
  async resolveOptions(q) {
    return guidedOptions(await fetchApartmentGuidedCounts(q), [
      { key: 'kitchen',   labelKey: 'Kitchen',   count: (c) => c.cnt_kitchen },
      { key: 'parking',   labelKey: 'Parking',   count: (c) => c.cnt_parking },
      { key: 'elevator',  labelKey: 'Elevator',  count: (c) => c.cnt_elevator },
      { key: 'furnished', labelKey: 'Furnished', count: (c) => c.cnt_furnished },
    ]);
  },
  apply: addAmenities,
};

// Minimum bathrooms — single ladder; STRICT (>= N, unknown-bathroom listings excluded). Skip = "Any".
const BATHROOMS_QUESTION: AdvancedQuestion = {
  id: 'bathrooms',
  titleKey: 'How many bathrooms?',
  selection: 'single',
  eligibility: isAnnualRentApartment,
  async resolveOptions(q) {
    return guidedOptions(await fetchApartmentGuidedCounts(q), [
      { key: '1', labelKey: '1+', count: (c) => c.cnt_bath1 },
      { key: '2', labelKey: '2+', count: (c) => c.cnt_bath2 },
      { key: '3', labelKey: '3+', count: (c) => c.cnt_bath3 },
      { key: '4', labelKey: '4+', count: (c) => c.cnt_bath4 },
    ]);
  },
  apply: (q, keys) => (keys[0] ? { ...q, bathMin: parseInt(keys[0], 10) || null } : q),
};

// The queue — asked in this order; each self-gates via its own eligibility() + resolveOptions(). The
// card and orchestrator are driven entirely by the config (title/description/options/selection) and
// never branch on a question id.
export const ADVANCED_QUESTIONS: AdvancedQuestion[] = [
  RNPL_QUESTION, AGE_QUESTION, AMENITIES_QUESTION, BATHROOMS_QUESTION,
];
