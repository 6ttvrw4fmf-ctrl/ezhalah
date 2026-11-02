// THE VILLAS & HOUSES CARDS ARE THE OWNER'S APPROVED GROUP LISTS, SHARED BY VILLA AND DUPLEX (owner 2026-11-02,
// docs/ops/ADVANCED_FILTER_VILLAS_GROUP.md). This EXECUTES cardPlan() / cohortAllows() / groupAskTier() from
// src/lib/afCohorts.ts against the owner's lists — never a regex over the file — and proves each guard with a mutant
// copy of the module that must FAIL it.
//   node --experimental-strip-types scripts/verify-af-villas-group-cards.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { cardPlan, cohortAllows, certifiedAmenityKeys, COHORT_CARDS, COHORT_QUESTIONS, groupAskTier } from '../src/lib/afCohorts.ts';
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
const asks = (q: SearchQuery) => ['rnpl', 'property_age', 'bathrooms', 'street_width', 'direction', 'comfort', 'space', 'extras', 'safety', 'build', 'furnished']
  .filter((id) => cohortAllows(q, id));

// The owner's lists, verbatim (2026-11-02). Edit here only with a new owner decision.
const BUY = 'comfort:kitchen,majlis,dining_majlis,maid_room,driver_room,elevator,car_entrance'
  + ' | space:roof,laundry_room,annex,yard,storage,two_entrances,pool'
  + ' | build:separate_meters,warranty,sanitation,insulation,grill,garden,basement';
const RENT = 'comfort:kitchen,ac,majlis,maid_room,car_entrance,furnished,parking'
  + ' | space:roof,dining_majlis,laundry_room,yard,storage,driver_room,annex'
  + ' | safety:separate_meters,guard,cameras,smart_entry,kids_play_area,gym,own_bathroom'
  + ' | extras:pool,garden,grill,balcony,garage,optical_fibers,elevator';

console.log('\n§1 single legs are the owner\'s lists, verbatim\n');
const villaBuy = Q({ deal: 'Buy', types: ['Villa'] });
const villaRent = Q({ deal: 'Rent', types: ['Villa'] });
check('Buy → Villa: 🔑 comfort · 🏠 space · 🧱 build, 7 chips each, in the owner\'s order', flat(cardPlan(villaBuy)) === BUY, flat(cardPlan(villaBuy)));
check('Annual rent → Villa: 🔑 comfort · 🏠 space · 🏡 extras · 🛡️ safety (CARD_IDS order; the ask order is below)', flat(cardPlan(villaRent)) === RENT, flat(cardPlan(villaRent)));
check('Buy → Villa asks age, bathrooms, street width, direction and the three cards; no installments, no furnished question',
  asks(villaBuy).join() === 'property_age,bathrooms,street_width,direction,comfort,space,build', asks(villaBuy).join());
check('Annual rent → Villa asks installments, bathrooms, age and the four cards; «furnished» stays certified for the typed sentence',
  asks(villaRent).join() === 'rnpl,property_age,bathrooms,comfort,space,extras,safety,furnished', asks(villaRent).join());
check('Duplex shares the villa lists on both deals (owner 2026-11-02)',
  COHORT_CARDS.Duplex === COHORT_CARDS.Villa && flat(cardPlan(Q({ deal: 'Buy', types: ['Duplex'] }))) === BUY
  && flat(cardPlan(Q({ deal: 'Rent', types: ['Duplex'] }))) === RENT
  && JSON.stringify(COHORT_QUESTIONS.Duplex?.Buy) === JSON.stringify(COHORT_QUESTIONS.Villa?.Buy)
  && JSON.stringify(COHORT_QUESTIONS.Duplex?.RentAnnual) === JSON.stringify(COHORT_QUESTIONS.Villa?.RentAnnual));

console.log('\n§2 the GROUP box with no type picked opens the full villa interview\n');
const groupBuy = Q({ deal: 'Buy', typeGroups: ['Villas & Houses'] });
const groupRent = Q({ deal: 'Rent', typeGroups: ['Villas & Houses'] });
check('«Villas & Houses» + Buy = Villa ∩ Duplex = the full Buy lists', flat(cardPlan(groupBuy)) === BUY && asks(groupBuy).join() === asks(villaBuy).join(), flat(cardPlan(groupBuy)));
check('«Villas & Houses» + annual rent = the full Rent lists', flat(cardPlan(groupRent)) === RENT && asks(groupRent).join() === asks(villaRent).join(), flat(cardPlan(groupRent)));

console.log('\n§3 ask order is the owner\'s\n');
const order = (q: SearchQuery) => asks(q).filter((id) => id !== 'furnished').sort((a, b) => groupAskTier(b, q) - groupAskTier(a, q)).join(' → ');
check('Buy: age → bathrooms → street width → direction → comfort → space → build',
  order(villaBuy) === 'property_age → bathrooms → street_width → direction → comfort → space → build', order(villaBuy));
check('Rent: installments → bathrooms → age → comfort → space → extras → safety',
  order(villaRent) === 'rnpl → bathrooms → property_age → comfort → space → extras → safety', order(villaRent));

console.log('\n§4 mixing keeps the intersection rule (never union)\n');
const mixBuy = cardPlan(Q({ deal: 'Buy', types: ['Villa', 'Apartment'] }));
const villaBuyKeys = new Set(cardPlan(villaBuy).flatMap((c) => c.keys));
const aptBuyKeys = new Set(cardPlan(Q({ deal: 'Buy', types: ['Apartment'] })).flatMap((c) => c.keys));
check('Villa + Apartment on Buy offers only chips BOTH lists carry, in the villa (primary) layout',
  mixBuy.length > 0 && mixBuy.flatMap((c) => c.keys).every((k) => villaBuyKeys.has(k) && aptBuyKeys.has(k)) && mixBuy[0].id === 'comfort', flat(mixBuy));
check('Villa + Apartment on Buy drops street width (Apartment never asks it)', !cohortAllows(Q({ deal: 'Buy', types: ['Villa', 'Apartment'] }), 'street_width'));
const combined = cardPlan(Q({ dealCombined: true, types: ['Villa'] }));
check('Villa with Buy + Rent together offers only chips in all three villa lists (buy, annual, short stays)',
  combined.flatMap((c) => c.keys).every((k) => villaBuyKeys.has(k) && new Set(cardPlan(villaRent).flatMap((c) => c.keys)).has(k)), flat(combined));
check('the typed chat sentence is held to the same vocabulary as the cards',
  certifiedAmenityKeys(villaBuy).sort().join() === [...villaBuyKeys].sort().join());
check('every villa chip has its count column name (cnt_<token>) — the same tokens the apartments group counts',
  [...villaBuyKeys, ...cardPlan(villaRent).flatMap((c) => c.keys)].every((k) => /^[a-z_]+$/.test(k)));

console.log('\n§5 mutation proofs\n');
// A mutant is the REAL afCohorts.ts with one line broken, written to a TEMP dir (never into src/, which is shared
// by concurrent sessions) and imported fresh. Each must change what the owner's examples return.
const SRC = readFileSync(join(ROOT, 'src/lib/afCohorts.ts'), 'utf8');
async function mutant(...edits: Array<[from: string, to: string]>): Promise<{ cardPlan: typeof cardPlan; cohortAllows: typeof cohortAllows }> {
  let src = SRC;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`mutant anchor not found: ${from}`);
    src = src.replace(from, to);
  }
  src = src.replace(/from '\.\/(\w+)\.ts'/g, (_m, m) => `from '${pathToFileURL(join(ROOT, 'src/lib', `${m}.ts`)).href}'`)
    .replace(/from '\.\.\/data\/(\w+)\.ts'/g, (_m, m) => `from '${pathToFileURL(join(ROOT, 'src/data', `${m}.ts`)).href}'`);
  const f = join(mkdtempSync(join(tmpdir(), 'af-villas-')), 'afCohorts.ts');
  writeFileSync(f, src);
  return (await import(`${pathToFileURL(f).href}?m=${Math.random()}`)) as { cardPlan: typeof cardPlan; cohortAllows: typeof cohortAllows };
}
const noDuplex = await mutant(['  Duplex: VILLA_CARDS,', '']);
mustCatch('Duplex losing the shared lists (the group box would intersect to nothing again)', noDuplex.cardPlan(groupBuy).length === 0);
const swapped = await mutant(["  comfort: ['kitchen', 'majlis', 'dining_majlis', 'maid_room', 'driver_room', 'elevator', 'car_entrance'],",
  "  comfort: ['kitchen', 'majlis', 'dining_majlis', 'maid_room', 'driver_room', 'elevator', 'parking'],"]);
mustCatch('a chip swapped on the Buy comfort card', flat(swapped.cardPlan(villaBuy)) !== BUY);
const rnplOnBuy = await mutant(["    Buy: ['property_age', 'bathrooms', 'street_width', 'direction', 'comfort', 'space', 'build', 'amenities'],\n    // Monthly 2026-08-18",
  "    Buy: ['rnpl', 'property_age', 'bathrooms', 'street_width', 'direction', 'comfort', 'space', 'build', 'amenities'],\n    // Monthly 2026-08-18"]);
mustCatch('installments creeping onto the villa Buy list (0 ads accept)', rnplOnBuy.cohortAllows(villaBuy, 'rnpl') === true);
const unionGate = await mutant(["    .map((id) => ({ id, keys: (primary[id] ?? []).filter((k) => unions.every((u) => u!.has(k))) }))",
  "    .map((id) => ({ id, keys: (primary[id] ?? []).filter((k) => unions.some((u) => u!.has(k))) }))"]);
mustCatch('the intersection becoming a union (Villa + Apartment would offer villa-only chips)',
  unionGate.cardPlan(Q({ deal: 'Buy', types: ['Villa', 'Apartment'] })).flatMap((c) => c.keys).some((k) => !aptBuyKeys.has(k)));
mustCatch('the §1 Buy string going blind to a reorder', flat(cardPlan(villaBuy)) !== BUY.replace('kitchen,majlis', 'majlis,kitchen'));

if (failed) { console.error(`\n❌ ${failed} check(s) FAILED — the villas group is not the owner's lists`); process.exit(1); }
console.log('\n✓ verify-af-villas-group-cards: Villa and Duplex carry the owner\'s approved lists, the group box opens them, mixing intersects');
