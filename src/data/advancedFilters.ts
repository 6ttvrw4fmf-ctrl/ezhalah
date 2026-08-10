import type { SearchQuery } from './search';
import { effectiveTypes, hasClientOnlyNarrowing } from './search';
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

// Amenities + bathrooms also apply to BUY apartments (owner follow-up 2026-07-27) — same single-Apartment
// Residential scope, on Annual Rent OR Buy (NOT monthly short-stay, which carries no structured attributes).
// RNPL stays Rent-only, and Furnished stays Rent-only (Buy furnished ≈2%; owner: no Furnished on Buy) —
// enforced in AMENITIES_QUESTION.resolveOptions, not here.
function isApartmentAttributeScope(q: SearchQuery): boolean {
  const types = effectiveTypes(q);
  if (!(types.length === 1 && types[0] === 'Apartment' && q.category === 'Residential')) return false;
  return q.deal === 'Buy' || (q.deal === 'Rent' && q.rentPeriod !== 'monthly');
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
// ranking/advice). Placed first. Carries the official EJARI×رايز partnership badge (owner 2026-07-21)
// via the brandImage TOKEN — the card owns the asset + slot; this config only names it.
const RNPL_QUESTION: AdvancedQuestion = {
  id: 'rnpl',
  titleKey: 'Do you prefer listings with installment options?',
  descriptionKey: 'Rent now and pay monthly instead of one annual payment',
  brandImage: 'ejari-rnpl',
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
  eligibility: isApartmentAttributeScope,
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
    ];
    // Furnished chip: Annual Rent only (Buy furnished ≈2%; owner: no Furnished filter on Buy).
    if (isAnnualRentApartment(q)) defs.push({ key: 'furnished', labelKey: 'Furnished', count: (c) => c.cnt_furnished });
    return guidedOptions(await fetchApartmentGuidedCounts(q), defs);
  },
  apply: addAmenities,
};

// Minimum bathrooms — single ladder; STRICT (>= N, unknown-bathroom listings excluded). Skip = "Any".
const BATHROOMS_QUESTION: AdvancedQuestion = {
  id: 'bathrooms',
  titleKey: 'How many bathrooms?',
  selection: 'single',
  eligibility: isApartmentAttributeScope,
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

// The queue — asked in this order; each self-gates via its own eligibility() + resolveOptions(). The
// card and orchestrator are driven entirely by the config (title/description/options/selection) and
// never branch on a question id.
export const ADVANCED_QUESTIONS: AdvancedQuestion[] = [
  RNPL_QUESTION, AGE_QUESTION, AMENITIES_QUESTION, BATHROOMS_QUESTION,
];

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
