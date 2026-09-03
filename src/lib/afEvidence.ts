// ADVANCED-FILTER CARD EVIDENCE — one shared registry mapping every certified AF predicate to the
// card-visible proof that THIS listing satisfied it (owner rule 2026-09-02: «مطابق لطلبك»).
//
// PURE on purpose (no React, no remote, runtime imports only from pure modules) so the barrier
// scripts/verify-af-card-evidence.ts can EXECUTE it instead of regexing it.
//
// THREE RULES THIS MODULE ENCODES, in the order they run inside afEvidence():
//   1. UNKNOWN STAYS UNKNOWN. Before any formatter sees a row, every canonical column the active
//      question reads is checked for null. Any null → that question contributes NOTHING. No
//      «غير مذكور», no 0, no false, no placeholder. A NULL can only sit beside an active predicate
//      through index↔raw drift (every AF SQL predicate is strict NULL-excluding), and the honest
//      rendering of drift is silence.
//   2. DRIFT IS NEVER SHOWN AS A MATCH. `ok()` re-runs the predicate on the row (same rule as the
//      SQL); a row that does not satisfy it contributes nothing.
//   3. THE ROW VALUE IS THE TEXT. Threshold/range questions print the listing's ACTUAL value
//      (bathMin 3 + row 4 → «4 حمامات»), never the user's pick.
//
// TRUTH SOURCE. `AfCanon` is the `af_canon` jsonb the results RPC returns — the canonical
// search_listings_ar row the predicate ran on, copied verbatim (`c.af_canon ?? null`, never coerced)
// onto Listing.canon. It is NOT Listing.features / Listing.bathrooms: those come from the raw platform
// tables and finalize() collapses NULL to 0/false there. The barrier feeds a Proxy row that records
// every read and asserts the reads ⊆ the def's declared `reads` — a hidden `?? 0` or an undeclared
// column read turns it RED.
//
// PREDICATE CARRIER. afActive() reads ONLY the AF predicate fields (AF_PREDICATE_FIELDS) of the
// query the search actually ran with — m.result.query, frozen per results turn — never afFacets,
// guidedPills, afReceipt or the Filter screen's live store query. A facet the user cleared is absent
// from the next search's query, so it cannot leak onto cards.
//
// QUESTION IDS are the certified pool: the union of every leg of COHORT_QUESTIONS (the same registry
// cohortAllows() gates on). The barrier derives that set by execution and fails on any certified
// question without a def here, and on any AF_PREDICATE_FIELDS member not owned by exactly one def.
import type { SearchQuery } from '@/data/search';
import { AF_PREDICATE_FIELDS } from './searchDefaults.ts';

type AfField = (typeof AF_PREDICATE_FIELDS)[number];
export type T = (en: string, vars?: Record<string, string | number>) => string;

/** Verbatim `af_canon` jsonb from the results RPC. Every value nullable. NEVER coerced. */
export type AfCanon = Record<string, unknown>;

export type EvidenceDef = {
  /** SearchQuery predicate fields this question OWNS (partition of AF_PREDICATE_FIELDS). */
  fields: readonly AfField[];
  /** Inverse of the question's apply(): the active option keys, or null when not active in q. */
  active: (q: SearchQuery) => string[] | null;
  /** Canonical columns the predicate reads for these keys — the ONLY columns chips() may touch. */
  reads: (keys: string[]) => string[];
  /** The predicate itself, on a row where no read is null. */
  ok: (keys: string[], row: AfCanon) => boolean;
  /** Chip text from the ROW value. Called only when ok() held. */
  chips: (keys: string[], row: AfCanon, t: T) => string[];
};

// Amenity token → canonical column (the RPC's p_amenities allowlist, 20 tokens; rnpl is its own
// question). Every column exists on search_listings_ar and is packed into af_canon.
export const AMENITY_COL: Record<string, string> = {
  kitchen: 'kitchen', parking: 'parking', elevator: 'elevator', ac: 'air_conditioner',
  private_entrance: 'private_entrance', maid_room: 'maid_room', driver_room: 'driver_room',
  car_entrance: 'car_entrance', sanitation: 'sanitation', electricity: 'electricity',
  water_supply: 'water_supply', furnished: 'furnished', gym: 'gym', pool: 'pool', garden: 'garden',
  balcony: 'balcony', laundry_room: 'laundry_room', optical_fibers: 'optical_fibers',
  separate_electricity_meter: 'separate_electricity_meter', separate_water_meter: 'separate_water_meter',
};
// Amenity token → the AF chip's OWN labelKey (advancedFilters.ts AMENITIES_QUESTION defs) — one voice
// for the chip and its evidence (owner decision 6). The barrier asserts each pair equals the def, so
// a token whose label is re-invented here (or missing) goes RED; a token without a label renders no
// chip (never a guess). All 20 allowlisted tokens are chips as of the class-wide truth barrier.
export const AMENITY_LABEL: Record<string, string> = {
  kitchen: 'Kitchen', parking: 'Parking', elevator: 'Elevator', ac: 'Air conditioning',
  private_entrance: 'Private entrance', maid_room: 'Maid room', driver_room: 'Driver room',
  car_entrance: 'Car entrance', sanitation: 'Sewage connection', electricity: 'Electricity',
  water_supply: 'Water supply', furnished: 'Furnished', gym: 'Gym', pool: 'Pool', garden: 'Garden',
  balcony: 'Balcony', laundry_room: 'Laundry room', optical_fibers: 'Optical fibers',
  separate_electricity_meter: 'Separate electricity meter',
  separate_water_meter: 'Separate water meter',
};
// Canonical direction value (after normalisation) → the AF option labelKey (DIRECTION_DEFS).
export const DIRECTION_LABEL: Record<string, string> = {
  'شمال': 'North', 'جنوب': 'South', 'شرق': 'East', 'غرب': 'West',
  'شمال شرق': 'North-east', 'شمال غرب': 'North-west', 'جنوب شرق': 'South-east', 'جنوب غرب': 'South-west',
};
// Canonical unit_subtype_ar value → the AF option labelKey (UNIT_SUBTYPE_QUESTION defs).
export const SUBTYPE_LABEL: Record<string, string> = {
  'استديو': 'Studio unit', 'شقق مخدومة': 'Serviced apartment', 'شقة': 'Regular apartment',
};

// JS mirror of public.norm_direction_ar(text): the SQL predicate compares norm(direction_ar) against
// the picks, and sources publish the diagonals adjectivally («شمال شرقي», «جنوب غربية»). Same
// replace set, same order; a value outside the 8 canonical results is UNKNOWN (no chip).
export function normDirectionAr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = ` ${v} `;
  for (const [adj, noun] of [
    [' شمالية ', ' شمال '], [' شمالي ', ' شمال '], [' جنوبية ', ' جنوب '], [' جنوبي ', ' جنوب '],
    [' شرقية ', ' شرق '], [' شرقي ', ' شرق '], [' غربية ', ' غرب '], [' غربي ', ' غرب '],
  ]) s = s.split(adj).join(noun);
  const out = s.replace(/\s+/g, ' ').trim();
  return out && DIRECTION_LABEL[out] ? out : null;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

// Age option key ⇄ range. The AF's own keys ('new' | '1_2' | '3_5' | '6_9' | '10p') round-trip
// exactly; any other ageMin/ageMax combination the chat path can set («أقل من 3 سنوات» → ageMax only)
// encodes the same way, so no combination is invisible.
function ageKey(q: SearchQuery): string[] | null {
  if (q.isNewConstruction === true) return ['new'];
  if (q.ageMin == null && q.ageMax == null) return null;
  return [q.ageMax == null ? `${q.ageMin}p` : `${q.ageMin ?? ''}_${q.ageMax}`];
}
function ageOk(key: string, v: number): boolean {
  if (key === 'new') return v === 0;
  const m = /^(\d*)(?:_(\d+)|p)$/.exec(key);
  if (!m) return false;
  const lo = m[1] === '' ? null : Number(m[1]);
  const hi = m[2] == null ? null : Number(m[2]);
  return (lo == null || v >= lo) && (hi == null || v <= hi);
}
// Owner decision 5: canonical 10 is exact for aqar but the «10+» bucket for wasalt — «١٠ سنوات فأكثر»
// is the one rendering truthful under both codings.
function ageText(v: number, t: T): string {
  if (v === 0) return t('New construction');
  if (v === 1) return t('Age: one year');
  if (v === 2) return t('Age: two years');
  if (v === 10) return t('10+ years');
  return v < 10 ? t('Age: {n} years', { n: v }) : t('Age: {n} years (over ten)', { n: v });
}

// Registry order = ADVANCED_QUESTIONS order, so the same query yields the same chip order on every
// card (the barrier pins it against the real pool).
export const AF_EVIDENCE: Record<string, EvidenceDef> = {
  rnpl: {
    fields: ['amenities'],
    active: (q) => (q.amenities?.includes('rnpl') ? ['rnpl'] : null),
    reads: () => ['rent_now_pay_later'],
    ok: (_k, r) => r.rent_now_pay_later === true,
    chips: (_k, _r, t) => [t('Offers installments')],
  },
  property_age: {
    fields: ['ageMin', 'ageMax', 'isNewConstruction'],
    active: ageKey,
    reads: () => ['property_age'],
    ok: (k, r) => ageOk(k[0], num(r.property_age)),
    chips: (_k, r, t) => [ageText(num(r.property_age), t)],
  },
  amenities: {
    fields: ['amenities'],
    active: (q) => { const k = (q.amenities ?? []).filter((x) => x !== 'rnpl'); return k.length ? k : null; },
    reads: (k) => k.map((x) => AMENITY_COL[x] ?? `__unknown_amenity__${x}`),
    ok: (k, r) => k.every((x) => r[AMENITY_COL[x]] === true),           // AND — every token must hold
    chips: (k, _r, t) => k.filter((x) => AMENITY_LABEL[x]).map((x) => t(AMENITY_LABEL[x])),
  },
  bathrooms: {
    fields: ['bathMin'],
    active: (q) => (q.bathMin != null ? [String(q.bathMin)] : null),
    reads: () => ['bathrooms'],
    ok: (k, r) => num(r.bathrooms) >= Number(k[0]),
    // Same voice as the card's own bath Stat («4 حمامات»): the ACTUAL count, never the rung.
    chips: (_k, r, t) => [`${r.bathrooms} ${t(r.bathrooms === 1 ? 'Bath' : 'Baths')}`],
  },
  furnished: {
    fields: ['furnishedPref'],
    active: (q) => (q.furnishedPref == null ? null : [q.furnishedPref ? 'yes' : 'no']),
    reads: () => ['furnished'],
    ok: (k, r) => r.furnished === (k[0] === 'yes'),
    // false is a value the SOURCE stated («غير مفروشة»); null never reaches here.
    chips: (_k, r, t) => [t(r.furnished === true ? 'Furnished' : 'Unfurnished')],
  },
  street_width: {
    fields: ['streetWidthMin'],
    active: (q) => (q.streetWidthMin != null ? [String(q.streetWidthMin)] : null),
    reads: () => ['street_width_m'],
    ok: (k, r) => num(r.street_width_m) >= Number(k[0]),
    chips: (_k, r, t) => [`${t('Street width')} ${r.street_width_m} ${t('m')}`],
  },
  direction: {
    fields: ['directions'],
    active: (q) => (q.directions?.length ? q.directions : null),
    reads: () => ['direction_ar'],
    // OR over the picks — the listing's ONE real facing is by construction the pick that matched.
    ok: (k, r) => { const d = normDirectionAr(r.direction_ar); return d != null && k.includes(d); },
    chips: (_k, r, t) => [t(DIRECTION_LABEL[normDirectionAr(r.direction_ar) as string])],
  },
  rating: {
    fields: ['ratingMin', 'reviewsMin'],
    // Key = the AF's own option keys ('9.5' | '9.0' | '9.0_rc10'): one decimal, so a query built by
    // RATING_QUESTION.apply() round-trips exactly (the barrier asserts apply → active → [key]).
    active: (q) => (q.ratingMin == null ? null : [q.reviewsMin != null ? `${q.ratingMin.toFixed(1)}_rc${q.reviewsMin}` : q.ratingMin.toFixed(1)]),
    reads: (k) => (k[0].includes('_rc') ? ['rating', 'reviews_count'] : ['rating']),
    ok: (k, r) => {
      const [min, rc] = k[0].split('_rc');
      return num(r.rating) >= Number(min) && (rc == null || num(r.reviews_count) >= Number(rc));
    },
    chips: (k, r, t) => [k[0].includes('_rc') ? `★ ${r.rating} (${t('{n} reviews', { n: r.reviews_count as number })})` : `★ ${r.rating}`],
  },
  unit_subtype: {
    fields: ['unitSubtypes'],
    active: (q) => (q.unitSubtypes?.length ? q.unitSubtypes : null),
    reads: () => ['unit_subtype_ar'],
    ok: (k, r) => typeof r.unit_subtype_ar === 'string' && k.includes(r.unit_subtype_ar) && r.unit_subtype_ar in SUBTYPE_LABEL,
    chips: (_k, r, t) => [t(SUBTYPE_LABEL[r.unit_subtype_ar as string])],
  },
};

export type ActiveAf = ReadonlyArray<{ id: string; keys: string[] }>;
const NONE: ActiveAf = Object.freeze([]);
// One stable reference per frozen result.query, so the memoised card comparator sees the same prop
// across the reveal cascade and «عرض المزيد» (which reuses the same query object).
const memo = new WeakMap<SearchQuery, ActiveAf>();

/** Which certified questions are active in the query the search ran with, and with which keys. */
export function afActive(q?: SearchQuery | null): ActiveAf {
  if (!q) return NONE;
  const hit = memo.get(q);
  if (hit) return hit;
  const out: Array<{ id: string; keys: string[] }> = [];
  for (const id of Object.keys(AF_EVIDENCE)) {
    const keys = AF_EVIDENCE[id].active(q);
    if (keys && keys.length) out.push({ id, keys });
  }
  const frozen: ActiveAf = out.length ? Object.freeze(out) : NONE;
  memo.set(q, frozen);
  return frozen;
}

export type EvidenceChip = { id: string; text: string };

/** The chips a card may show: per active question, null-guard → predicate → formatter. */
export function afEvidence(active: ActiveAf, row: AfCanon | null | undefined, t: T): EvidenceChip[] {
  if (!row) return [];
  const out: EvidenceChip[] = [];
  for (const { id, keys } of active) {
    const d = AF_EVIDENCE[id];
    if (!d) continue;
    if (d.reads(keys).some((c) => row[c] == null)) continue;   // UNKNOWN → NOTHING, before any formatter
    if (!d.ok(keys, row)) continue;                           // drift → NOTHING, never a false match
    for (const text of d.chips(keys, row, t)) out.push({ id, text });
  }
  return out;
}
