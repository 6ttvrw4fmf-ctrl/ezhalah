// THE FINAL PIN RULE (owner 2026-11-10): ONE PIN = ONE PLACE, THE SAME PROPERTY = ONE CARD THAT NAMES EVERY SITE.
//
//   · «Same property» needs PROOF — the same government licence, the same site's exact repost, or a whole property
//     (villa, land, building …) of the same type and size at the pin. Looking alike is never enough, and two flats in
//     one building are two flats.
//   · Nothing is hidden: a folded ad stays in the group, named under the lead card.
//   · A site's stand-in point for a whole district (ten or more different whole properties of several kinds on one
//     exact point) is not a place: those ads leave the pin and show under the district's «no exact location» marker.
//   · The same licence drawn a few metres apart by two agents is pulled onto one pin.
//
// The card fold is EXECUTED here (src/lib/mapPins.ts under plain Node), with mutations; the SQL half is read from the
// committed migration that production runs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { foldSameProperty, sameKindSummary, UNIT_TYPES_AR, type FoldFacts } from '../src/lib/mapPins.ts';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

type Card = FoldFacts & { id: number };
const c = (id: number, site: string, over: Partial<FoldFacts> = {}): Card => ({ id, site, dealAr: 'بيع', typeAr: 'شقة', area: 120, price: 500000, beds: 3, floor: 2, lic: null, ...over });
const fold = (cards: Card[]) => foldSameProperty(cards, (x) => x).map((g) => [g.main.id, ...g.others.map((o) => o.id)]);
const same = (a: number[][], b: number[][]) => JSON.stringify(a) === JSON.stringify(b);
const everyAdKept = (cards: Card[]) => { const out = fold(cards).flat().sort((a, b) => a - b); return same([out], [cards.map((x) => x.id).sort((a, b) => a - b)]); };

// 1. Units: only proof folds them.
check('two look-alike flats on two sites with no licence are two cards', same(fold([c(1, 'aqar'), c(2, 'wasalt')]), [[1], [2]]));
check('the same flat on a different floor of the same site is another unit', same(fold([c(1, 'aqar'), c(2, 'aqar', { floor: 3 })]), [[1], [2]]));
check('the same site\'s exact repost (deal, price, size, type, rooms, floor) is one card that keeps both ads', same(fold([c(1, 'aqar'), c(2, 'aqar')]), [[1, 2]]));
check('the same licence on two sites is one card, the cheapest leading', same(fold([c(1, 'wasalt', { lic: '7100238257', price: 1000000 }), c(2, 'aqar', { lic: '7100238257', price: 950000 })]), [[2, 1]]));
check('the same licence for sale and for rent stays two cards', same(fold([c(1, 'aqar', { lic: '7100238257' }), c(2, 'aqar', { lic: '7100238257', dealAr: 'إيجار', price: 40000 })]), [[1], [2]]));
check('a licence that is not a real number (too short, letters) proves nothing', same(fold([c(1, 'aqar', { lic: '123' }), c(2, 'wasalt', { lic: '123' }), c(3, 'aqar', { lic: 'N/A', floor: 5 }), c(4, 'wasalt', { lic: 'N/A', floor: 6 })]), [[1], [2], [3], [4]]));
check('two flats of one site alike in everything, floor unknown, are two flats (wasalt حي بدر, plots 475 and 476)', same(fold([c(1, 'wasalt', { floor: null }), c(2, 'wasalt', { floor: null })]), [[1], [2]]));
check('two units, each on two sites, each with its own licence → two cards of two ads (حي بدر, 7100238257 and 7100237453)', same(fold([c(1, 'wasalt', { lic: '7100238257', floor: null }), c(2, 'wasalt', { lic: '7100237453', floor: null }), c(3, 'dealapp', { lic: '7100238257', floor: null, beds: null }), c(4, 'dealapp', { lic: '7100237453', floor: null, beds: null })]), [[1, 3], [2, 4]]));
check('a site\'s exact repost with two different licences is two properties', same(fold([c(1, 'aqar', { lic: '7100000011' }), c(2, 'aqar', { lic: '7100000012' })]), [[1], [2]]));
check('twin villas of the same size with two different licences are two cards', same(fold([c(1, 'aqar', { typeAr: 'فيلا', area: 300, lic: '7100000021' }), c(2, 'wasalt', { typeAr: 'فيلا', area: 300, lic: '7100000022' })]), [[1], [2]]));
check('…and a third ad with no licence joins one of them, never bridges the two', (() => { const g = fold([c(1, 'aqar', { typeAr: 'فيلا', area: 300, lic: '7100000021' }), c(2, 'wasalt', { typeAr: 'فيلا', area: 300, lic: '7100000022' }), c(3, 'bayut', { typeAr: 'فيلا', area: 300 })]); return g.length === 2 && g.flat().length === 3; })());
// 2. Whole properties: same type + same size at the pin.
check('a villa of the same size on two sites is one card', same(fold([c(1, 'aqar', { typeAr: 'فيلا', area: 300, price: 2000000 }), c(2, 'wasalt', { typeAr: 'فيلا', area: 300, price: 1900000 })]), [[2, 1]]));
check('a villa of another size is another property', same(fold([c(1, 'aqar', { typeAr: 'فيلا', area: 300 }), c(2, 'wasalt', { typeAr: 'فيلا', area: 312 })]), [[1], [2]]));
check('a villa for sale and the same villa for rent stay two cards', same(fold([c(1, 'aqar', { typeAr: 'فيلا', area: 300 }), c(2, 'aqar', { typeAr: 'فيلا', area: 300, dealAr: 'إيجار', price: 90000 })]), [[1], [2]]));
check('every unit type is treated as a unit (never folded by look alone)', UNIT_TYPES_AR.every((ty) => same(fold([c(1, 'aqar', { typeAr: ty }), c(2, 'wasalt', { typeAr: ty })]), [[1], [2]])));
// 3. Unknown is not «the same», and nothing is dropped.
check('cards with no facts (the index read failed) are never grouped', same(fold([{ id: 1, site: '' }, { id: 2, site: '' }]), [[1], [2]]));
check('a size of 0 or a missing price is not a match', same(fold([c(1, 'aqar', { typeAr: 'أرض', area: 0 }), c(2, 'wasalt', { typeAr: 'أرض', area: 0 }), c(3, 'aqar', { price: null }), c(4, 'aqar', { price: null })]), [[1], [2], [3], [4]]));
const mixed = [c(1, 'aqar'), c(2, 'aqar'), c(3, 'wasalt', { lic: '7100000001' }), c(4, 'dealapp', { lic: '7100000001', price: 400000 }), c(5, 'aqar', { typeAr: 'فيلا', area: 300 }), c(6, 'bayut', { typeAr: 'فيلا', area: 300 }), c(7, 'aqar', { floor: 9 })];
check('a mixed pin keeps EVERY ad on screen exactly once', everyAdKept(mixed) && fold(mixed).length === 4);
check('proof chains: A=B by licence and B=C by exact repost is one property of three ads', same(fold([c(1, 'aqar', { lic: '7100000002' }), c(2, 'wasalt', { lic: '7100000002', price: 480000, floor: 7 }), c(3, 'wasalt', { price: 480000, floor: 7 })]), [[2, 3, 1]]));
check('groups stay in the order the pin listed them', same(fold([c(1, 'aqar', { floor: 1 }), c(2, 'aqar', { floor: 2 }), c(3, 'aqar', { floor: 1 })]), [[1, 3], [2]]));

// Mutations: each wrong fold, written out, must give a different answer from the real one on the cases above.
const loose = (cards: Card[], keyOf: (x: Card) => string) => { const m = new Map<string, number[]>(); for (const x of cards) { const k = keyOf(x); m.set(k, [...(m.get(k) ?? []), x.id]); } return [...m.values()]; };
mustCatch('a fold by looks alone (type + size + price, any site)', !same(loose([c(1, 'aqar'), c(2, 'wasalt')], (x) => `${x.typeAr}|${x.area}|${x.price}`), fold([c(1, 'aqar'), c(2, 'wasalt')])));
mustCatch('a fold that reads an unknown floor as the same floor', !same(loose([c(1, 'wasalt', { floor: null }), c(2, 'wasalt', { floor: null })], (x) => `${x.site}|${x.typeAr}|${x.area}|${x.price}|${x.beds}|${x.floor}`), fold([c(1, 'wasalt', { floor: null }), c(2, 'wasalt', { floor: null })])));
mustCatch('a fold that forgets the floor', !same(loose([c(1, 'aqar'), c(2, 'aqar', { floor: 3 })], (x) => `${x.site}|${x.typeAr}|${x.area}|${x.price}|${x.beds}`), fold([c(1, 'aqar'), c(2, 'aqar', { floor: 3 })])));
mustCatch('a fold that drops the copies (one id per group)', !everyAdKept(mixed) || fold(mixed).map((g) => [g[0]]).flat().length !== mixed.length);

// 4. The building's title.
const f = (over: Partial<FoldFacts & { showsPrice: boolean }> = {}) => ({ site: 'aqar', dealAr: 'إيجار', typeAr: 'شقة', price: 40000, showsPrice: true, ...over });
check('twelve flats for rent title the sheet with the lowest price', JSON.stringify(sameKindSummary(3, [f({ price: 52000 }), f(), f({ price: 45000 })])) === JSON.stringify({ typeAr: 'شقة', dealAr: 'إيجار', from: 40000 }));
check('a mixed pin (two types, or two deals) keeps the plain count', sameKindSummary(2, [f(), f({ typeAr: 'فيلا' })]) === null && sameKindSummary(2, [f(), f({ dealAr: 'بيع' })]) === null);
check('a pin whose ads are not all loaded keeps the plain count', sameKindSummary(5, [f(), f()]) === null);
check('one ad that shows no price (a stay-length site) → the title carries no price at all', sameKindSummary(2, [f(), f({ showsPrice: false })])?.from === null);
check('a single ad and an unknown type get no building title', sameKindSummary(1, [f()]) === null && sameKindSummary(2, [f({ typeAr: 'غير معروف' }), f({ typeAr: 'غير معروف' })]) === null);

// 5. The sheet renders the groups and every folded ad as a link; the cards carry the index's own facts.
const sheet = readFileSync(join(root, 'src/components/MapPinSheet.tsx'), 'utf8');
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');
check('the sheet renders one card per group and a link for every other ad of it', /const groups = cards \? foldSameProperty\(cards, factsOf\) : \[\]/.test(sheet) && /\{groups\.map\(/.test(sheet) && /groups\.length > 1 \? `\$\{groups\.length\} `/.test(sheet) && /testID="map-pin-sheet-also-chip"/.test(sheet) && /onPress=\{\(\) => \{ void openListing\(o\); \}\}/.test(sheet));
check('a folded ad\'s price goes through listingPrice() (stay-length sites print none)', /\[siteOf\(o\), listingPrice\(o, locale\)\]/.test(sheet));
check('a card without index facts has no site to match on', /site: l\.fold \? l\.source : ''/.test(sheet));
check('the cards read the licence, deal, type, size, price and floor from the index', /license_number,deal_ar,type_ar,area_m2,price_total,price_annual,floor_number/.test(remote) && /r\.fold = foldById\.get\(Number\(r\.id\)\);/.test(remote));

// 6. The SQL half: the committed migration production runs.
const dir = join(root, 'supabase/migrations');
const file = readdirSync(dir).filter((x) => /map_final_pin_rule/.test(x)).sort().pop();
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
check('the final-pin-rule migration is committed', !!file);
const strayRule = (q: string) => /having count\(distinct \(type_ar, area_m2\)\) >= 10\s+and \(count\(distinct split_part\(type_ar, ' ', 1\)\) >= 3\s+or \(count\(distinct split_part\(type_ar, ' ', 1\)\) >= 2 and count\(distinct deal_ar\) >= 2\)\)/.test(q) && /group by platform, la, lo/.test(q) && /from a where whole/.test(q);
check('a stray point = one site, one exact point, ten or more different whole properties of several kinds', strayRule(sql));
mustCatch('a stray rule that sweeps real one-kind projects (the kinds test removed)', !strayRule(sql.replace(/\s+and \(count\(distinct split_part\(type_ar, ' ', 1\)\) >= 3[\s\S]*?>= 2\)\)/, '')));
mustCatch('a stray rule that counts flats in a tower (the whole-property test removed)', !strayRule(sql.replace('from a where whole', 'from a')));
check('the SQL\'s unit list is the card fold\'s unit list', UNIT_TYPES_AR.every((ty) => sql.includes(`'${ty}'`)) && (sql.match(/s\.type_ar <> all \(array\[([^\]]+)\]\)/)?.[1].split(',').length ?? 0) === UNIT_TYPES_AR.length);
check('a rule that suddenly flags thousands keeps the previous set (ceiling 5,000)', /if v_new > 5000 then\s+raise exception/.test(sql));
check('stray ads leave the pin layer — their own pins and pins borrowed from them', /NOT EXISTS \(SELECT 1 FROM map_stray_pin st WHERE st\.source_table = s\.source_table AND st\.listing_id = s\.listing_id\)/.test(sql) && /NOT EXISTS \(SELECT 1 FROM map_stray_pin st WHERE st\.source_table = b\.donor_table AND st\.listing_id = b\.donor_id\)/.test(sql));
check('…and show under the district marker instead (never dropped from the map)', /where \(exists \(select 1 from public\.map_stray_pin st where st\.source_table = s\.source_table and st\.listing_id = s\.listing_id\)/.test(sql));
check('the hourly map refresh rebuilds the stray set, so new listings follow the rule', /perform public\.map_stray_pin_refresh_ar\(\);/.test(sql) && /map_grid_refresh_ar/.test(sql));
const licPass = (q: string) => /x\.license_number ~ '\^\[0-9\]\{6,\}\$' and x\.city_id is not null and x\.deal_ar is not null/.test(q) && /having count\(\*\) between 2 and 40 and count\(distinct \(ela, elo\)\) > 1\s+and max\(la\) - min\(la\) <= 0\.0015 and max\(lo\) - min\(lo\) <= 0\.0015/.test(q);
check('the same licence a few metres apart shares one pin (same city and deal, 2–40 ads, within ~150 m)', licPass(sql));
mustCatch('licence twins pulled together from across a city (the distance limit removed)', !licPass(sql.replace(/\s+and max\(la\) - min\(la\) <= 0\.0015 and max\(lo\) - min\(lo\) <= 0\.0015/, '')));
mustCatch('a licence pass that accepts any text as a licence', !licPass(sql.replace("x.license_number ~ '^[0-9]{6,}$'", 'x.license_number is not null')));

console.log(`\nverify-map-same-property-is-one-card: ${failed ? `${failed} FAILED` : 'the same property is one card that names every site; stray points sit under their district'}`);
process.exit(failed ? 1 : 0);
