// THE COUNTRYSIDE, LAND AND COMMERCIAL GROUPS ARE THE OWNER'S LOCKED LISTS (handoff 2026-11-01, built 2026-11-02;
// docs/ops/ADVANCED_FILTER_COUNTRYSIDE_GROUP.md). This EXECUTES scopeLegs() / cardPlan() / cohortAllows() /
// streetWidthRungs() from src/lib/afCohorts.ts against the owner's worked examples — never a regex over the file — and
// proves each guard with a mutant copy of the module that must FAIL it. The owner's two hard rules ride on top:
// a GROUP box with no type opens the group's OWN lists, and COMMERCIAL IS NEVER COMBINED WITH RESIDENTIAL.
//   node --experimental-strip-types scripts/verify-af-remaining-groups-cards.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import * as real from '../src/lib/afCohorts.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

type Mod = typeof real;
const base = { location: 'الرياض', type: null, detail: null, priceInput: '', priceBand: null, types: null, typeGroups: [], amenities: null } as unknown as SearchQuery;
const Q = (q: Partial<SearchQuery>): SearchQuery => ({ ...base, ...q } as SearchQuery);
const flat = (m: Mod, q: SearchQuery) => m.cardPlan(q).map((c) => `${c.id}:${c.keys.join(',')}`).join(' | ');
const ASKED = ['rnpl', 'bathrooms', 'property_age', 'direction', 'street_width', 'who', 'rating', 'unit_subtype', 'furnished', 'amenities'];
const asks = (m: Mod, q: SearchQuery) => ASKED.filter((id) => m.cohortAllows(q, id)).join(',');
const legs = (m: Mod, q: SearchQuery) => m.scopeLegs(q).map((l) => l.key).join(';');

const R = (q: Partial<SearchQuery>) => Q({ category: 'Residential', typeGroups: ['Vacation & Rural'], ...q } as Partial<SearchQuery>);
const C = (group: string, q: Partial<SearchQuery>) => Q({ category: 'Commercial', typeGroups: [group], ...q } as Partial<SearchQuery>);
const ruralShort = R({ deal: 'Rent', rentPeriod: 'monthly' });
const ruralAnnual = R({ deal: 'Rent' });
const ruralBuy = R({ deal: 'Buy' });
const chaletShort = R({ types: ['Chalet'], deal: 'Rent', rentPeriod: 'monthly' });
const campShort = R({ types: ['Camp'], deal: 'Rent', rentPeriod: 'monthly' });
const farmBuy = R({ types: ['Farm'], deal: 'Buy' });
const landBuy = Q({ category: 'Residential', typeGroups: ['Residential Plots'], types: ['Residential Land'], deal: 'Buy' });
const officeRent = C('Retail & Workspace', { types: ['Office'], deal: 'Rent' });
const shopOfficeRent = C('Retail & Workspace', { types: ['Shop', 'Office'], deal: 'Rent' });
const retailBoxRent = C('Retail & Workspace', { deal: 'Rent' });
const industrialBoxRent = C('Industrial & Logistics', { deal: 'Rent' });
const hotelBuy = C('Commercial Buildings & Facilities', { types: ['Hotel'], deal: 'Buy' });
const plotsBoxBuy = C('Commercial & Industrial Plots', { deal: 'Buy' });
const commercialLandBuy = C('Commercial & Industrial Plots', { types: ['Commercial Land'], deal: 'Buy' });
const cross = Q({ category: 'Residential', typeGroups: ['Villas & Houses', 'Retail & Workspace'], types: ['Villa', 'Shop'], deal: 'Buy' });

console.log('\n§1 the group box with NO type opens the group\'s own lists (owner 2026-11-01)\n');
check('«الاستراحات والريف» short stays: bathrooms, then 🏊 water · 🎮 games · 🌳 outdoors · 🔑 comfort — the box\'s own list, one leg',
  legs(real, ruralShort) === 'Vacation & Rural×RentMonthly' && asks(real, ruralShort) === 'bathrooms,rating,unit_subtype,amenities'
  && flat(real, ruralShort) === 'comfort:majlis,kitchen,wifi,self_checkin,parking,private_entrance,women_section,two_sections | outdoors:grill,fire_pit,bait_shaar,mandi_pit,garden,outdoor_seating,tent,dunes_view | water:pool,heated_pool,kids_pool,water_slide,jacuzzi_sauna,sea_view | games:football_pitch,sports_court,billiards,playstation,inflatable_games,smart_tv,sound_system',
  `${legs(real, ruralShort)} / ${asks(real, ruralShort)} / ${flat(real, ruralShort)}`);
check('…annual rent: installments → bathrooms → 🏠 space · 🌳 outdoors',
  asks(real, ruralAnnual) === 'rnpl,bathrooms,amenities'
  && flat(real, ruralAnnual) === 'space:majlis,women_section,two_sections,bait_shaar,kitchen,events_hall | outdoors:pool,jacuzzi,garden,grill,football_pitch,kids_play_area,fire_pit', flat(real, ruralAnnual));
check('…buy: street width → 💧 water & land · ✨ fun · 📄 land & papers',
  asks(real, ruralBuy) === 'street_width,amenities'
  && flat(real, ruralBuy) === 'fun:pool,jacuzzi,majlis,bait_shaar,garden,football_pitch,grill,kids_play_area,events_hall | water_land:well,water_tank,electricity,sanitation,fence,irrigation,palm_fruit_trees,animal_pens | land_papers:electronic_deed,warranty,corner_plot', flat(real, ruralBuy));
check('Retail & Workspace box · rent: payment → street width → 📍 location · 🏢 space · ⚙️ services · 📄 business',
  asks(real, retailBoxRent) === 'rnpl,street_width,amenities'
  && flat(real, retailBoxRent) === 'location:main_road,frontage,corner_plot,in_mall,in_tower | cspace:mezzanine,storage,own_bathroom,pantry,glass_front,furnished | cservices:parking,elevator,ac,internet,separate_electricity_meter,cameras,civil_defense | business:license,restaurant_cafe,takeover,first_tenant', flat(real, retailBoxRent));
check('Industrial & Logistics box (= the Warehouse lists) · rent: 🏗️ building · 🚛 trucks & loading · services · 📍 location & papers',
  flat(real, industrialBoxRent) === 'cservices:office_inside,own_bathroom,workers_housing,electricity,heavy_power,civil_defense,cameras | building:high_ceiling,hangar,insulated_panel,cold_storage,ac,mezzanine,concrete_floor | trucks:yard,loading_dock,big_gate,truck_access,crane,racks | loc_papers:industrial_area,main_road,corner_plot,license,first_tenant', flat(real, industrialBoxRent));
check('Commercial & Industrial Plots box · buy: facing + street width → 📐 plot · ⚡ services · 📄 papers & deal (🚧 no services is a plot chip)',
  asks(real, plotsBoxBuy) === 'direction,street_width,amenities'
  && flat(real, plotsBoxBuy) === 'services:all_services,electricity,sanitation,asphalt | plot:corner_plot,three_streets,main_road,ready_to_build,no_services | deal_papers:electronic_deed,approved_plan,direct_owner,building_rules,earning_income,inside_project', flat(real, plotsBoxBuy));

console.log('\n§2 a picked type opens its own list\n');
check('Chalet short stays adds 👥 who (families · youth · events · newlyweds) and the privacy chip',
  asks(real, chaletShort) === 'bathrooms,who,rating,unit_subtype,amenities'
  && flat(real, chaletShort).includes('who:for_families,for_youth,for_events,for_newlyweds') && flat(real, chaletShort).includes('privacy_screen'), flat(real, chaletShort));
check('Camp short stays: 🔥 camp life · ✨ fun (quad bikes, camels & horses) · comfort (toilets, lighting); no water card',
  flat(real, campShort) === 'comfort:kitchen,toilets_on_site,majlis,two_sections,privacy_screen,ac,lighting | who:for_families,for_youth,for_events | fun:quad_bikes,camels_horses,football_pitch,kids_play_area,smart_tv,sound_system | camp_life:bait_shaar,tent,outdoor_seating,fire_pit,mandi_pit,grill,dunes_view', flat(real, campShort));
check('Farm buy: street width → 💧 water & power · 🌴 crops · 🐑 animals · 🏡 buildings · 📄 land & papers; no installments, no bathrooms',
  asks(real, farmBuy) === 'street_width,amenities'
  && flat(real, farmBuy) === 'land_papers:fence,main_road,electronic_deed | power:well,artesian_well,water_tank,irrigation,electricity,solar_power | crops:palms,fruit_trees,fodder_crops,greenhouses,producing_farm | animals:animal_pens,poultry,horses_stable,camels | buildings:farm_house,farm_rest_house,majlis,pool,workers_housing,storage,bait_shaar', flat(real, farmBuy));
check('Residential land buy: facing + street width → 📐 plot · ⚡ services (🚧 no services yet) · 📄 papers & deal',
  asks(real, landBuy) === 'direction,street_width,amenities'
  && flat(real, landBuy) === 'services:all_services,electricity,water_supply,sanitation,asphalt,street_lights,no_services | plot:corner_plot,three_streets,ready_to_build,raised_plot,residential_commercial,main_road | deal_papers:electronic_deed,approved_plan,direct_owner,inside_project,floors_allowed,grant_land', flat(real, landBuy));
check('Office rent: payment → 🏢 office kind · 🛋️ ready to work · ⚙️ building · 📍 location · 📄 business',
  asks(real, officeRent) === 'rnpl,amenities'
  && flat(real, officeRent) === 'location:main_road,frontage,corner_plot | business:license,first_tenant,civil_defense | office_kind:private_office,coworking,in_tower,in_mall | ready:furnished,meeting_room,reception,pantry,own_bathroom,storage | building:parking,elevator,ac,central_ac,internet,guard,cameras', flat(real, officeRent));
check('Hotel buy: 🛎️ hotel (stars, rooms & suites, restaurant, pool & gym, elevator, parking) · 💰 deal',
  flat(real, hotelBuy) === 'hotel:stars_mentioned,rooms_suites,restaurant_cafe,pool_gym,elevator,parking | deal_loc:earning_income,license', flat(real, hotelBuy));

console.log('\n§3 mixing inside a category intersects; commercial never mixes with residential\n');
check('Shop + Office rent = the chips BOTH lists carry (intersection, never union), pooled into three cards',
  flat(real, shopOfficeRent) === 'location:main_road,frontage,corner_plot,in_mall,in_tower | cservices:parking,ac,civil_defense,cameras | cspace:own_bathroom,storage,pantry,license,first_tenant', flat(real, shopOfficeRent));
check('Villa + Shop (a residential and a commercial type) certifies NOTHING: no legs, no cards, no question',
  legs(real, cross) === '' && flat(real, cross) === '' && asks(real, cross) === '' && !real.cohortAllows(cross, 'street_width'));
check('…and the same with the category flipped', (() => { const c2 = { ...cross, category: 'Commercial' } as SearchQuery; return legs(real, c2) === '' && asks(real, c2) === ''; })());

console.log('\n§4 street width offers each scope\'s own rungs (counts cnt_stw10…60 since 20261102101415)\n');
check('plots box 15/20/30/40/60 · retail 15/20/30/40 · countryside 15/20/30 · Residential land and Hotel keep 15/20/25/30',
  real.streetWidthRungs(plotsBoxBuy).join() === '15,20,30,40,60' && real.streetWidthRungs(commercialLandBuy).join() === '15,20,30,40,60'
  && real.streetWidthRungs(retailBoxRent).join() === '15,20,30,40' && real.streetWidthRungs(officeRent).join() === '15,20,30,40'
  && real.streetWidthRungs(ruralBuy).join() === '15,20,30' && real.streetWidthRungs(farmBuy).join() === '15,20,30'
  && real.streetWidthRungs(landBuy).join() === '15,20,25,30' && real.streetWidthRungs(hotelBuy).join() === '15,20,25,30');
check('a mixed scope offers the rungs EVERY leg offers (Shop + Warehouse → 15/20/30)',
  real.streetWidthRungs(C('Retail & Workspace', { types: ['Shop', 'Warehouse'], deal: 'Rent' })).join() === '15,20,30');

console.log('\n§4c commercial lists ask in the owner\'s order\n');
{
  const office = real.groupAskTierFor(officeRent);
  check('Office rent: office kind → ready to work → building → location → business',
    office('office_kind') > office('ready') && office('ready') > office('building') && office('building') > office('location') && office('location') > office('business'));
  const boxBuy = C('Commercial Buildings & Facilities', { deal: 'Buy' });
  const box = real.groupAskTierFor(boxBuy);
  check('Buildings & Facilities box buy: what\'s inside → investment → location', box('inside') > box('investment') && box('investment') > box('location'));
  const retail = real.groupAskTierFor(retailBoxRent);
  check('…while the retail box keeps location → space → services → business',
    retail('location') > retail('cspace') && retail('cspace') > retail('cservices') && retail('cservices') > retail('business'));
}

console.log('\n§5 mutation proofs\n');
const SRC = readFileSync(join(ROOT, 'src/lib/afCohorts.ts'), 'utf8');
const abs = (rel: string) => JSON.stringify(pathToFileURL(join(ROOT, 'src/lib', rel)).href);
async function mutant(...edits: Array<[from: string, to: string]>): Promise<Mod> {
  let src = SRC;
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from.slice(0, 70)}`);
    src = src.replace(from, to);
  }
  src = src.replace("from '../data/propertyTypes.ts'", `from ${abs('../data/propertyTypes.ts')}`)
    .replace("from './searchDefaults.ts'", `from ${abs('./searchDefaults.ts')}`);
  const f = join(mkdtempSync(join(tmpdir(), 'af-groups-')), 'afCohorts.ts');
  writeFileSync(f, src);
  return (await import(`${pathToFileURL(f).href}?m=${Math.random()}`)) as Mod;
}
const noBox = await mutant(["  return groups.length === 1 && GROUP_LISTS[groups[0]] ? groups[0] : null;", "  return null;"]);
mustCatch('the group box reading its types\' lists instead of its OWN list', flat(noBox, ruralShort) !== flat(real, ruralShort) || legs(noBox, ruralShort) !== legs(real, ruralShort));
const union = await mutant(["    .map((id) => ({ id, keys: (primary[id] ?? []).filter((k) => unions.every((u) => u!.has(k))) }))",
  "    .map((id) => ({ id, keys: [...(primary[id] ?? [])] }))"]);
mustCatch('Shop + Office UNION instead of intersection', flat(union, shopOfficeRent) !== flat(real, shopOfficeRent));
const crossOk = await mutant(["  if (types.some((ty) => !q.category || !offeredUnder(q.category, ty))) return [];", "  "]);
mustCatch('a residential + commercial scope getting legs', legs(crossOk, cross) !== '');
const flatLadder = await mutant(["  const ladders = types.map((t) => STREET_WIDTH_LADDERS[t] ?? STREET_WIDTH_DEFAULT_RUNGS);", "  const ladders = types.map(() => STREET_WIDTH_DEFAULT_RUNGS);"]);
mustCatch('every type offered the default street-width ladder (commercial land loses 40/60)', flatLadder.streetWidthRungs(commercialLandBuy).join() !== '15,20,30,40,60');
const noType = await mutant(["cards: COHORT_CARDS[type]?.[deal], questions:", "cards: GROUP_LISTS['Vacation & Rural']?.cards?.[deal] ?? COHORT_CARDS[type]?.[deal], questions:"]);
mustCatch('a picked type answering with the group box\'s cards (Chalet would lose its 👥 who card)', flat(noType, chaletShort) !== flat(real, chaletShort));

console.log(failed === 0 ? '\n✅ the countryside, land and commercial lists are the owner\'s; boxes open their own lists; commercial never mixes with residential.\n' : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
