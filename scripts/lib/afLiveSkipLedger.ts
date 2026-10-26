// THE SKIP LEDGER FOR THE AF OPTION-CARD LIVE CHECK (🔬 2026-10-17, backlog 598).
//
// verify-af-option-card-truth-live.ts counts every SKIP against its exit code, which is right for an
// INCONCLUSIVE case: a check that could not run must not read green. But six of its SKIPs were not
// inconclusive. They were the same six on every run, against a correct production (run 39003098853:
// 0 FAILED, 6 SKIPPED, exit 1), so the af-card-state job could never go green and its P1 stayed open.
// Two different facts were sharing one word:
//
//   1. «I could not measure this» (production slow, oracle cannot translate a key)  → still FAILS;
//   2. «this case cannot occur in this journey, by a rule written in code»           → NOT APPLICABLE.
//
// Of the six, four were neither: the «😔 did not mention» caption on the amenities, bathrooms, street
// width, rating, unit-type and RNPL questions DOES have a single truthful number — the RPC counts it
// with its own IS NULL filter (cnt_*_unknown, migration 20261003184909). The check simply did not know
// which column, so it skipped. `unknownColumnFilter` below names it, so those four are now real checks.
//
// The two left are registered in NOT_APPLICABLE with the code fact that makes them so. A label that is
// not registered can never be not-applicable: `classifySkip` turns it back into an inconclusive SKIP,
// so nobody can make a red run green by calling a new skip «not applicable».

/** Every amenity column apartment_guided_counts_ar folds into cnt_amen_unknown (the listing stated no
 *  amenity at all). Read from the live function body on 2026-10-17. */
export const AMEN_UNKNOWN_COLUMNS = [
  'kitchen', 'parking', 'elevator', 'air_conditioner', 'private_entrance', 'maid_room', 'driver_room',
  'car_entrance', 'sanitation', 'electricity', 'water_supply', 'gym', 'pool', 'garden', 'balcony',
  'laundry_room', 'optical_fibers', 'separate_electricity_meter', 'separate_water_meter', 'majlis', 'furnished',
] as const;

const AGE = new Set(['new', '1_2', '3_5', '6_9', '10p', 'upto2', 'upto5', 'upto9']);
const DIRECTION = new Set(['شمال', 'جنوب', 'شرق', 'غرب', 'شمال شرق', 'شمال غرب', 'جنوب شرق', 'جنوب غرب']);
const BATH = new Set(['1', '2', '3', '4']);
const STW = new Set(['15', '20', '25', '30']);
const RATING = new Set(['9.5', '9.0', '9.0_rc10']);
const SUBTYPE = new Set(['استديو', 'شقق مخدومة', 'شقة']);

export type UnknownColumn = { what: string; qs: string; rpcCol: string | null };

/**
 * The single column (or, for amenities, the single conjunction) whose NULL count IS the caption the
 * card prints, as a PostgREST filter for search_listings_ar, plus the RPC column the app read it from.
 * `amenityKeys` is the certified amenity token set. null = the card's keys name no known question.
 */
export function unknownColumnFilter(keys: string[], amenityKeys: Set<string>): UnknownColumn | null {
  const any = (s: Set<string>) => keys.some((k) => s.has(k));
  if (any(AGE)) return { what: 'property_age', qs: 'property_age=is.null', rpcCol: null };
  if (keys.includes('yes') || keys.includes('no')) return { what: 'furnished', qs: 'furnished=is.null', rpcCol: null };
  if (any(DIRECTION)) return { what: 'direction_ar', qs: 'direction_ar=is.null', rpcCol: null };
  if (any(BATH)) return { what: 'bathrooms', qs: 'bathrooms=is.null', rpcCol: 'cnt_bath_unknown' };
  if (any(STW)) return { what: 'street_width_m', qs: 'street_width_m=is.null', rpcCol: 'cnt_stw_unknown' };
  if (any(RATING)) return { what: 'rating', qs: 'rating=is.null', rpcCol: 'cnt_rating_unknown' };
  if (any(SUBTYPE)) return { what: 'unit_subtype_ar', qs: 'unit_subtype_ar=is.null', rpcCol: 'cnt_sub_unknown' };
  // The installments card is its own question with the single key `rnpl`.
  if (keys.length > 0 && keys.every((k) => k === 'rnpl')) return { what: 'rent_now_pay_later', qs: 'rent_now_pay_later=is.null', rpcCol: 'cnt_rnpl_unknown' };
  if (keys.some((k) => amenityKeys.has(k))) {
    return {
      what: `every amenity column (${AMEN_UNKNOWN_COLUMNS.length})`,
      qs: `and=(${AMEN_UNKNOWN_COLUMNS.map((c) => `${c}.is.null`).join(',')})`,
      rpcCol: 'cnt_amen_unknown',
    };
  }
  return null;
}

/** The only cases allowed to be NOT APPLICABLE, each with the code fact that makes it so. The key is
 *  a stable id the call site passes; `holds` re-checks the fact at run time, so a reason that stops
 *  being true turns the case back into an inconclusive SKIP. */
export const NOT_APPLICABLE: Record<string, { reason: string }> = {
  'network-page-below-cap': {
    reason: 'the shipped «عرض المزيد» cap (SECOND_PAGE_CAP) is not above the page-0 buffer, so no press can page the network; ' +
      'predicate continuity across network pages is proven in verify-af-compound-predicate*.ts',
  },
  'cap-offer-after-pool-burned': {
    reason: 'this journey skipped every question of the round (R8.1.3), so R11.2 retires the Advanced Filter by contract; ' +
      'an absent «تحديد أكثر» here is the contract working, and a present one is still checked',
  },
};

export type SkipVerdict = 'not-applicable' | 'inconclusive';

/** A case is not applicable only when it is REGISTERED and its fact HOLDS on this run. Anything else is
 *  inconclusive, which fails the run. */
export function classifySkip(id: string | null, factHolds: boolean, registry = NOT_APPLICABLE): SkipVerdict {
  return id != null && Object.hasOwn(registry, id) && factHolds === true ? 'not-applicable' : 'inconclusive';
}

/** The run's exit verdict: failures and inconclusive skips fail; not-applicable cases never do. */
export const runFails = (failures: number, inconclusive: number): boolean => failures > 0 || inconclusive > 0;
