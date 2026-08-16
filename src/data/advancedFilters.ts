import type { SearchQuery } from './search';
import { effectiveTypes, hasClientOnlyNarrowing } from './search';
import { fetchPropertyAgeOptionCounts, fetchApartmentGuidedCounts, type AgeOptionCounts, type GuidedCounts } from './remote';
import { isAgeFilterScope as isAgeFilterScopeFor } from '@/lib/ageFilterTypes';
import { CLEAN_MACRO } from './propertyTypes';
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
  total: number;             // the scope total these options were computed over (0 when below floor)
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

// Scope-size floor: don't ask a question unless the current scope has MORE results than the
// interview's stop line. Owner 2026-08-11 (contextual-interview rework): the Advanced interview is
// available when the user's own search has > 25 results and stops asking the moment ≤ 25 remain —
// so 26 is the floor, and the ≤25 auto-stop falls out of the same constant everywhere.
export const INTERVIEW_STOP_AT = 25;
export const MIN_TOTAL_TO_SHOW = INTERVIEW_STOP_AT + 1;

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

// ── COHORT QUESTION CONFIG (owner 2026-08-15) ────────────────────────────────────────────────────
// «The architecture should be shared, but the questions should come from the actual property and
// deal context.» Each (single clean type × deal) cohort lists the questions its SOURCE DATA
// justifies — profiled live against production before every entry below (coverage %s in the
// migration/ledger docs). Monthly Rent is deliberately ABSENT everywhere: it is frozen until the
// owner personally authorizes it, so no cohort key exists for it and no question can fire there.
//
// This config is AVAILABILITY only. Whether a question is actually ASKED in a given scope is still
// decided live by scoreQuestion()'s usefulness gates against the user's current result set — the
// config says "this question can make sense for this cohort", the gates say "it is worth asking
// RIGHT NOW". Unknown stays unknown throughout; a cohort with thin coverage simply never fires.
//
// Data justification summary (nationwide known-rates, profiled 2026-08-15):
//   Apartment/RentAnnual — certified 2026-08-15 (the template cohort).
//   Apartment/Buy        — age 90%, direction 50%, kitchen 34%, elevator 29%, bath 26%.
//   Floor/RentAnnual     — age 93%, RNPL 83% known (64% yes!), AC 76%, private entrance 76%, bath 66%.
//   Floor/Buy            — age 85%, private entrance 39%, bath 30%.
//   ResBldg/(both deals) — street width 96-97%, direction 83-84%, age 89-91%; bathrooms 1% (a whole
//                          building has no meaningful bathroom count — deliberately NOT offered).
//   Room/RentAnnual      — kitchen 85% (its signature), age 94%, furnished 49%; bathrooms 0%.
//                          RNPL known 95% but only 5% yes → floor gate would hide it everywhere;
//                          deliberately not offered rather than pretending it is a real choice.
//   Studio/RentAnnual    — n=30 nationwide, thin everything; enabled minimally, gates will suppress.
//   Room/Buy (n=1) and Studio/Buy (n=2) — no cohort: genuinely not applicable.
const COHORT_QUESTIONS: Record<string, { RentAnnual?: string[]; Buy?: string[] }> = {
  Apartment: {
    RentAnnual: ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished'],
    Buy: ['property_age', 'amenities', 'bathrooms', 'direction'],
  },
  Floor: {
    RentAnnual: ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished'],
    Buy: ['property_age', 'amenities', 'bathrooms'],
  },
  'Residential Building': {
    RentAnnual: ['property_age', 'street_width', 'direction', 'furnished'],
    Buy: ['property_age', 'street_width', 'direction'],
  },
  Room: {
    RentAnnual: ['property_age', 'amenities', 'furnished'],
  },
  Studio: {
    RentAnnual: ['property_age', 'amenities', 'furnished'],
  },
  // Villa (2026-08-16): fresh-band profiling designed these. Rent: RNPL ask-first (74.7% of fresh
  // known say yes — the strongest installment market in the DB), AC textbook split, furnished,
  // plus the villa staples. Buy: NO rnpl (yes=0), NO furnished (yes below floor), and AC is
  // deliberately absent from the amenity data on Buy (aqar dropped it from بيع forms — chip
  // gates itself out). بيت/تاون هاوس ride the same search with no interview (n=3–51).
  Villa: {
    RentAnnual: ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction'],
    Buy: ['property_age', 'amenities', 'bathrooms', 'street_width', 'direction'],
  },
  // Commercial + rural + land cohorts (2026-08-16 overnight profiling, fresh-band designed).
  // AC is fresh-DEAD on commercial (aqar form change) and is deliberately enabled NOWHERE here
  // despite passing all-time gates. Bedrooms stay Normal-tier everywhere (owner permanent rule).
  // NOT-VIABLE (Normal-Filter-only, evidence in the ledger): Chalet, Camp, Factory, Staff Housing,
  // Service Facilities, Hotel/rent, Farm/rent, CommLand/rent, IndLand/rent, AgriPlot/rent, Duplex.
  Office: {
    RentAnnual: ['property_age', 'furnished', 'amenities', 'street_width'],
    Buy: ['property_age', 'street_width'],
  },
  Shop: {
    RentAnnual: ['street_width', 'direction', 'property_age', 'amenities'],
    Buy: ['street_width', 'direction', 'property_age', 'amenities'],
  },
  Showroom: {
    // Rent has MORE viable inventory than Buy (469 vs 88; 23 fresh/7d, direction 84%, street 85%,
    // age 100%) — gap found in the 2026-08-16 full-taxonomy audit. No utility chips (commercial
    // showroom electricity 0% — wasalt doesn't publish it).
    RentAnnual: ['property_age', 'street_width', 'direction'],
    Buy: ['property_age', 'street_width'],
  },
  Warehouse: {
    RentAnnual: ['property_age', 'street_width', 'amenities'],
    Buy: ['property_age', 'street_width', 'amenities'],
  },
  Workshop: {
    RentAnnual: ['street_width', 'property_age', 'direction'],
    Buy: ['street_width', 'property_age'],
  },
  'Commercial Building': {
    RentAnnual: ['property_age', 'street_width', 'direction', 'amenities'],
    Buy: ['property_age', 'street_width', 'direction', 'amenities'],
  },
  Hotel: {
    Buy: ['property_age', 'street_width', 'amenities'],
  },
  'Gas Station': {
    RentAnnual: ['property_age', 'amenities'],
    Buy: ['property_age', 'street_width', 'amenities'],
  },
  'Commercial Land': {
    Buy: ['street_width', 'direction'],
  },
  'Industrial Land': {
    Buy: ['street_width', 'direction'],
  },
  'Residential Land': {
    RentAnnual: ['street_width', 'direction'],
    Buy: ['street_width', 'direction'],
  },
  'Rest House': {
    RentAnnual: ['property_age', 'street_width', 'amenities'],
    Buy: ['property_age', 'street_width', 'direction', 'amenities'],
  },
  Farm: {
    Buy: ['street_width', 'direction', 'property_age'],
  },
  'Agriculture Plot': {
    Buy: ['street_width', 'direction', 'amenities'],
  },
};

// Which amenity CHIPS a cohort may render (2026-08-16). Clean types absent from this map keep the
// residential base set exactly as certified. Commercial/rural chips are the utility trio the data
// actually splits on (electricity/water/sanitation) — never AC (fresh-dead on commercial), never
// building amenities on land. Rest House additionally earns kitchen (fresh-alive, two-sided scale).
const COHORT_CHIPS: Record<string, string[]> = {
  Office: ['electricity', 'water_supply', 'sanitation'],
  Shop: ['electricity', 'water_supply', 'sanitation'],
  Warehouse: ['electricity', 'water_supply', 'sanitation'],
  'Commercial Building': ['electricity', 'water_supply', 'sanitation'],
  Hotel: ['electricity', 'water_supply', 'sanitation'],
  'Gas Station': ['electricity', 'water_supply', 'sanitation'],
  'Rest House': ['kitchen', 'electricity', 'water_supply', 'sanitation'],
  'Agriculture Plot': ['electricity', 'water_supply', 'sanitation'],
};

// The single clean type of the query, or null when the user picked several/none — the interview
// only ever runs on a single-type scope (counts for a mixed scope could not be cohort-honest).
function singleCleanType(q: SearchQuery): string | null {
  const types = effectiveTypes(q);
  return types.length === 1 ? types[0] : null;
}

// Is question `id` available for this query's cohort? Residential-only, single-type, deal-aware.
// Monthly Rent (q.rentPeriod === 'monthly') matches NO key by construction — frozen per owner.
function cohortAllows(q: SearchQuery, id: string): boolean {
  const type = singleCleanType(q);
  if (!type) return false;
  // The query's category must match the cohort's own macro (2026-08-16: was Residential-only
  // while only residential cohorts existed; commercial cohorts unlock their side, and a
  // cross-category scope still matches nothing).
  if (q.category !== (CLEAN_MACRO[type] ?? 'Residential')) return false;
  const cfg = COHORT_QUESTIONS[type];
  if (!cfg) return false;
  const deal: 'RentAnnual' | 'Buy' | null =
    q.deal === 'Buy' ? 'Buy'
    : q.deal === 'Rent' && q.rentPeriod !== 'monthly' ? 'RentAnnual'
    : null;
  if (!deal) return false;
  return (cfg[deal] ?? []).includes(id);
}

// Kept as named helpers (call sites + contract scripts reference them); now cohort-config-driven.
function isAnnualRentApartment(q: SearchQuery): boolean {
  return singleCleanType(q) === 'Apartment' && q.category === 'Residential'
    && q.deal === 'Rent' && q.rentPeriod !== 'monthly';
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
    if (singleCleanType(q) === 'Villa') {
      defs.push({ key: 'car_entrance', labelKey: 'Car entrance', count: (c) => c.cnt_car_entrance });
      defs.push({ key: 'sanitation',   labelKey: 'Sewage connection', count: (c) => c.cnt_sanitation });
    }
    // Commercial/rural chip scoping (2026-08-16): mapped clean types render EXACTLY their
    // COHORT_CHIPS list — the utility trio (+kitchen for Rest House) — and none of the
    // residential chips. Unmapped types keep the behavior above, byte-for-byte.
    const chipAllow = COHORT_CHIPS[singleCleanType(q) ?? ''];
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

export const ADVANCED_QUESTIONS: AdvancedQuestion[] = [
  RNPL_QUESTION, AGE_QUESTION, AMENITIES_QUESTION, BATHROOMS_QUESTION, FURNISHED_QUESTION,
  STREET_WIDTH_QUESTION, DIRECTION_QUESTION,
];

// ── Contextual ranking (owner 2026-08-11) ────────────────────────────────────────────────────────
// score = split × salience, computed from the CURRENT candidate set's counts. `split` peaks when an
// option covers half the set (1 − |2k/N − 1|); an option that matches nearly everyone (> 90% of N)
// or too few (< max(15, 8% of N)) is not worth asking about and is dropped for ranking purposes —
// the same "don't ask a question that barely changes the result set" rule the owner set, applied
// with numbers. Unknown ≠ no throughout: options only ever count KNOWN matches.
const SALIENCE: Record<string, number> = {
  property_age: 1.0, furnished: 1.0, bathrooms: 0.9, street_width: 0.9, amenities: 0.8,
  direction: 0.7, rnpl: 0.6,
};

// ASK-FIRST TIER (owner 2026-08-15). Installments (رايز/إيجاري) is the PREFERRED opening question
// for Annual Rent → Apartment: paying the year in instalments instead of one upfront sum is the
// single most consequential thing about a rental, so when it is a genuinely useful question it
// should be asked first.
//
// "Preferred" — NOT mandatory. A tier only reorders questions that ALREADY PASSED scoreQuestion()'s
// usefulness gates (scope > 25, option within [max(15, 8%N), 90%N], at least one answer cutting to
// ≤ 75%N). A scope with too little confirmed installment coverage fails those gates, scoreQuestion
// returns null, the question never enters the ranking at all, and the contextual engine picks the
// next genuinely useful question. That is the owner's rule exactly: first when it earns it, skipped
// when it does not — never a question that wastes the user's time.
//
// Implemented as an explicit tier rather than an inflated salience so the intent is legible and the
// SALIENCE numbers keep meaning "how much does this attribute matter", uncorrupted by ask-order.
const ASK_FIRST_TIER: Record<string, number> = { rnpl: 1 };
function askTier(id: string): number { return ASK_FIRST_TIER[id] ?? 0; }

export function scoreQuestion(
  question: AdvancedQuestion, result: AdvancedQuestionResult,
): { score: number; options: AdvancedOption[] } | null {
  const N = result.total;
  if (N < MIN_TOTAL_TO_SHOW) return null;
  const floor = Math.max(15, Math.ceil(0.08 * N));
  const useful = result.options.filter((o) => o.count >= floor && o.count <= 0.9 * N);
  if (useful.length < minOptionsFor(question.selection)) return null;
  // at least one answer must genuinely narrow (≤ 75% of the current set)
  if (!useful.some((o) => o.count <= 0.75 * N)) return null;
  const bestSplit = Math.max(...useful.map((o) => 1 - Math.abs((2 * o.count) / N - 1)));
  return { score: bestSplit * (SALIENCE[question.id] ?? 0.5), options: useful };
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
