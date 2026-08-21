// PURE cohort gating for the Advanced Filter — extracted from src/data/advancedFilters.ts (2026-08-20)
// so it can be EXECUTED by barriers instead of grepped. advancedFilters.ts imports ./remote and
// @/i18n (→ @/lib/supabase), which is why every existing AF verify script reads it as source TEXT;
// a regex cannot prove an intersection. This module imports only pure code, so a plain
// `node --experimental-strip-types` test can call cohortAllows() with real queries and assert the
// real answers — which is what makes the multi-type intersection mutation-provable.
//
// The cohort DATA below is unchanged, byte for byte, from where it was profiled and certified.
import type { SearchQuery } from '@/data/search';
import { CLEAN_MACRO, groupsMembers } from '../data/propertyTypes.ts';
import { effectiveTypes, effectiveGroups } from './searchDefaults.ts';

// Which amenity chips are safe for a MULTI-TYPE scope: the intersection of every selected type's
// certified chip list. Returns null when no selected type has a cohort chip list (the caller then
// keeps the residential base set, exactly as it does today for an uncertified single type), and []
// when the types disagree — an empty list means the amenities question offers nothing rather than
// offering a chip that is only valid for one side of the scope.
export function intersectChips(types: string[]): string[] | null {
  const lists = types.map((ty) => COHORT_CHIPS[ty]);
  if (lists.every((l) => !l)) return null;              // nobody constrains → base set (unchanged)
  const present = lists.map((l) => l ?? []);            // a type with NO list constrains to nothing
  const [first, ...rest] = present;
  return first.filter((c) => rest.every((l) => l.includes(c)));
}

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
export const COHORT_QUESTIONS: Record<string, { RentAnnual?: string[]; Buy?: string[]; RentMonthly?: string[] }> = {
  Apartment: {
    RentAnnual: ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished'],
    Buy: ['property_age', 'amenities', 'bathrooms', 'direction'],
    // Monthly (owner order 2026-08-18) — designed from MONTHLY data, deliberately NOT a copy of
    // RentAnnual: kitchen/AC/age/floor/furnished are fresh-DEAD in this cohort (94/7/564/53 known of
    // 30,356; furnished 100% true on Gathern). What Monthly actually has: Gathern rating (24,716
    // rated), unit subtype (استديو 9,218 / شقق مخدومة 2,040), elevator 62%, parking 33%, bathrooms 56%.
    RentMonthly: ['rating', 'unit_subtype', 'amenities', 'bathrooms'],
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
    // Monthly 2026-08-18: n=556, 446 rated; elevator 53% / parking 31%. bathrooms dead (0 known).
    RentMonthly: ['rating', 'amenities'],
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
    // Monthly 2026-08-18: n=362, 245 rated; bathrooms 92% known; parking 57% (elevator 5% self-gates).
    RentMonthly: ['rating', 'bathrooms', 'amenities'],
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
export const COHORT_CHIPS: Record<string, string[]> = {
  Office: ['electricity', 'water_supply', 'sanitation'],
  Shop: ['electricity', 'water_supply', 'sanitation'],
  Warehouse: ['electricity', 'water_supply', 'sanitation'],
  'Commercial Building': ['electricity', 'water_supply', 'sanitation'],
  Hotel: ['electricity', 'water_supply', 'sanitation'],
  'Gas Station': ['electricity', 'water_supply', 'sanitation'],
  'Rest House': ['kitchen', 'electricity', 'water_supply', 'sanitation'],
  'Agriculture Plot': ['electricity', 'water_supply', 'sanitation'],
};

// The clean types the cohort gate must be safe for. Explicit type picks when present; otherwise the
// member types of the selected group(s) — a group-only scope genuinely searches all of them, so a
// question has to be certified for all of them. ('Service Facilities' is a member type with no
// COHORT_QUESTIONS entry, which correctly collapses its group's intersection to nothing.)
export function scopeCleanTypes(q: SearchQuery): string[] {
  const sel = effectiveTypes(q);
  return sel.length ? sel : groupsMembers(effectiveGroups(q));
}

// Is question `id` available for this query's cohort? Residential-only, single-type, deal-aware.
// Monthly Rent was frozen until 2026-08-18 (owner unfreeze, 3 certified cohorts: Apartment/Room/
// Villa) — RentMonthly entries in COHORT_QUESTIONS above are real now, not dead config.
//
// MIXED PERIOD (rentPeriod === 'both', owner feature 2026-08-19) — INTERSECTION, never union.
// RentAnnual and RentMonthly are each independently profiled against real coverage data for THAT
// period alone; a question absent from one list has zero evidence it's valid there. Since the
// shared SQL predicates are strict-NULL-excluding (an unrated/unaged row FAILS a rating/age filter,
// it does not pass through as "unknown"), offering a period-specific question in a combined search
// would silently amputate the other period's rows the moment it's answered — e.g. Gathern `rating`
// (Monthly-only signal, never profiled against Annual data) would exclude every Annual listing;
// `rnpl`/`property_age` (Annual-tuned, ~2% known on Monthly Apartment) would exclude nearly every
// Monthly listing. Requiring the id in BOTH lists guarantees an offered question's predicate is
// safe against every row in a 'both' scope, for both periods, by construction — no new NULL-
// handling code, no touching af_eligibility_clause() at all (cohort gating has always lived
// client-side only, per docs/ADVANCED_FILTER_DESIGN_CONTRACT.md §9). A type with no certified
// Monthly cohort correctly offers ZERO questions in 'both' mode (empty intersection) — there is no
// evidence a mixed scope is meaningfully populated for that type either.
// MIXED TYPE (owner 2026-08-20) — INTERSECTION, never union, for exactly the reason the mixed-PERIOD
// branch below already documents. Each cohort list is profiled against THAT type's own coverage, so a
// question absent from one selected type's list has zero evidence it is valid there; because the
// shared SQL predicates are strict-NULL-excluding, offering it would amputate that type's rows the
// moment it is answered — the user asks for شقة+غرفة and gets zero غرفة back.
//
// BUY+RENT COMBINED (q.dealCombined, owner feature 2026-08-20) — a THIRD dimension that intersects
// at once with type and period, exactly like the other two: INTERSECTION across all three legs of a
// cohort — Buy, RentAnnual, AND RentMonthly (combined mode's Rent side has no period selector, so it
// spans both periods too). Same principle the mixed-period branch above already established, reusing
// the SAME already-profiled COHORT_QUESTIONS table with zero new data work: a question must be
// independently certified for Buy AND Annual Rent AND Monthly Rent before it can narrow a
// Buy∪Rent(any period) eligible set without risking a silent amputation of whichever leg it was
// never validated against. Mechanically excludes Buy-only questions (fail the Rent legs), Rent-only
// questions like rnpl (never in any cohort's Buy list), and Monthly-only signals like Gathern rating
// (never in Buy or RentAnnual); a type with no certified Monthly cohort (most commercial/rural types)
// correctly offers ZERO combined-mode questions — the same conservative "no evidence, don't ask"
// behavior 'both' already applies.
function cohortAllowsCombined(cfg: NonNullable<(typeof COHORT_QUESTIONS)[string]>, id: string): boolean {
  return (cfg.Buy ?? []).includes(id) && (cfg.RentAnnual ?? []).includes(id) && (cfg.RentMonthly ?? []).includes(id);
}

// BOTH DIMENSIONS INTERSECT AT ONCE: `.every` intersects across the selected TYPES, and the period/
// deal branches inside it intersect across PERIODS and DEAL, so a 'both'-period × 2-type scope (or a
// dealCombined × 2-type scope) must clear every relevant list before a question is offered. An empty
// scope returns false explicitly — [].every() is `true`, which would otherwise turn "nothing
// selected" into "everything allowed".
export function cohortAllows(q: SearchQuery, id: string): boolean {
  const types = scopeCleanTypes(q);
  if (!types.length) return false;
  return types.every((type) => {
    // The query's category must match the cohort's own macro (2026-08-16: was Residential-only
    // while only residential cohorts existed; commercial cohorts unlock their side, and a
    // cross-category scope still matches nothing).
    if (q.category !== (CLEAN_MACRO[type] ?? 'Residential')) return false;
    const cfg = COHORT_QUESTIONS[type];
    if (!cfg) return false;                 // uncertified type = EMPTY cohort, never "no constraint"
    if (q.dealCombined) return cohortAllowsCombined(cfg, id);
    if (q.deal === 'Buy') return (cfg.Buy ?? []).includes(id);
    if (q.deal !== 'Rent') return false;
    if (q.rentPeriod === 'monthly') return (cfg.RentMonthly ?? []).includes(id);
    if (q.rentPeriod === 'both') return (cfg.RentAnnual ?? []).includes(id) && (cfg.RentMonthly ?? []).includes(id);
    return (cfg.RentAnnual ?? []).includes(id); // plain Annual Rent (rentPeriod undefined or 'annual')
  });
}



