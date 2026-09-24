// THE CARD'S COUNT IS PAIRED BY REQUEST, NEVER BY ARRIVAL ORDER (routine #5, 2026-09-24).
//
// `verify-af-live-truth.ts` asserted «the card's count IS the count RPC's cnt_selected» by comparing
// the chip to the LAST `apartment_guided_counts_ar` response it had seen. That was true when it was
// written (2026-09-02) and false from 2026-09-21, when `primeFooterCounts` shipped: a tap is now
// followed by a serial walk that prices EVERY option of the question, ~680 ms apart, so the last
// response is the last primed option.
//
// Measured on production 2026-09-24, on both journeys the check had reached:
//   Residential/Buy/Apartment/الرياض — card 2,968 (المطبخ)  vs last response 5,488 (عداد ماء مستقل)
//   Residential/Buy/Villa/الرياض     — card 10,904          vs last response 385
// Both reported FAIL. Both cards were correct. A false accusation is the expensive failure here: it
// is indistinguishable, in a CI log, from Advanced Filter lying about a number.
//
// This barrier EXECUTES the pairing (scripts/lib/afCountPairing.ts) against a synthetic priming walk
// built from those measured numbers, and carries the OLD rule as a mutation that must fail where the
// new one passes — and, in the other direction, proves the new rule still catches a chip no count
// call explains, which is the defect the assertion exists for.
import { pairCountForChip, pairCountForSelection, pricedTheTappedOption, type CountPair } from './lib/afCountPairing.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The repo's proof call: apply the barrier's own predicate to a deliberately broken input and fail
// if the mutant survives (scripts/verify-new-barriers-are-mutation-proven.ts).
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    caught ? '' : 'MUTANT SURVIVED — the pairing rule is blind to the defect it exists for');

console.log('\nA card\'s count is paired to the call that priced it, not to whatever answered last\n');

const pair = (amenity: string, sel: number): CountPair =>
  ({ body: { p_cities: ['الرياض'], p_deal: 'بيع', p_types: ['شقة'], p_amenities: [amenity] }, resp: [{ cnt_selected: sel }] });

// The measured walk: the user tapped المطبخ (2,968) and the app then priced every other option,
// finishing on عداد ماء مستقل (5,488).
const PRE: CountPair = { body: { p_cities: ['الرياض'], p_deal: 'بيع', p_types: ['شقة'] }, resp: [{ cnt_selected: 13700 }] };
const WALK: CountPair[] = [
  pair('kitchen', 2968), pair('parking', 761), pair('elevator', 1780), pair('ac', 307),
  pair('private_entrance', 640), pair('maid_room', 139), pair('driver_room', 24), pair('balcony', 198),
  pair('laundry_room', 208), pair('optical_fibers', 371), pair('separate_electricity_meter', 6456),
  pair('separate_water_meter', 5488),
];

// ── 1. the measured false red ────────────────────────────────────────────────────────────────────
{
  const paired = pairCountForChip(WALK, 2968);
  check('the chip 2,968 pairs with the call that priced المطبخ — not with the last response (5,488)',
    paired?.body.p_amenities[0] === 'kitchen', JSON.stringify(paired?.body.p_amenities));
  mustCatch('the OLD rule — compare the chip to the LAST response — which is why this was red',
    Number(WALK[WALK.length - 1].resp[0].cnt_selected) !== 2968);
  const priced = pricedTheTappedOption(paired, PRE.body, 'kitchen');
  check('…and that call is shown to have priced the option the user tapped', priced.ok && priced.literal,
    JSON.stringify(priced));
}

// ── 2. the defect the assertion exists for still bites ───────────────────────────────────────────
{
  // A chip the client derived: no count call in the walk returns it.
  check('a chip no count call explains pairs with NOTHING (a client-derived number is still caught)',
    pairCountForChip(WALK, 4242) === null);
  check('…and a null chip is never paired with anything', pairCountForChip(WALK, null) === null);
  check('…and an empty walk cannot pair (no post-tap count call means NOT proved, never proved)',
    pairCountForChip([], 2968) === null);
  mustCatch('a verdict rendered with NO paired call to judge',
    pricedTheTappedOption(null, PRE.body, 'kitchen').ok === false);
}

// ── 3. the wrong option's number does not sneak through ──────────────────────────────────────────
{
  // The card shows مواقف's number while the user tapped المطبخ. The number alone FINDS a call (the
  // walk prices every option), so the number alone is not the test — the combined rule is.
  check('a card showing another option\'s number does find a call by number alone (why the rule is combined)',
    pairCountForChip(WALK, 761)?.body.p_amenities[0] === 'parking');
  check('…and the combined rule REFUSES it: no call priced 761 while carrying «kitchen»',
    pairCountForSelection(WALK, 761, 'kitchen', PRE.body).paired === null);
}

// ── 3b. the tap fires NO call of its own — the number was primed before it ───────────────────────
// Measured on production 2026-09-24: 0 count calls followed the tap, because the option had already
// been priced during the search wait. A rule that only searched AFTER the tap called a correct card
// «the chip did not come from a count RPC».
{
  const r = pairCountForSelection(WALK, 2968, 'kitchen', PRE.body);
  check('the chip is paired with the call that primed it BEFORE the tap',
    r.paired?.body.p_amenities[0] === 'kitchen' && r.via === 'literal', JSON.stringify(r.via));
  mustCatch('the second old rule — search only the calls issued AFTER the tap, of which there are none',
    pairCountForSelection([], 2968, 'kitchen', PRE.body).paired === null);
}

// ── 4. the fallback, for a key the body cannot spell ─────────────────────────────────────────────
{
  // property_age «جديد» writes p_is_new_construction: true — the key is not literal anywhere.
  const agePaired: CountPair = {
    body: { p_cities: ['الرياض'], p_deal: 'بيع', p_types: ['شقة'], p_is_new_construction: true },
    resp: [{ cnt_selected: 9322 }],
  };
  const r = pricedTheTappedOption(agePaired, PRE.body, 'new');
  check('a key the body cannot spell falls back to "the scope moved", and says so',
    r.ok && !r.literal && r.movedKeys.includes('p_is_new_construction'), JSON.stringify(r));
  const viaMoved = pairCountForSelection([...WALK, agePaired], 9322, 'new', PRE.body);
  check('…and the combined rule pairs it through that fallback, and SAYS it used the fallback',
    viaMoved.paired === agePaired && viaMoved.via === 'moved', JSON.stringify(viaMoved.via));
  const unmoved = pricedTheTappedOption({ body: PRE.body, resp: [{ cnt_selected: 13700 }] }, PRE.body, 'new');
  mustCatch('a body that never moved off the pre-AF scope passing the fallback',
    unmoved.ok === false);
}

console.log(failed
  ? `\n✗ ${failed} check(s) failed\n`
  : '\n✓ a card\'s count is judged against the call that priced it\n');
process.exit(failed ? 1 : 0);
