// PURE cohort gating for the Advanced Filter — extracted from src/data/advancedFilters.ts (2026-08-20)
// so it can be EXECUTED by barriers instead of grepped. advancedFilters.ts imports ./remote and
// @/i18n (→ @/lib/supabase), which is why every existing AF verify script reads it as source TEXT;
// a regex cannot prove an intersection. This module imports only pure code, so a plain
// `node --experimental-strip-types` test can call cohortAllows() with real queries and assert the
// real answers — which is what makes the multi-type intersection mutation-provable.
//
// The cohort DATA below is unchanged, byte for byte, from where it was profiled and certified.
import type { SearchQuery } from '@/data/search';
import { groupsMembers, offeredUnder } from '../data/propertyTypes.ts';
import { effectiveTypes, effectiveGroups, isShortStaysScope } from './searchDefaults.ts';
export { isShortStaysScope };

// ── SHORT STAYS: one pool, one cohort, no type question (owner 2026-10-31) ───────────────────────
// «إقامات قصيرة» is Gathern + Aqar Monthly and nothing else, so a plain short-stays search is one
// cohort whatever group or type is in scope — the per-type intersection below is for inventories
// that differ by type, and here they do not. Measured 2026-10-31 over all 18,963 short-stay ads:
// bathrooms known on 18,741 (98.8 %, every type ≥ 82 %); amenity chips are positive-only tokens.
// The three ASKED questions, in the owner's order (decision 3): 🚽 bathrooms → 🔑 comfort → 🏊 fun &
// space & safety → ✨ fun (locked 2026-11-01). No property type (decision 1), no rating (decision 2 — Aqar Monthly has no rating, so a
// rating floor would hide all of its ads). `comfort`, `space` and `fun` are the generic amenities card
// split by theme (owner 2026-10-31 / 2026-11-01); all three write q.amenities.
export const SHORT_STAYS_QUESTIONS = ['bathrooms', 'comfort', 'space', 'fun'] as const;
// Certified for a TYPED sentence only («فيها مصعد», «تقييم ٩ وفوق», «استديو»): the chat keeps using
// them as today (afIntents.ts gates on cohortAllows), the card never asks them on short stays.
export const SHORT_STAYS_CHAT_ONLY = ['amenities', 'rating', 'unit_subtype'] as const;
const SHORT_STAYS_CERTIFIED: readonly string[] = [...SHORT_STAYS_QUESTIONS, ...SHORT_STAYS_CHAT_ONLY];
export const shortStaysAsks = (id: string): boolean => (SHORT_STAYS_QUESTIONS as readonly string[]).includes(id);
// The fixed ask order on short stays: rankQuestions() sorts by this tier instead of ASK_FIRST_TIER
// (a tier only reorders questions that already cleared the usefulness gates — never forces one).
export function shortStaysAskTier(id: string): number {
  const i = (SHORT_STAYS_QUESTIONS as readonly string[]).indexOf(id);
  return i < 0 ? 0 : SHORT_STAYS_QUESTIONS.length - i;
}
// The chips each short-stays question offers TODAY — every key already has its count path
// (cnt_<key> in apartment_guided_counts_ar) and its p_amenities slug. The owner's full lists (self
// check-in, Wi-Fi, bills included, grill, kids' play area, jacuzzi, outdoor seating) join one chip at
// a time, each with its free-word-reader words and count first (docs/ops/AI_FACTS_READER.md).
// COMFORT_QUESTION / SPACE_QUESTION / FUN_QUESTION in advancedFilters.ts inline the same keys (they are lifted by
// barriers and cannot import these); verify-short-stays-one-cohort.ts pins the two copies equal.
// The owner's locked lists (2026-11-01), today's data-backed subset of each:
//   🔑 comfort        — self check-in · Wi-Fi · washing machine · bills included · elevator · parking · private entrance
//   🏠 space & safety — majlis · balcony · private roof · soundproof · cameras · cleaning service
//   ✨ fun            — pool · gym · jacuzzi · smart TV / cinema · billiards
// «washing machine» rides the existing laundry_room fact (owner: «+ existing laundry_room»).
// ── THE OWNER'S LOCKED CARD LISTS (handoff 2026-10-31, built 2026-11-01) ─────────────────────────────────
// One list per (property type × deal) for the «Apartments & Co-living» group. A CARD is a themed multi-select
// question (comfort, space, safety, …) whose chips are amenity TOKENS — every token here has its p_amenities arm,
// its cnt_<token> and its af_canon column (migration 20261101100930). Nothing else is planned by hand: every
// combination a user can make is computed by cardPlan() below, never by a hand-written list.
export type CohortDeal = 'RentAnnual' | 'Buy' | 'RentMonthly';
export const CARD_IDS = ['comfort', 'space', 'safety', 'perks', 'build', 'extras', 'who', 'features', 'services', 'fun'] as const;
export type CardId = (typeof CARD_IDS)[number];
type CardLists = Partial<Record<CardId, readonly string[]>>;
// Short stays = Gathern + Aqar Monthly, one pool for the whole group (owner 2026-10-31): Studio, serviced
// apartment and room are sub-types of apartment there, so the Apartment row is THE short-stays row.
const SHORT_STAYS_CARDS: CardLists = {
  comfort: ['self_checkin', 'wifi', 'laundry_room', 'bills_included', 'elevator', 'parking', 'private_entrance'],
  space: ['majlis', 'balcony', 'roof', 'soundproof', 'cameras', 'cleaning_service'],
  fun: ['pool', 'gym', 'jacuzzi', 'smart_tv', 'billiards'],
};
const APARTMENT_BUY_CARDS: CardLists = {
  comfort: ['kitchen', 'ac', 'parking', 'elevator', 'private_entrance', 'roof', 'two_entrances'],
  space: ['majlis', 'maid_room', 'driver_room', 'balcony', 'storage', 'garden', 'whole_floor'],
  safety: ['cameras', 'guard', 'smart_entry', 'smart_home', 'intercom', 'fire_system', 'ev_charger'],
  build: ['warranty', 'water_tank', 'central_gas', 'separate_meters', 'central_vacuum', 'pool', 'gym'],
};
export const COHORT_CARDS: Record<string, Partial<Record<CohortDeal, CardLists>>> = {
  Apartment: {
    RentAnnual: {
      comfort: ['kitchen', 'ac', 'parking', 'elevator', 'furnished', 'private_entrance', 'bills_included'],
      space: ['majlis', 'maid_room', 'driver_room', 'roof', 'two_entrances', 'balcony', 'garden'],
      safety: ['cameras', 'guard', 'smart_entry', 'smart_home', 'central_gas', 'optical_fibers', 'separate_meters'],
      perks: ['gym', 'pool', 'sauna', 'kids_play_area', 'nursery', 'cleaning_service', 'free_maintenance'],
    },
    Buy: APARTMENT_BUY_CARDS,
    RentMonthly: SHORT_STAYS_CARDS,
  },
  Floor: {
    RentAnnual: {
      comfort: ['kitchen', 'ac', 'parking', 'furnished', 'private_entrance', 'car_entrance', 'elevator'],
      space: ['majlis', 'dining_majlis', 'maid_room', 'driver_room', 'roof', 'two_entrances', 'yard'],
      extras: ['storage', 'laundry_room', 'annex', 'garage', 'grill', 'water_tank', 'balcony'],
      safety: ['separate_meters', 'optical_fibers', 'cameras', 'smart_entry', 'central_gas', 'smart_home', 'pool'],
    },
    Buy: {
      comfort: ['kitchen', 'ac', 'parking', 'elevator', 'private_entrance', 'car_entrance', 'two_entrances'],
      space: ['majlis', 'dining_majlis', 'maid_room', 'driver_room', 'roof', 'yard', 'annex'],
      extras: ['storage', 'laundry_room', 'garage', 'grill', 'balcony', 'garden', 'pool'],
      build: ['warranty', 'water_tank', 'separate_meters', 'sanitation', 'insulation', 'electronic_deed', 'cameras'],
    },
  },
  Room: {
    RentAnnual: {
      comfort: ['ac', 'furnished', 'kitchen', 'bills_included', 'own_bathroom', 'private_entrance', 'parking'],
      who: ['singles', 'families'],
      extras: ['optical_fibers', 'cameras', 'elevator', 'guard', 'fridge', 'laundry_room', 'smart_entry'],
    },
    RentMonthly: SHORT_STAYS_CARDS,
  },
  Studio: {
    RentAnnual: {
      comfort: ['furnished', 'kitchen', 'ac', 'parking', 'elevator', 'bills_included', 'private_entrance'],
      extras: ['gym', 'optical_fibers', 'cameras', 'roof', 'pool', 'balcony', 'laundry_room'],
    },
    Buy: APARTMENT_BUY_CARDS,
    RentMonthly: SHORT_STAYS_CARDS,
  },
  'Residential Building': {
    Buy: {
      features: ['elevator', 'separate_meters', 'annex', 'parking', 'roof', 'basement', 'two_entrances'],
      build: ['sanitation', 'warranty', 'optical_fibers', 'water_tank', 'electronic_deed', 'guard', 'cameras'],
    },
    RentAnnual: {
      features: ['parking', 'elevator', 'ac', 'furnished', 'separate_meters', 'basement', 'annex'],
      services: ['sanitation', 'warranty', 'optical_fibers', 'roof', 'cameras', 'two_entrances', 'water_tank'],
    },
  },
};
export const SHORT_STAYS_COMFORT_KEYS = SHORT_STAYS_CARDS.comfort!;
export const SHORT_STAYS_SPACE_KEYS = SHORT_STAYS_CARDS.space!;
export const SHORT_STAYS_FUN_KEYS = SHORT_STAYS_CARDS.fun!;
// Every question that writes the one q.amenities bag and is token-filtered on re-entry (afCarry.ts):
// the generic card, the ten themed cards, and the two Residential Building ladders (apartments, shops).
export const AMENITY_BAG_QUESTION_IDS: ReadonlySet<string> = new Set(['amenities', ...CARD_IDS, 'apartments', 'shops']);
export const isCardId = (id: string): id is CardId => (CARD_IDS as readonly string[]).includes(id);

// The deal legs a query spans, in primary order. Buy+Rent combined / bothDeals span all three (the search's
// p_deal IS NULL); 'both' periods span the two rent legs; plain short stays is one pool (see cardPlan).
export function scopeDeals(q: SearchQuery): CohortDeal[] {
  if (q.dealCombined || q.bothDeals) return ['RentAnnual', 'Buy', 'RentMonthly'];
  if (q.deal === 'Buy') return ['Buy'];
  if (q.deal !== 'Rent') return [];
  if (q.rentPeriod === 'monthly') return ['RentMonthly'];
  if (q.rentPeriod === 'both') return ['RentAnnual', 'RentMonthly'];
  return ['RentAnnual'];
}
const cardUnion = (lists: CardLists | undefined): Set<string> | null =>
  lists ? new Set(Object.values(lists).flatMap((l) => [...(l ?? [])])) : null;
// A card stands on its own with this many chips; in a MIXED scope smaller leftovers pool together.
const CARD_STANDALONE_MIN = 4;

/**
 * HOW THE LISTS COMBINE (owner rule 2026-10-31, worked examples in docs/ops/ADVANCED_FILTER_APARTMENTS_GROUP.md):
 * every leg (type × deal) in scope must certify a chip somewhere in ITS lists — INTERSECTION, never union, so a
 * chip the user taps is true for every ad in the result (UNKNOWN never becomes NO). The surviving chips keep the
 * PRIMARY leg's card layout (the first selected type, its first deal); a leg with no card lists certifies nothing.
 * In a mixed scope, cards left with fewer than CARD_STANDALONE_MIN chips are pooled: the pool keeps the first
 * card's id while it grows, and a trailing small pool is shown as «extras» — the owner's all-three-deals example
 * (bathrooms · comfort ×6 · extras ×3) is exactly this rule executed. A single leg returns its own list unchanged.
 */
export function cardPlan(q: SearchQuery): Array<{ id: CardId; keys: string[] }> {
  const shortStays = isShortStaysScope(q);
  const types = shortStays ? ['Apartment'] : scopeCleanTypes(q);
  const deals = shortStays ? (['RentMonthly'] as CohortDeal[]) : scopeDeals(q);
  if (!types.length || !deals.length) return [];
  if (!shortStays && types.some((ty) => !q.category || !offeredUnder(q.category, ty))) return [];
  // A group type with NO cohort for a deal (Floor / Residential Building have no short-stay ads at all, Room and
  // Studio no Buy market to speak of) contributes no leg there: the owner's «Floor with Rent + Buy selected
  // together» list is Rent ∩ Buy, and a combined scope's empty monthly leg must not erase it. Any other type keeps
  // the stricter rule (every selected deal must be certified) exactly as before.
  const legs = types.flatMap((type) => deals
    .filter((deal) => !COHORT_CARDS[type] || COHORT_QUESTIONS[type]?.[deal])
    .map((deal) => ({ type, deal })));
  if (!legs.length) return [];
  const unions = legs.map((l) => cardUnion(COHORT_CARDS[l.type]?.[l.deal]));
  if (unions.some((u) => !u)) return [];
  const primary = COHORT_CARDS[legs[0].type]?.[legs[0].deal] ?? {};
  const kept = CARD_IDS
    .filter((id) => primary[id])
    .map((id) => ({ id, keys: (primary[id] ?? []).filter((k) => unions.every((u) => u!.has(k))) }))
    .filter((c) => c.keys.length);
  if (legs.length === 1) return kept;
  // Pooling (mixed scopes only): a card that kept CARD_STANDALONE_MIN chips stands where it is; smaller ones pool
  // under the first small card's id until the pool is big enough. A trailing pool of 3+ is its own «extras» card
  // (or joins an extras card already shown); a trailing 1-2 joins the last card shown.
  const out: Array<{ id: CardId; keys: string[] }> = [];
  let pool: { id: CardId; keys: string[] } | null = null;
  for (const c of kept) {
    if (c.keys.length >= CARD_STANDALONE_MIN) { out.push(c); continue; }
    pool = pool ? { id: pool.id, keys: [...pool.keys, ...c.keys] } : { id: c.id, keys: [...c.keys] };
    if (pool.keys.length >= CARD_STANDALONE_MIN) { out.push(pool); pool = null; }
  }
  if (pool) {
    const extras = out.find((c) => c.id === 'extras');
    if (pool.keys.length >= 3 && !extras) out.push({ id: 'extras', keys: pool.keys });
    else if (pool.keys.length >= 3 && extras) extras.keys = [...extras.keys, ...pool.keys];
    else if (out.length) out[out.length - 1] = { id: out[out.length - 1].id, keys: [...out[out.length - 1].keys, ...pool.keys] };
    else out.push({ id: 'extras', keys: pool.keys });
  }
  return out;
}
/** The chips card `id` offers in this scope ([] = the card is not offered). */
export function cardKeys(q: SearchQuery, id: string): string[] {
  return cardPlan(q).find((c) => c.id === id)?.keys ?? [];
}
// The owner's numbered order for the group's lists (2026-10-31): installments → bathrooms → age → street width →
// facing → apartments → shops → the cards, comfort first, fun last. A tier only reorders questions that already
// cleared the usefulness gates; it never forces one (afRanking.ts). Scopes without cards keep askTier().
const GROUP_ASK_ORDER = ['rnpl', 'bathrooms', 'property_age', 'street_width', 'direction', 'apartments', 'shops',
  'comfort', 'space', 'who', 'extras', 'safety', 'perks', 'build', 'features', 'services', 'fun'] as const;
export function groupAskTier(id: string): number {
  const i = (GROUP_ASK_ORDER as readonly string[]).indexOf(id);
  return i < 0 ? 0 : GROUP_ASK_ORDER.length - i;
}
export const hasCards = (q: SearchQuery): boolean => cardPlan(q).length > 0;

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
  // ── «Apartments & Co-living» (owner handoff 2026-10-31, built 2026-11-01): the CARD ids (comfort, space,
  // safety, perks, build, extras, who, features, services, fun) are themed amenity questions whose chips come
  // from COHORT_CARDS; `amenities` and `furnished` stay listed because the TYPED chat sentence («فيها مصعد»,
  // «مفروشة») is certified through them (certifiedAmenityKeys / afIntents) — the generic amenities card and the
  // separate furnished question are not ASKED where a card carries the chip (see advancedFilters.ts).
  Apartment: {
    RentAnnual: ['rnpl', 'bathrooms', 'property_age', 'comfort', 'space', 'safety', 'perks', 'amenities', 'furnished'],
    Buy: ['property_age', 'bathrooms', 'direction', 'comfort', 'space', 'safety', 'build', 'amenities'],
    // Monthly (owner order 2026-08-18) — designed from MONTHLY data, deliberately NOT a copy of
    // RentAnnual: kitchen/AC/age/floor/furnished are fresh-DEAD in this cohort (94/7/564/53 known of
    // 30,356; furnished 100% true on Gathern). What Monthly actually has: Gathern rating (24,716
    // rated), unit subtype (استديو 9,218 / شقق مخدومة 2,040), elevator 62%, parking 33%, bathrooms 56%.
    // 2026-10-31: plain short stays reads SHORT_STAYS_QUESTIONS instead (one pool); this list feeds the
    // 'both' / Buy+Rent intersections and the certified pool. rating/unit_subtype: chat-only there.
    RentMonthly: ['rating', 'unit_subtype', 'amenities', 'bathrooms', 'comfort', 'space', 'fun'],
  },
  Floor: {
    RentAnnual: ['rnpl', 'bathrooms', 'property_age', 'comfort', 'space', 'extras', 'safety', 'amenities', 'furnished'],
    Buy: ['property_age', 'bathrooms', 'direction', 'comfort', 'space', 'extras', 'build', 'amenities'],
  },
  // Investor type: NO bathrooms (a whole building), NO installments; two ladders of its own — how many apartments
  // (apartments_count) and has shops (shops_count), both read from the ad's words (owner 2026-10-31).
  'Residential Building': {
    RentAnnual: ['property_age', 'street_width', 'apartments', 'shops', 'features', 'services', 'amenities', 'furnished'],
    Buy: ['property_age', 'street_width', 'direction', 'apartments', 'shops', 'features', 'build', 'amenities'],
  },
  Room: {
    // NO bathrooms (known on 82 of 2,145 — a strict question would hide 95 %), NO property age (owner 2026-10-31).
    RentAnnual: ['rnpl', 'comfort', 'who', 'extras', 'amenities', 'furnished'],
    // Monthly 2026-08-18: n=556, 446 rated; elevator 53% / parking 31%. bathrooms dead (0 known).
    RentMonthly: ['rating', 'amenities', 'comfort', 'space', 'fun'],
  },
  Studio: {
    // Annual: bathrooms 1+/2+ kept (known on 232), no installments (0 ads), no age (62 known) — owner 2026-10-31.
    RentAnnual: ['bathrooms', 'comfort', 'extras', 'amenities', 'furnished'],
    // Buy (78 ads): the Apartment Buy questions; a chip with 0 ads hides itself.
    Buy: ['property_age', 'bathrooms', 'direction', 'comfort', 'space', 'safety', 'build', 'amenities'],
    RentMonthly: ['amenities', 'bathrooms', 'comfort', 'space', 'fun'],
  },
  // Villa (2026-08-16): fresh-band profiling designed these. Rent: RNPL ask-first (74.7% of fresh
  // known say yes — the strongest installment market in the DB), AC textbook split, furnished,
  // plus the villa staples. Buy: NO rnpl (yes=0), NO furnished (yes below floor), and AC is
  // deliberately absent from the amenity data on Buy (aqar dropped it from بيع forms — chip
  // gates itself out). بيت rides the same search with no interview (n=3–51); تاون هاوس moved to Duplex (owner 2026-10-12).
  Villa: {
    RentAnnual: ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction'],
    Buy: ['property_age', 'amenities', 'bathrooms', 'street_width', 'direction'],
    // Monthly 2026-08-18: n=362, 245 rated; bathrooms 92% known; parking 57% (elevator 5% self-gates).
    RentMonthly: ['rating', 'bathrooms', 'amenities'],
  },
  // Commercial + rural + land cohorts (2026-08-16 overnight profiling, fresh-band designed).
  // AC is fresh-DEAD on commercial (aqar form change) and is deliberately enabled NOWHERE here
  // despite passing all-time gates. Bedrooms stay Normal-tier everywhere (owner permanent rule).
  // NOT-VIABLE (Normal-Filter-only, evidence in the ledger): Chalet, Camp, Staff Housing,
  // Service Facilities, Hotel/rent, Farm/rent, CommLand/rent, IndLand/rent, AgriPlot/rent.
  //
  // ── Re-audit 2026-08-23 (owner order) of the six types that were leaving whole GROUPS with no
  // Advanced Filter. Each was measured against TODAY's production inventory and then adjudicated
  // against the LIVE source page, never against plausibility. Two earned a cohort; four did not.
  //
  //   Duplex/Buy      CERTIFIED below — n=117, 9 platforms, top platform 40.2% (genuinely diverse),
  //                   5 fresh/7d. ONE field survives: bathrooms, 76/117 known (65%), four narrowing
  //                   rungs (>=1:76, >=2:76, >=3:75, >=4:69). Source-adjudicated 6/6 exact against
  //                   hajerhouses' own «دورات المياه» field. Nothing else clears: age 12/117,
  //                   street width 14/117, direction 9/117, kitchen 7, parking 6, furnished 1,
  //                   rnpl 0 — all far below any usable floor. NOT padded with Villa's questions.
  //   Factory ×2      CERTIFIED below — rent n=72 (7 fresh/7d), buy n=34 (2 fresh/7d); aqar-commercial
  //                   monoculture (94%), flagged like Shop/IndLand before it. street_width verified
  //                   10/10 EXACT against aqar's own structured `street_width` payload key, with one
  //                   correct UNKNOWN where the source is silent. property_age is ALSO source-verified
  //                   (10/10) but is deliberately NOT listed below: Factory's n is under the 150-row
  //                   MIN_TOTAL_TO_SHOW floor for age specifically, so the question could never be
  //                   offered — listing it here would be availability for a question this type can
  //                   never be asked. (Property age eligibility is cohortAllows(q, 'property_age')
  //                   against this table directly — 2026-09-01, no longer a second hand-kept map.)
  //   Chalet          NOT certified. It passes every DB-side gate (rent-annual n=61: age 53, bath 54,
  //                   street width 56) — but of 24 rows adjudicated against source, HALF (12) now have
  //                   both structured keys null on the live page. Counts built on values the source no
  //                   longer publishes are stale by construction. Needs a fresher sample, not a cohort.
  //   Camp            NOT certified — 4 rows rent-annual, 28 monthly with 0 fresh in 7d.
  //   Staff Housing   NOT certified — 3 rows rent-annual, 1 monthly.
  //   Service Facs.   NOT certified — 40 rows TOTAL spread across six unrelated raw types
  //                   (bank 11 / parking 10 / telecom tower 9 / school 6 / health centre 4); the
  //                   largest is 11. One shared question across banks and telecom towers is not a
  //                   question, whatever the row count says.
  //
  // NOTE, measured the same day: certifying these does NOT open Advanced Filter for any group. Every
  // group's ceiling is set by the intersection of its ALREADY-CERTIFIED members — «Industrial &
  // Logistics» is capped at 1 by Warehouse ∩ Workshop no matter what Factory carries, and «Villas &
  // Houses» needs a SECOND supported Duplex field it does not have. See
  // scripts/verify-af-group-cohort-coverage.ts for the pinned per-group matrix.
  Duplex: {
    Buy: ['bathrooms'],
  },
  Factory: {
    RentAnnual: ['street_width'],
    Buy: ['street_width'],
  },
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
  // أرض خام (owner 2026-10-09: «make an advanced filter for أرض خام»). Profiled on the 6,008 tagged rows:
  // Buy 5,939 / Rent 69 → Buy only (Rent is too thin to certify). street width known 92% (p25 15 m,
  // p75 25 m — a real split), direction known 84% over 8 values. NO utility chips: «no electricity/
  // water/sewage» is what makes a land raw, so those chips can only ever answer «no».
  'Raw Land': {
    Buy: ['street_width', 'direction'],
  },
  // أرض أخرى (owner 2026-10-10): a plot whose source states no usage. Only what every land type already
  // shares — street width and facade, true of ANY plot whatever its usage; no usage-specific question.
  'Other Land': {
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
// bothDeals IS THE SAME SCOPE FOR CERTIFICATION (found 2026-09-02, owner property-type audit).
// src/data/remote.ts sends `p_deal: (q.bothDeals || q.dealCombined) ? null : …` and
// af_eligibility_clause() reads p_deal IS NULL as Buy ∪ Rent(any period) — so the two fields mean
// ONE thing to the search. cohortAllows() branched on dealCombined alone, so the AI-chat fallback
// (bothDeals = the agent could not tell Buy from Rent from free text) certified questions against a
// SINGLE leg while the search spanned both: the R2.2.2 amputation, and the same shape as the
// property_age divergence that audit began with — the request boundary treats two fields as one
// concept while the certification gate treats them as two. Intersecting is a pure NARROWING, since
// Buy ∩ RentAnnual ∩ RentMonthly is a subset of any single leg.
// Proof: scripts/verify-af-question-gate-is-one-predicate.ts §5.
function cohortAllowsCombined(cfg: NonNullable<(typeof COHORT_QUESTIONS)[string]>, id: string, type?: string): boolean {
  // Apartments & Co-living (owner 2026-10-31): a deal the type has no cohort for is an empty leg, not a veto — Floor
  // with Buy + Rent asks bathrooms and age (its Rent ∩ Buy lists) although Floor has no short-stay market at all.
  if (type && COHORT_CARDS[type]) {
    const legs = (['Buy', 'RentAnnual', 'RentMonthly'] as const).filter((d) => cfg[d]);
    return legs.length > 0 && legs.every((d) => (cfg[d] ?? []).includes(id));
  }
  return (cfg.Buy ?? []).includes(id) && (cfg.RentAnnual ?? []).includes(id) && (cfg.RentMonthly ?? []).includes(id);
}

// BOTH DIMENSIONS INTERSECT AT ONCE: `.every` intersects across the selected TYPES, and the period/
// deal branches inside it intersect across PERIODS and DEAL, so a 'both'-period × 2-type scope (or a
// dealCombined × 2-type scope) must clear every relevant list before a question is offered. An empty
// scope returns false explicitly — [].every() is `true`, which would otherwise turn "nothing
// selected" into "everything allowed".
export function cohortAllows(q: SearchQuery, id: string): boolean {
  // Short stays first (owner 2026-10-31): one pool, so no type — and no group — is needed to ask.
  if (isShortStaysScope(q)) return SHORT_STAYS_CERTIFIED.includes(id) && (!isCardId(id) || cardKeys(q, id).length > 0);
  // A themed card (owner 2026-10-31) is certified exactly when cardPlan() leaves it at least one chip that EVERY
  // leg of the scope certifies — the same intersection, computed over the chips instead of the question ids.
  if (isCardId(id)) return cardKeys(q, id).length > 0;
  const types = scopeCleanTypes(q);
  if (!types.length) return false;
  return types.every((type) => {
    // The query's category must match the cohort's own macro (2026-08-16: was Residential-only
    // while only residential cohorts existed; commercial cohorts unlock their side, and a
    // cross-category scope still matches nothing).
    // …and a cross-macro shortcut (Residential Land offered under تجاري, owner 2026-10-03) counts as
    // reachable on that side: offeredUnder() = home macro OR a group on this side lists it.
    if (!q.category || !offeredUnder(q.category, type)) return false;
    const cfg = COHORT_QUESTIONS[type];
    if (!cfg) return false;                 // uncertified type = EMPTY cohort, never "no constraint"
    if (q.dealCombined || q.bothDeals) return cohortAllowsCombined(cfg, id, type);  // bothDeals: see above
    if (q.deal === 'Buy') return (cfg.Buy ?? []).includes(id);
    if (q.deal !== 'Rent') return false;
    if (q.rentPeriod === 'monthly') return (cfg.RentMonthly ?? []).includes(id);
    if (q.rentPeriod === 'both') {
      // a group type without a monthly cohort has no monthly leg to intersect (same rule as cohortAllowsCombined)
      if (COHORT_CARDS[type] && !cfg.RentMonthly) return (cfg.RentAnnual ?? []).includes(id);
      return (cfg.RentAnnual ?? []).includes(id) && (cfg.RentMonthly ?? []).includes(id);
    }
    return (cfg.RentAnnual ?? []).includes(id); // plain Annual Rent (rentPeriod undefined or 'annual')
  });
}




// ── CERTIFIED AMENITY VOCABULARY (owner ruling 2026-08-29, AI-chat one-shot understanding) ────────
//
// The AI chat may now map amenities stated in a user's own sentence («فيها مصعد وموقف») straight into
// q.amenities, without the user walking the Advanced Filter flow first. That is only safe if the chat
// is held to EXACTLY the same certification the AF chips are held to — so this is the single place
// that answers "which amenity tokens are certified for this scope", and both paths ask it.
//
// It is deliberately a SUBSET-SAFE gate, not a suggestion engine:
//   - the amenities QUESTION must itself be certified for the cohort (cohortAllows) — an uncertified
//     type is an EMPTY cohort, never "no constraint"
//   - a mapped commercial/rural type gets EXACTLY its COHORT_CHIPS list and none of the residential
//     tokens; a multi-type scope gets the INTERSECTION (owner 2026-08-20), so a disagreeing scope
//     yields nothing rather than one side's token
//   - villa-only tokens stay villa-only
// Anything not returned here is NOT certified for this scope and must never reach q.amenities. The
// caller asks the user instead — guessing an uncertified attribute is how UNKNOWN silently becomes No.
const RESIDENTIAL_AMENITY_BASE = [
  'kitchen', 'parking', 'elevator', 'ac', 'private_entrance', 'maid_room', 'driver_room',
  // Added 2026-08-31 (owner, gym-bug class sweep): these columns already existed on
  // search_listings_ar (2026-08-10/11 rich-canonical-columns + car_entrance/optical_fibers
  // migrations) with real, populated data, but were never wired past the ALTER TABLE — the exact
  // same situation "gym" was in. Live counts checked 2026-08-31 (fleet-wide true/941 total 197,768):
  // gym 13, pool 44, garden 49, balcony 1,476, laundry_room 1,959, optical_fibers 2,911,
  // separate_electricity_meter 52,652, separate_water_meter 46,474. See
  // supabase/migrations/20260831205347_af_amenity_tokens_residential_rich_set.sql for the RPC side.
  'gym', 'pool', 'garden', 'balcony', 'laundry_room', 'optical_fibers',
  'separate_electricity_meter', 'separate_water_meter',
  // majlis (owner 2026-10-26, handoff decision #3): the first filter question born from the stored text facts.
  // search_listings_ar.majlis = af_rule_b(the site's majlis count > 0 — aqar/wasalt, 7,328 ads — , the ad's own
  // quoted «مجلس» — 91k ads). Migration «majlis_advanced_filter_amenity»; positive-only IS TRUE token.
  'majlis',
] as const;
// aqar villa ads carry مدخل سيارة / صرف صحي checkboxes the apartment forms do not (2026-08-16).
const VILLA_ONLY_AMENITIES = ['car_entrance', 'sanitation'] as const;

export function certifiedAmenityKeys(q: SearchQuery): string[] {
  // A scope whose cards exist (the Apartments & Co-living lists, owner 2026-10-31) certifies EXACTLY the chips its
  // cards offer — the typed chat sentence, the cards and the re-entry carry are held to one vocabulary — plus the
  // Residential Building ladders where those questions are certified (apts4/8/12/20, has_shops are p_amenities
  // tokens too). This comes BEFORE the generic-amenities gate: on the group box with Buy, Room has no Buy list, so
  // `amenities` is uncertified while the cards still offer comfort + safety; the carry must keep those answers.
  const plan = cardPlan(q);
  if (plan.length) {
    const keys = new Set(plan.flatMap((c) => c.keys));
    if (cohortAllows(q, 'apartments')) for (const k of ['apts4', 'apts8', 'apts12', 'apts20']) keys.add(k);
    if (cohortAllows(q, 'shops')) keys.add('has_shops');
    return [...keys];
  }
  // Not certified for this cohort at all ⇒ no amenity token is applicable. Never fall through to a
  // base list here: that would let an uncertified cohort acquire constraints the AF path refuses.
  if (!cohortAllows(q, 'amenities')) return [];
  // Short stays (owner 2026-10-31): the chips the two short-stays cards offer, for the whole pool,
  // whatever type is in scope — a «Vacation & Rural» group would otherwise intersect Rest House's
  // utility trio with Chalet's nothing and offer no chip at all.
  if (isShortStaysScope(q)) return [...SHORT_STAYS_COMFORT_KEYS, ...SHORT_STAYS_SPACE_KEYS, ...SHORT_STAYS_FUN_KEYS];
  // No empty-scope guard here on purpose: cohortAllows() already returns false when scopeCleanTypes
  // is empty, so a second check is dead code — it cannot change behaviour and cannot be tested. (A
  // mutation removing it was provably EQUIVALENT, which is what exposed it as redundant.)
  const scope = scopeCleanTypes(q);
  // Mapped commercial/rural types render EXACTLY their list; [] means the selected types disagree.
  const chipAllow = intersectChips(scope);
  if (chipAllow) return [...chipAllow];
  const base: string[] = [...RESIDENTIAL_AMENITY_BASE];
  if (scope.every((ty) => ty === 'Villa')) base.push(...VILLA_ONLY_AMENITIES);
  // «مفروشة» is an amenity CHIP on the same card, not just the separate Furnished question:
  // AMENITIES_QUESTION.resolveOptions pushes `{ key: 'furnished' }` on exactly this condition, after
  // exactly this chipAllow early-return — so the option list and this list must mirror each other or
  // the card offers a token nothing else certifies. It did (2026-09-01): the chip was offered on
  // الرياض/إيجار/سنوي/شقة, committed, written to the store, and then deleted by the re-entry carry
  // ({"p_amenities":["furnished"]} → {}) — a DROPPED filter on a cohort that never moved. The same
  // absence made afCertify's step-4 carried-token sweep reject it on the next chat turn.
  // `furnished` is a real p_amenities token server-side (af_eligibility_clause.sql: `not
  // ('furnished' = any(p_amenities)) or s.furnished`), so keeping it only ever narrows.
  // The chat cannot smuggle it in: the edge's amenity vocabulary deliberately excludes it and routes
  // furnishing through the separate tri-state `furnished` key → furnishedPref.
  if (cohortAllows(q, 'furnished')) base.push('furnished');
  return base;
}

// THREE AF questions write their answer into the ONE `q.amenities` bag: the amenities card itself,
// plus `furnished` and `rnpl`, which are separate questions with their own, much narrower
// certification (the RPC's p_amenities vocabulary carries all three — 'furnished' and 'rnpl'/
// 'rent_now_pay_later' are listed there alongside the chips). certifiedAmenityKeys() is the CHIP
// vocabulary and knows only the first, so a furnished or RNPL answer the cohort genuinely certifies
// came back `rejected` from the gate below: the chat path then deleted the user's own filter and
// announced it as uncertified. Measured on 2026-09-02 by executing the real gate over every cohort:
// 10 (cohort × question) pairs, 7 of them `furnished` — including Residential Building/RentAnnual,
// which certifies furnished while certifying no amenity chips at all.
//
// Each is gated on its OWN question id. Folding them into the amenities gate would be the opposite
// error and a worse one: rnpl certifies on 3 cohorts where amenities certifies on 24, so 'amenities'
// as a proxy would let RNPL through wherever generic amenities happen to be allowed — the exact
// impersonation scripts/verify-agent-af-intent-coverage.ts §3 exists to forbid.
const AMENITY_BAG_WRITERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['furnished', ['furnished']],
  ['rnpl', ['rnpl', 'rent_now_pay_later']],
];

/**
 * Split requested amenity tokens into the ones this scope certifies and the ones it does not.
 *
 * `rejected` is NOT a soft failure to swallow — it is the clarification trigger. The owner's rule:
 * if an amenity is not certified for that cohort, ASK the user rather than guessing. Applying it
 * anyway would filter on a field whose semantics this cohort has never certified; silently dropping
 * it would answer a narrower question than the user asked while the reply still claims otherwise.
 */
export function partitionRequestedAmenities(
  q: SearchQuery, requested: string[],
): { certified: string[]; rejected: string[] } {
  const allowed = new Set(certifiedAmenityKeys(q));
  for (const [id, tokens] of AMENITY_BAG_WRITERS) {
    if (cohortAllows(q, id)) for (const tok of tokens) allowed.add(tok);
  }
  const certified: string[] = [];
  const rejected: string[] = [];
  for (const raw of requested) {
    const key = String(raw ?? '').trim().toLowerCase();
    if (!key) continue;
    if (certified.includes(key) || rejected.includes(key)) continue; // stable, de-duplicated
    (allowed.has(key) ? certified : rejected).push(key);
  }
  return { certified, rejected };
}
