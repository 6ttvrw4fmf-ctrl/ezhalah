// THE APARTMENTS & CO-LIVING CARDS ARE THE OWNER'S LOCKED LISTS, COMBINED BY ONE RULE (owner handoff 2026-10-31,
// built 2026-11-01; docs/ops/ADVANCED_FILTER_APARTMENTS_GROUP.md). This EXECUTES cardPlan() / cohortAllows() from
// src/lib/afCohorts.ts against the owner's own worked examples — never a regex over the file — and proves each guard
// with a mutant copy of the module that must FAIL it.
//   node --experimental-strip-types scripts/verify-af-apartments-group-cards.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardPlan, cohortAllows, certifiedAmenityKeys, COHORT_CARDS, CARD_IDS, AMENITY_BAG_QUESTION_IDS, groupAskTier } from '../src/lib/afCohorts.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

const base = { category: 'Residential', location: '', amenities: [] } as unknown as SearchQuery;
const Q = (q: Partial<SearchQuery>): SearchQuery => ({ ...base, ...q } as SearchQuery);
type Plan = ReturnType<typeof cardPlan>;
const flat = (p: Plan) => p.map((c) => `${c.id}:${c.keys.join(',')}`).join(' | ');
const keysOf = (p: Plan) => new Set(p.flatMap((c) => c.keys));

console.log('\n§1 single legs are the owner\'s lists, verbatim\n');
const aptAnnual = cardPlan(Q({ deal: 'Rent', types: ['Apartment'] }));
check('Annual rent → Apartment: comfort · space · safety · perks, 7 chips each, in the owner\'s order',
  flat(aptAnnual) === 'comfort:kitchen,ac,parking,elevator,furnished,private_entrance,bills_included | space:majlis,maid_room,driver_room,roof,two_entrances,balcony,garden | safety:cameras,guard,smart_entry,smart_home,central_gas,optical_fibers,separate_meters | perks:gym,pool,sauna,kids_play_area,nursery,cleaning_service,free_maintenance', flat(aptAnnual));
check('Annual rent → Apartment asks installments, bathrooms and age; «furnished» is a chip, so its question is still certified for the typed sentence',
  ['rnpl', 'bathrooms', 'property_age', 'furnished'].every((id) => cohortAllows(Q({ deal: 'Rent', types: ['Apartment'] }), id)));
check('Buy → Apartment: comfort · space · safety · build; no installments, no furnished question',
  flat(cardPlan(Q({ deal: 'Buy', types: ['Apartment'] }))).startsWith('comfort:kitchen,ac,parking,elevator,private_entrance,roof,two_entrances | space:majlis,maid_room,driver_room,balcony,storage,garden,whole_floor | safety:')
  && !cohortAllows(Q({ deal: 'Buy', types: ['Apartment'] }), 'rnpl') && !cohortAllows(Q({ deal: 'Buy', types: ['Apartment'] }), 'furnished'));
const short = cardPlan(Q({ deal: 'Rent', rentPeriod: 'monthly', types: ['Apartment'] }));
check('Short stays → Apartment: 🔑 comfort (self check-in, Wi-Fi, washing machine, bills included, elevator, parking, private entrance) · 🏠 space & safety · ✨ fun',
  flat(short) === 'comfort:self_checkin,wifi,laundry_room,bills_included,elevator,parking,private_entrance | space:majlis,balcony,roof,soundproof,cameras,cleaning_service | fun:pool,gym,jacuzzi,smart_tv,billiards', flat(short));
check('Short stays on the GROUP box is the same one pool (no type needed)',
  flat(cardPlan(Q({ deal: 'Rent', rentPeriod: 'monthly', typeGroups: ['Apartments & Co-living'] }))) === flat(short));
check('Room → Annual rent: comfort · who · extras; NO bathrooms, NO age (owner: bathrooms known on 82 of 2,145)',
  cardPlan(Q({ deal: 'Rent', types: ['Room'] })).map((c) => c.id).sort().join() === 'comfort,extras,who'
  && !cohortAllows(Q({ deal: 'Rent', types: ['Room'] }), 'bathrooms') && !cohortAllows(Q({ deal: 'Rent', types: ['Room'] }), 'property_age'));
check('Studio → Annual rent: bathrooms kept, no installments, no age; comfort · extras',
  cohortAllows(Q({ deal: 'Rent', types: ['Studio'] }), 'bathrooms') && !cohortAllows(Q({ deal: 'Rent', types: ['Studio'] }), 'rnpl')
  && !cohortAllows(Q({ deal: 'Rent', types: ['Studio'] }), 'property_age')
  && cardPlan(Q({ deal: 'Rent', types: ['Studio'] })).map((c) => c.id).join() === 'comfort,extras');
const bldgBuy = Q({ deal: 'Buy', types: ['Residential Building'] });
check('Buy → Residential Building: age · street width · direction · apartments · shops · features · build; NO bathrooms',
  ['property_age', 'street_width', 'direction', 'apartments', 'shops', 'features', 'build'].every((id) => cohortAllows(bldgBuy, id))
  && !cohortAllows(bldgBuy, 'bathrooms') && !cohortAllows(bldgBuy, 'rnpl'));
check('Annual rent → Residential Building: no direction, no furnished question; features · services',
  !cohortAllows(Q({ deal: 'Rent', types: ['Residential Building'] }), 'direction')
  && cardPlan(Q({ deal: 'Rent', types: ['Residential Building'] })).map((c) => c.id).sort().join() === 'features,services');
check('Villa is untouched (no cards; its own cohort list still asks)', cardPlan(Q({ deal: 'Rent', types: ['Villa'] })).length === 0
  && cohortAllows(Q({ deal: 'Rent', types: ['Villa'] }), 'bathrooms') && cohortAllows(Q({ deal: 'Rent', types: ['Villa'] }), 'amenities'));

console.log('\n§2 the owner\'s worked examples (intersection, never union)\n');
const aptFloor = cardPlan(Q({ deal: 'Rent', types: ['Apartment', 'Floor'] }));
check('Annual rent → Apartment + Floor: kitchen/AC/parking/elevator/furnished/private entrance; majlis/maid/driver/roof/two entrances/balcony; cameras/smart entry/central gas/fiber/meters',
  flat(aptFloor).startsWith('comfort:kitchen,ac,parking,elevator,furnished,private_entrance | space:majlis,maid_room,driver_room,roof,two_entrances,balcony | safety:cameras,smart_entry,smart_home,central_gas,optical_fibers,separate_meters'), flat(aptFloor));
check('  …gone: bills included, car entrance, annex, garage (each certified by one side only)',
  ['bills_included', 'car_entrance', 'annex', 'garage'].every((k) => !keysOf(aptFloor).has(k)));
const aptRoom = Q({ deal: 'Rent', types: ['Apartment', 'Room'] });
check('Annual rent → Apartment + Room: NO bathrooms (rooms don\'t know it); installments, AC, furnished, kitchen, bills included, private entrance, parking, cameras, fiber, elevator remain',
  !cohortAllows(aptRoom, 'bathrooms') && cohortAllows(aptRoom, 'rnpl')
  && ['ac', 'furnished', 'kitchen', 'bills_included', 'private_entrance', 'parking', 'cameras', 'optical_fibers', 'elevator'].every((k) => keysOf(cardPlan(aptRoom)).has(k)));
const three = Q({ deal: 'Rent', dealCombined: true, types: ['Apartment'] });
check('Apartment with Buy + Annual rent + Short stays: bathrooms; comfort = parking, elevator, private entrance, majlis, balcony, roof; extras = cameras, pool, gym',
  cohortAllows(three, 'bathrooms') && flat(cardPlan(three)) === 'comfort:parking,elevator,private_entrance,majlis,roof,balcony | extras:cameras,gym,pool', flat(cardPlan(three)));
check('  …not shown there: installments, age, direction, self check-in, Wi-Fi, warranty',
  !cohortAllows(three, 'rnpl') && !cohortAllows(three, 'property_age') && !cohortAllows(three, 'direction')
  && ['self_checkin', 'wifi', 'warranty'].every((k) => !keysOf(cardPlan(three)).has(k)));
const group = cardPlan(Q({ deal: 'Rent', typeGroups: ['Apartments & Co-living'] }));
check('Whole group box, annual rent: the small shared set only (≈ 6 chips)', keysOf(group).size === 6
  && ['ac', 'parking', 'elevator', 'furnished', 'cameras', 'optical_fibers'].every((k) => keysOf(group).has(k)), flat(group));
const floorBoth = Q({ deal: 'Rent', dealCombined: true, types: ['Floor'] });
check('Floor with Rent + Buy: bathrooms · age · comfort · space · extras (Rent ∩ Buy; Floor has no short-stay leg)',
  cohortAllows(floorBoth, 'bathrooms') && cohortAllows(floorBoth, 'property_age') && !cohortAllows(floorBoth, 'rnpl') && !cohortAllows(floorBoth, 'direction')
  && cardPlan(floorBoth).map((c) => c.id).join() === 'comfort,space,extras'
  // cameras and pool survive the intersection (both lists carry them) and self-hide where thin — the owner's «gone»
  // for those two was a data note, not a list rule.
  && ['furnished', 'warranty', 'electronic_deed', 'insulation'].every((k) => !keysOf(cardPlan(floorBoth)).has(k)), flat(cardPlan(floorBoth)));
const bldgBoth = Q({ deal: 'Rent', dealCombined: true, types: ['Residential Building'] });
check('Residential Building with Rent + Buy: age · street width · apartments · shops · features · services; gone: direction, deed, AC, furnished',
  ['property_age', 'street_width', 'apartments', 'shops'].every((id) => cohortAllows(bldgBoth, id)) && !cohortAllows(bldgBoth, 'direction')
  && ['electronic_deed', 'ac', 'furnished'].every((k) => !keysOf(cardPlan(bldgBoth)).has(k))
  && ['parking', 'elevator', 'separate_meters', 'basement', 'annex', 'roof', 'two_entrances', 'sanitation', 'warranty', 'optical_fibers', 'water_tank', 'cameras'].every((k) => keysOf(cardPlan(bldgBoth)).has(k)), flat(cardPlan(bldgBoth)));

console.log('\n§3 one vocabulary: cards, chat and the bag writers\n');
check('the typed sentence is certified for EXACTLY the chips the cards offer (certifiedAmenityKeys = cardPlan keys)',
  [...keysOf(aptAnnual)].sort().join() === [...certifiedAmenityKeys(Q({ deal: 'Rent', types: ['Apartment'] }))].sort().join());
check('every card id writes the one q.amenities bag (re-entry carry filters it by token)',
  CARD_IDS.every((id) => AMENITY_BAG_QUESTION_IDS.has(id)) && AMENITY_BAG_QUESTION_IDS.has('apartments') && AMENITY_BAG_QUESTION_IDS.has('shops'));
check('a card is certified only when it has a chip (cohortAllows ⇔ cardKeys non-empty)',
  CARD_IDS.every((id) => cohortAllows(Q({ deal: 'Rent', types: ['Apartment'] }), id) === aptAnnual.some((c) => c.id === id)));
check('the ask order is the owner\'s numbering: installments → bathrooms → age → … → comfort → space → … → fun',
  groupAskTier('rnpl') > groupAskTier('bathrooms') && groupAskTier('bathrooms') > groupAskTier('property_age')
  && groupAskTier('property_age') > groupAskTier('comfort') && groupAskTier('comfort') > groupAskTier('space')
  && groupAskTier('space') > groupAskTier('safety') && groupAskTier('build') > groupAskTier('fun') && groupAskTier('nothing') === 0);
check('every chip in every list is a lower_snake token (a p_amenities slug)', Object.values(COHORT_CARDS).every((deals) =>
  Object.values(deals).every((cards) => Object.values(cards!).every((keys) => keys!.every((k) => /^[a-z_0-9]+$/.test(k))))));

console.log('\n§4 mutation proofs\n');
// A mutant is the REAL afCohorts.ts with one line broken, written to a TEMP dir (never into src/, which is shared
// by concurrent sessions — AGENTS.md) with its two relative imports pointed back at the real modules.
const SRC_PATH = join(ROOT, 'src/lib/afCohorts.ts');
const SRC = readFileSync(SRC_PATH, 'utf8');
const abs = (rel: string) => JSON.stringify(pathToFileURL(join(ROOT, 'src/lib', rel)).href);
async function mutant(...edits: Array<[from: string, to: string]>): Promise<typeof cardPlan> {
  let src = SRC;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 70)}`);
    src = src.replace(from, to);
  }
  src = src.replace("from '../data/propertyTypes.ts'", `from ${abs('../data/propertyTypes.ts')}`)
    .replace("from './searchDefaults.ts'", `from ${abs('./searchDefaults.ts')}`);
  const f = join(mkdtempSync(join(tmpdir(), 'af-cards-')), 'afCohorts.ts');
  writeFileSync(f, src);
  return ((await import(`${pathToFileURL(f).href}?m=${Math.random()}`)) as { cardPlan: typeof cardPlan }).cardPlan;
}
const union = await mutant(["    .map((id) => ({ id, keys: (primary[id] ?? []).filter((k) => unions.every((u) => u!.has(k))) }))",
  "    .map((id) => ({ id, keys: [...(primary[id] ?? [])] }))"]);
mustCatch('UNION instead of intersection (bills included offered on Apartment + Floor)', keysOf(union(Q({ deal: 'Rent', types: ['Apartment', 'Floor'] }))).has('bills_included'));
const noPool = await mutant(["  if (legs.length === 1) return kept;", "  return kept;"]);
mustCatch('a mixed scope that never pools its small cards (the owner\'s all-three-deals example breaks)', flat(noPool(three)) !== flat(cardPlan(three)));
// The real mutant: a leg with NO lists (Villa) is skipped by the intersection instead of certifying nothing — both the
// guard and the per-chip test must read null as «no constraint» for Villa + Apartment to inherit the apartment chips.
const anyLeg = await mutant(["  if (unions.some((u) => !u)) return [];", "  "],
  ["unions.every((u) => u!.has(k))", "unions.every((u) => !u || u.has(k))"]);
mustCatch('a leg with no lists certifying nothing is read as «no constraint» (Villa + Apartment would get apartment chips)',
  anyLeg(Q({ deal: 'Rent', types: ['Apartment', 'Villa'] })).length > 0);
const monthlyVeto = await mutant(["    .filter((deal) => !COHORT_CARDS[type] || COHORT_QUESTIONS[type]?.[deal])", "    .filter(() => true)"]);
mustCatch('Floor\'s empty short-stay leg vetoing its Rent ∩ Buy list', monthlyVeto(floorBoth).length === 0);
const wrongShort = await mutant(["  const types = shortStays ? ['Apartment'] : scopeCleanTypes(q);", "  const types = scopeCleanTypes(q);"]);
// On «Apartments & Co-living» the monthly-veto rule already skips Floor / Building, so the discriminating box is one
// whose members have NO cohort at all (Vacation & Rural: Chalet, Camp…) — the real plan is the one pool, the mutant nothing.
mustCatch('short stays on a group box intersecting its members instead of reading the one pool (Vacation & Rural → nothing)',
  wrongShort(Q({ deal: 'Rent', rentPeriod: 'monthly', typeGroups: ['Vacation & Rural'] })).length === 0
  && cardPlan(Q({ deal: 'Rent', rentPeriod: 'monthly', typeGroups: ['Vacation & Rural'] })).length === 3);

console.log(failed === 0 ? '\n✅ the Apartments & Co-living cards are the owner\'s lists, combined by intersection.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
