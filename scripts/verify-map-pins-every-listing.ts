// EVERY PROPERTY PIN ON THE MAP — the rules EXECUTED (owner 2026-11-02: «display all property pins … Buy, Rent, Short
// stays … one golden pin with the number when several listings share the exact same coordinates … always show the
// price as the head of the pin»). This runs src/lib/mapPins.ts under plain Node: the colour rule, the price head, the
// zoom→cell rule, the padded box, the RPC arguments and the failed-fetch answer, each with a mutation that must be
// caught. Then the wiring: the data module asks map_pins_ar through the bounded RPC, the map component draws from it,
// the deal button feeds it, and a committed migration creates the function.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinFilterOf, isNarrowed, EMPTY_MAP_FILTER, typeSelection, furnitureOffered } from '../src/lib/mapFilter.ts';
import { pinColor, dotColor, MIXED_DOT, pinHead, shortMoney, cellForSpan, fineCellForSpan, CELL_LADDER, PIN_LIMIT, PIN_SHOW_MAX, foldDuplicates, paddedBox, bubbleText, rpcArgs, pinsFrom, idsByTable, orderLike, polygonOf, PIN_COLOR, GOLD } from '../src/lib/mapPins.ts';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const one = (deal: 'buy' | 'rent' | 'short', price: number | null, platform = 'aqar') => ({ n: 1, deal, price, platform });

// Colours: the deal colour on a single listing, gold on a shared spot whatever the deal.
check('a single Buy pin is blue, Rent orange, Short stays teal', pinColor({ n: 1, deal: 'buy' }) === PIN_COLOR.buy && pinColor({ n: 1, deal: 'rent' }) === PIN_COLOR.rent && pinColor({ n: 1, deal: 'short' }) === PIN_COLOR.short);
check('a shared spot is GOLD even when every listing is Buy (gold beats the deal colour)', pinColor({ n: 3, deal: 'buy' }) === GOLD && pinColor({ n: 2, deal: 'short' }) === GOLD);
check('blue and orange are the colour-blind-safe pair (both present, distinct)', PIN_COLOR.buy !== PIN_COLOR.rent && /^#1/.test(PIN_COLOR.buy) && /^#D/.test(PIN_COLOR.rent));
mustCatch('a shared spot drawn in the deal colour', pinColor({ n: 5, deal: 'rent' }) !== PIN_COLOR.rent);

// The head: price for a priced sale, price/year for a rent, the count for a shared spot, no price for Short stays.
check('a sale head is the short price: 650,000 → «650 ألف», 1,250,000 → «1.3 مليون»', pinHead(one('buy', 650000), 'ar') === '650 ألف' && pinHead(one('buy', 1250000), 'ar') === '1.3 مليون');
check('a rent head says per year: 45,000 → «45 ألف/سنة» / «45K/yr»', pinHead(one('rent', 45000), 'ar') === '45 ألف/سنة' && pinHead(one('rent', 45000), 'en') === '45K/yr');
check('a shared spot head is its PRICE, never a count (owner 2026-11-10 final rule — verify-map-pin-shows-the-price-never-a-count.ts)', pinHead({ n: 3, deal: 'buy', price: 650000, price_max: 650000, unpriced: 0, platform: null }, 'ar') === '650 ألف' && pinHead({ n: 12, deal: 'buy', price: 650000, price_max: 900000, unpriced: 0, platform: null }, 'ar') === 'من 650 ألف' && pinHead({ n: 2, deal: 'buy', price: null, price_max: null, unpriced: 2, platform: null }, 'ar') === 'السعر عند الطلب');
check('a Short-stays head prints no figure (Gathern / Aqar Monthly rule), by deal AND by platform', pinHead(one('short', 3000, 'gathern'), 'ar') === 'إقامة قصيرة' && pinHead(one('rent', 3000, 'aqarmonthly'), 'ar') === 'إقامة قصيرة' && !/\d/.test(pinHead(one('short', 3000), 'en')));
check('an unpriced listing says price on request, never a blank head', pinHead(one('buy', null), 'ar') === 'السعر عند الطلب' && pinHead(one('buy', 0), 'en') === 'Price on request');
check('a price that arrives as a string (numeric over JSON) still formats', pinHead({ n: 1, deal: 'buy', price: '650000', platform: 'aqar' }, 'ar') === '650 ألف');
check('shortMoney keeps one decimal under 10 and none above (1.25M → 1.3M, 12.4K → 12K)', shortMoney(1250000, 'en') === '1.3M' && shortMoney(12400, 'en') === '12K' && shortMoney(950, 'en') === '950');
mustCatch('a Short-stays pin printing its stored price', !/3/.test(pinHead(one('short', 3000, 'gathern'), 'ar')));
mustCatch('a shared spot printing its count instead of its price', /إعلان/.test(`${4} إعلانات`) && !/إعلان/.test(pinHead({ n: 4, deal: 'buy', price: 650000, price_max: 650000, unpriced: 0, platform: 'aqar' }, 'ar')));

// Zoom → cell: exact points from city zoom inward, cells sized to ~7 rows wider out (measured live 2026-11-02: /30 drew
// hundreds of overlapping «1» bubbles over the country), never below 0.01°.
check('city zoom and closer asks for exact points (cell 0)', cellForSpan(0.12) === 0 && cellForSpan(0.03) === 0);
check('a region view asks for ~span/16 snapped DOWN to the ladder (dense dots); the country view (17°) → 0.6°; a floor of 0.01°', cellForSpan(0.7) === 0.04 && cellForSpan(17) === 0.6 && cellForSpan(0.14) === 0.01 && cellForSpan(0.121) === 0.01 && cellForSpan(100) === 2.4);
// THE LADDER IS THE CONTRACT WITH map_grid_ar: a cell size off the ladder would miss the precomputed grid and fall back
// to the 2.5 s live scan. Every grid request must land on a ladder value, and the ladder must match the migration.
check('every grid cell the client can ask for is on the ladder', [0.13, 0.5, 1, 3, 17, 40].every((d) => (CELL_LADDER as readonly number[]).includes(cellForSpan(d)) && (CELL_LADDER as readonly number[]).includes(fineCellForSpan(d))));
mustCatch('a cell size off the ladder (span/7 unsnapped: 17/7 = 2.43)', !(CELL_LADDER as readonly number[]).includes(17 / 7) && cellForSpan(17) !== 17 / 7);
check('the ladder in the migration is the ladder the client uses', (() => { const dir = join(root, 'supabase/migrations'); const f = readdirSync(dir).filter((x) => /map_grid_precomputed/.test(x)).sort().pop(); if (!f) return false; const sql = readFileSync(join(dir, f), 'utf8'); return sql.includes(`array[${CELL_LADDER.join(',')}]`); })());
mustCatch('exact points requested for the whole country (424k rows)', cellForSpan(17) > 0);
mustCatch('a country grid finer than 0.3° (thousands of dots would choke a phone)', cellForSpan(17) >= 0.3);
check('the padded box is a fifth wider on every side and clamped to the globe', (() => { const b = paddedBox({ latitude: 24.7, longitude: 46.7 }, { latitudeDelta: 1, longitudeDelta: 2 }); return Math.abs(b.n - 25.4) < 1e-9 && Math.abs(b.s - 24.0) < 1e-9 && Math.abs(b.e - 48.1) < 1e-9 && Math.abs(b.w - 45.3) < 1e-9 && paddedBox({ latitude: 89.9, longitude: 0 }, { latitudeDelta: 1, longitudeDelta: 1 }).n === 90; })());
check('bubble text shortens thousands', bubbleText(12400, 'ar') === '12 ألف' && bubbleText(840, 'en') === '840');

// RPC arguments: every unset filter is null (= not narrowed); all three deals = null (= all).
const args = rpcArgs({ s: 1, w: 2, n: 3, e: 4 }, 0, { deals: ['buy', 'rent', 'short'] });
check('all three deals send p_deals null; unset filters send null, not empty arrays', args.p_deals === null && args.p_types === null && args.p_beds === null && args.p_category === null && args.p_poly === null && args.p_price_min === null);
const args2 = rpcArgs({ s: 1, w: 2, n: 3, e: 4 }, 0.1, { deals: ['short'], types: ['شقة'], beds: [2, 3], areaMin: 100, priceMax: 500000, category: 'residential', poly: { type: 'Polygon', coordinates: [[[46, 24], [47, 24], [47, 25], [46, 24]]] } });
check('a narrowed filter passes every value through, the cell too', args2.p_deals?.length === 1 && args2.p_cell === 0.1 && args2.p_types?.[0] === 'شقة' && args2.p_beds?.length === 2 && args2.p_area_min === 100 && args2.p_price_max === 500000 && args2.p_category === 'residential' && args2.p_poly?.type === 'Polygon');
mustCatch('an empty types list sent as [] (which would match nothing)', rpcArgs({ s: 1, w: 2, n: 3, e: 4 }, 0, { deals: ['buy'], types: [] }).p_types === null);

// A FAILED FETCH IS NOT AN EMPTY ANSWER.
check('a failed RPC is «unknown», never an empty list', pinsFrom({ data: null, error: { message: 'x' } }) === 'unknown' && pinsFrom({ data: null, error: null }) === 'unknown');
check('a real empty answer is an empty list (known: nothing here)', Array.isArray(pinsFrom({ data: [], error: null })) && (pinsFrom({ data: [], error: null }) as unknown[]).length === 0);
mustCatch('a failed fetch read as no listings here', pinsFrom({ data: null, error: { message: 'timeout' } }) !== null && !Array.isArray(pinsFrom({ data: null, error: { message: 'timeout' } })));

// The tap sheet (Zillow-style): ids grouped by table in the RPC's order, cards put back in that order.
const sheetRow = { ids: [{ t: 'aqar_residential_listings', i: 9 }, { t: 'wasalt_residential_listings', i: 4 }, { t: 'aqar_residential_listings', i: 7 }, null as unknown as { t: string; i: number }] };
const grouped = idsByTable(sheetRow);
check('idsByTable groups by table, keeps order, skips a malformed entry', grouped.get('aqar_residential_listings')?.join(',') === '9,7' && grouped.get('wasalt_residential_listings')?.join(',') === '4' && grouped.size === 2);
const ordered = orderLike(sheetRow, [{ sourceTable: 'aqar_residential_listings', id: 7 }, { sourceTable: 'wasalt_residential_listings', id: 4 }, { sourceTable: 'aqar_residential_listings', id: 9 }, { sourceTable: 'x', id: 1 }]);
check('orderLike restores the RPC order (newest first) and parks an unnamed card last', ordered.map((c) => c.id).join(',') === '9,4,7,1');
mustCatch('a sheet that shows the cards in fetch order instead of the pin order', orderLike(sheetRow, [{ sourceTable: 'aqar_residential_listings', id: 7 }, { sourceTable: 'aqar_residential_listings', id: 9 }])[0].id === 9);

// Draw → Apply: the sketch becomes a closed GeoJSON polygon in [lng, lat]; fewer than three points is no area.
const polyOut = polygonOf([{ latitude: 24.7, longitude: 46.6 }, { latitude: 24.8, longitude: 46.6 }, { latitude: 24.8, longitude: 46.7 }]);
// MapKit hands the overlay's points back as RINGS ([[Coordinate, …]]); the outer ring is the boundary (measured live
// 2026-11-02: the drawn boundary applied to nothing because the nested list filtered down to nothing → null).
const ringOut = polygonOf([[{ latitude: 24.7, longitude: 46.6 }, { latitude: 24.8, longitude: 46.6 }, { latitude: 24.8, longitude: 46.7 }]]);
check('polygonOf accepts MapKit rings and reads the outer ring', JSON.stringify(ringOut) === JSON.stringify(polyOut));
mustCatch('a polygon builder that cannot read MapKit rings (the apply-to-nothing defect of 2026-11-02)', ringOut !== null);
check('the boundary count pill has its Arabic text', /'\{n\} listings inside the boundary': '\{n\} إعلان داخل الحدود'/.test(readFileSync(join(root, 'src/i18n.tsx'), 'utf8')));
check('polygonOf closes the ring and writes [lng, lat]', polyOut?.type === 'Polygon' && polyOut.coordinates[0].length === 4 && polyOut.coordinates[0][0][0] === 46.6 && polyOut.coordinates[0][0][1] === 24.7 && polyOut.coordinates[0][3][0] === 46.6);
check('polygonOf refuses a line (two points) and skips a bad point', polygonOf([{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }]) === null && polygonOf([{ latitude: NaN, longitude: 1 }, { latitude: 1, longitude: 1 }, { latitude: 2, longitude: 1 }, { latitude: 2, longitude: 2 }])?.coordinates[0].length === 4);
mustCatch('a polygon written [lat, lng] (would land in the Indian Ocean)', polyOut?.coordinates[0][0][0] !== 24.7);

// The filter popup's state → the pin query (executed): groups become the index's Arabic type labels, 5+ beds a
// range, blank fields null; an empty state narrows nothing.
const typeAr = (groups: string[]) => (groups.includes('Villas & Houses') ? ['فيلا', 'دوبلكس'] : null);
const pf = pinFilterOf({ ...EMPTY_MAP_FILTER, category: 'Residential', groups: ['Villas & Houses'], beds: ['2', '5+'], areaMin: '250', priceMax: '1,500,000' }, typeAr);
check('pinFilterOf maps category, group → type_ar labels, beds (5+ = 5…12), area and price', pf.category === 'residential' && (pf.types ?? []).includes('فيلا') && (pf.types ?? []).includes('دوبلكس') && pf.beds?.[0] === 2 && pf.beds?.includes(12) === true && pf.areaMin === 250 && pf.areaMax === null && pf.priceMax === 1500000);
check('an empty filter narrows nothing and is not «on»', Object.values(pinFilterOf(EMPTY_MAP_FILTER, typeAr)).every((v) => v === null) && !isNarrowed(EMPTY_MAP_FILTER) && isNarrowed({ ...EMPTY_MAP_FILTER, beds: ['1'] }));
mustCatch('a group sent as its English name instead of the index\'s Arabic labels', !(pf.types ?? []).includes('Villas & Houses'));

// PROPERTY TYPE AFTER THE GROUP (owner 2026-11-10: «no property type, just group — looks wrong»): a group with types
// picked narrows to them; a group with none stays whole; un-picked types never leak in.
const members = (g: string) => (g === 'Villas & Houses' ? ['Villa', 'Duplex'] : g === 'Apartments' ? ['Apartment', 'Studio'] : []);
check('a picked type narrows its own group; a group with no type stays whole', JSON.stringify(typeSelection({ groups: ['Villas & Houses', 'Apartments'], types: ['Villa'] }, members)) === JSON.stringify(['Villa', 'Apartments']));
check('no types picked: the groups as before', JSON.stringify(typeSelection({ groups: ['Villas & Houses'], types: [] }, members)) === JSON.stringify(['Villas & Houses']));
const typeArT = (sel: string[]) => sel.flatMap((x) => (x === 'Villa' ? ['فيلا'] : x === 'Villas & Houses' ? ['فيلا', 'دوبلكس'] : []));
const villaOnly = pinFilterOf({ ...EMPTY_MAP_FILTER, category: 'Residential', groups: ['Villas & Houses'], types: ['Villa'] }, typeArT, members);
check('the pins ask for the picked type only', JSON.stringify(villaOnly.types) === JSON.stringify(['فيلا']));
mustCatch('a picked type ignored (the whole group still sent)', !(villaOnly.types ?? []).includes('دوبلكس'));
check('a picked type alone counts as a narrowed filter', isNarrowed({ ...EMPTY_MAP_FILTER, types: ['Villa'] }));
const card = readFileSync(join(root, 'src/components/MapFilterCard.tsx'), 'utf8');
check('the map filter card shows the picked groups\' types after the groups', /<FieldLabel>\{t\('Property type'\)\}<\/FieldLabel>/.test(card) && /testID="map-filter-types"/.test(card) && /pinFilterOfWith\(f, typeArForTypes, groupMembers(?:, deals)?(?:, mapTypeScope)?\)/.test(card));

// X TOP RIGHT IN BOTH LANGUAGES (owner 2026-11-10: «x for everything must always be on the top right no matter what»).
// Measured live 2026-11-10, Arabic, 390 px: the filter card's X sat 16 px from the LEFT (a plain row under RTL), and the
// full-screen map's X at left: 12. Physical order: row-reverse under RTL; absolute `right:` is physical on web.
check('the map filter header keeps its X on the right under Arabic RTL', /<View style=\{\[s\.head, \{ flexDirection: isRTL \? 'row-reverse' : 'row' \}/.test(card));
const webSrc = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
check('the full-screen map\'s X is at the physical right; «رسم» moves left while it shows', /style=\{\[s\.closeBtn, s\.closeBtnRight\]\}[^\n]*testID="map-close-full"/.test(webSrc) && /closeBtnRight: \{ right: 12 \}/.test(webSrc) && /topRightAsLeft: \{ left: 12 \}/.test(webSrc) && !/closeBtn: \{\s*position: 'absolute', top: 12, (?:left|right):/.test(webSrc));
mustCatch('the full-screen X back on the left', !/<Pressable style=\{s\.closeBtn\} onPress=\{onClose\}/.test(webSrc));

// «الأثاث» COPIED FROM THE FILTER HOME (owner 2026-11-10: «yeah you copy the filter»): yearly rent homes only, the same
// rule as apartment_guided_counts_ar (`furnished = p_furnished`; ads that do not say show only under «الكل»).
const furn = (deals: string[], f: Partial<typeof EMPTY_MAP_FILTER>) => pinFilterOf({ ...EMPTY_MAP_FILTER, category: 'Residential', ...f }, typeAr, () => [], deals).furnished;
check('furnished / unfurnished narrow the pins on «إيجار» + «سكني»', furn(['rent'], { furnished: true }) === true && furn(['rent'], { furnished: false }) === false && furn(['rent'], {}) === null);
check('the choice is dropped on buy, short stays, mixed deals or commercial (no hidden filter)', furn(['buy'], { furnished: true }) === null && furn(['short'], { furnished: true }) === null && furn(['buy', 'rent'], { furnished: true }) === null && furn(['rent'], { furnished: true, category: 'Commercial' }) === null);
mustCatch('furniture narrowing buy pins (a row the user cannot see)', furn(['buy'], { furnished: true }) === null);
check('the row is offered exactly where it applies', furnitureOffered(['rent'], 'Residential') && !furnitureOffered(['rent'], null) && !furnitureOffered(['rent', 'short'], 'Residential'));
check('a furniture choice counts as a narrowed filter', isNarrowed({ ...EMPTY_MAP_FILTER, furnished: false }));
const pinsLib = readFileSync(join(root, 'src/lib/mapPins.ts'), 'utf8'), noPinLib = readFileSync(join(root, 'src/lib/mapNoPin.ts'), 'utf8');
check('both map reads send p_furnished only when a choice is made', /\.\.\.\(f\.furnished != null \? \{ p_furnished: f\.furnished \} : \{\}\)/.test(pinsLib) && /\.\.\.\(f\.furnished != null \? \{ p_furnished: f\.furnished \} : \{\}\)/.test(noPinLib));
check('the card shows «الأثاث» with the home\'s three choices and icons, and Apply drops a hidden choice', /testID="map-filter-furniture"/.test(card) && /FURN_IMG\[key\]/.test(card) && /onApply\(applied\)/.test(card));

// Wiring.
const data = readFileSync(join(root, 'src/data/mapPins.ts'), 'utf8');
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const screen = readFileSync(join(root, 'src/app/map.tsx'), 'utf8');
check('mapPins.ts asks map_pins_ar through the bounded RPC with the pure arguments', /const args = rpcArgs\(box, cell, filter, limit\);/.test(data) && /boundedRpc<PinRow\[\]>\(supabase\.rpc\('map_pins_ar', args\)\)/.test(data) && /const rows = pinsFrom\(result\);/.test(data) && /if \(rows !== 'unknown'\) \{/.test(data));
check('AppleMap.web.tsx fetches the padded visible box with the zoom cell and draws every row', /fetchMapPins\(paddedBox\(center, span\), cell, pins, cell === 0 \? PIN_SHOW_MAX \+ 1 : PIN_LIMIT\)/.test(web) && /keyed\.set\(k, a\); m\.addAnnotation\(a\);/.test(web) && /mine = \[\.\.\.keyed\.values\(\)\];/.test(web));
// KEEP WHAT STAYS (owner 2026-11-02: «so slow and glitchy»): a pan removes only the pins that left the view and adds only
// the new ones, keyed by what the head shows; never the old clear-all-then-add-all flicker.
check('AppleMap.web.tsx diffs the pins by key on every load (remove the gone, add the new, keep the rest)', /for \(const \[k, a\] of keyed\) if \(!next\.has\(k\)\) \{ m\.removeAnnotation\(a\); keyed\.delete\(k\); \}/.test(web) && /if \(keyed\.has\(k\)\) continue;/.test(web) && /const keyOf = \(r: PinRow\) => `\$\{drawCell\}\|\$\{r\.lat\}\|\$\{r\.lng\}\|\$\{r\.n\}\|\$\{r\.deal\}\|\$\{r\.price \?\? ''\}\|\$\{r\.price_max \?\? ''\}\|\$\{r\.unpriced \?\? ''\}\|\$\{r\.fresh \?\? ''\}\|\$\{r\.shift \? r\.shift\.join\(','\) : ''\}`/.test(web));
mustCatch('the clear-all-then-add-all redraw (the flicker on every pan)', !/clear\(\);\n\s*mine = rows\.map/.test(web));
// The layer mounts BEFORE MapKit has loaded and returns early; the map's arrival must re-run it (measured live
// 2026-11-02: a fresh /map load drew nothing until the deal changed).
check('AppleMap.web.tsx re-runs the pin layer once the map object exists (mapReady bumped where live.map is set, in the deps)',
  /live\.map = map;\n\s*setMapReady\(\(n\) => n \+ 1\);/.test(web) && /\}, \[pinsKey, failed, mapReady, locale\]\);/.test(web) && /if \(!mk \|\| !m \|\| !pinFilter\) return;/.test(web));
check('AppleMap.web.tsx adds the biggest count last so it sits on top', /rows\.sort\(\(a, b\) => a\.n - b\.n\);\n\s*setPinCount\(/.test(web));
// IDENTICAL COPIES FOLD INTO ONE CARD (owner 2026-11-02: «some also have duplicates»): same site + price + area + type +
// title + photo → one card and «and N identical listings»; anything different stays its own card — no source merged away.
const dupCards = [{ k: 'a', id: 1 }, { k: 'a', id: 2 }, { k: 'b', id: 3 }, { k: 'a', id: 4 }];
const folded = foldDuplicates(dupCards, (c) => c.k);
check('foldDuplicates keeps the first of each key, counts the copies, keeps order', folded.length === 2 && folded[0].card.id === 1 && folded[0].copies === 3 && folded[1].card.id === 3 && folded[1].copies === 1);
mustCatch('a fold that merges different listings (different key folded together)', foldDuplicates(dupCards, (c) => c.k).length !== 1);
mustCatch('a fold that drops a copy without counting it', folded.reduce((a, f) => a + f.copies, 0) === dupCards.length);
const sheetSrc = readFileSync(join(root, 'src/components/MapPinSheet.tsx'), 'utf8');
// Owner 2026-11-10 (the final pin rule) replaced «every copy is its own card»: ads PROVEN to be one property fold into
// one card, and every folded ad stays on screen as a named link under it. The fold itself is executed in
// verify-map-same-property-is-one-card.ts; here: nothing may be dropped on the way to the screen.
check('the sheet groups proven-same ads and shows every other ad under it as its own full card', /foldSameProperty\(cards, factsOf\)/.test(sheetSrc) && /\{groups\.map\(\(\{ main, others \}\) => \(/.test(sheetSrc) && /\{others\.map\(\(o\) => \(\s*<ResultCard key=\{`\$\{o\.sourceTable\}#\$\{o\.id\}`\} listing=\{o\} onOpen=\{\(\) => \{ void openListing\(o\); \}\}/.test(sheetSrc) && !/foldDuplicates\(cards/.test(sheetSrc));
mustCatch('a sheet that drops same-site copies instead of naming them (foldDuplicates keeps one and shows nothing else)', !/foldDuplicates\(cards/.test(sheetSrc));
check('a committed migration restores map_pins_ar and the grid without the same-site fold', (() => { const dir = join(root, 'supabase/migrations'); const f = readdirSync(dir).filter((x) => /map_same_site_copies_stay/.test(x)).pop(); if (!f) return false; const sql = readFileSync(join(dir, f), 'utf8'); return !/row_number\(\) over \(partition by k\.source_table/.test(sql) && !/distinct on \(u\.source_table/.test(sql) && /select k\.la, k\.lo, count\(\*\)::int,/.test(sql) && !/same_site_dupes/.test(sql); })());
check('the sheet shows the head\'s own words (price or count) at once while the cards load', /const head = pinHead\(row, isRTL \? 'ar' : 'en'\);/.test(sheetSrc) && /\$\{t\('Listing'\)\} · \$\{head\}/.test(sheetSrc));
// AN INVISIBLE OUTLINE IS NOT CLICKABLE (measured live 2026-11-02, phone: a tap between two pins in central Riyadh flew
// the map out to the whole region because the faded-out polygon took the tap). The region select bails when fade is 0.
check('AppleMap.web.tsx ignores a region tap once its outline has faded to nothing', /const r = e\.overlay\?\.data;[\s\S]{0,600}?if \(!r \|\| !map \|\| fade <= 0\) return;/.test(web));
mustCatch('a region select that fires while the outline is invisible', !/if \(!r \|\| !map\) return;\n\s*chosen =/.test(web));
// NEVER A PARTIAL SET OF PINS: an exact-point read that hit PIN_LIMIT is re-read as a fine bubble grid (every listing
// counted), and the bubbles are drawn with THAT cell (element, data and anchor all follow drawCell).
check('AppleMap.web.tsx falls back to a fine bubble grid when the exact read hit its cap (after district names, when 2+ districts share the view), and draws with that cell',
  // `dense` = the cap was hit; the deepest-zoom read (bubblesCanZoomIn false → every exact point) runs first, and a view
  // where bubbles still make sense keeps this fallback (🔧 2026-11-06, verify-deepest-zoom-shows-heads-not-bubbles.ts).
  /let dense = cell === 0 && \(crowdedByDots \|\| rows\.length > PIN_SHOW_MAX\);[\s\S]{0,700}?if \(dense\) \{[\s\S]{0,900}?\n\s*drawCell = fineCellForSpan\(span\.latitudeDelta\);[\s\S]{0,500}?rows = await fetchMapPins\(paddedBox\(center, span\), drawCell, pins\);/.test(web)
  && /element\(row, drawCell(, [^)]*)?\)/.test(web) && /data: \{ pin: row, cell: drawCell \}/.test(web) && /anchorOffset: drawCell > 0/.test(web));
// SMOOTH (owner 2026-11-03): the crowded view is decided from the dots feed and drawn from it — no network wait —
// and only successful pin reads are remembered (a failed read is never cached as an answer).
check('a crowded close view is decided by the dots feed (weighted estimate > CROWD_ESTIMATE) and skips the exact read', /const crowdedByDots = dots !== 'unknown' && dotsEstimateInBox\(dots, pins\.deals, /.test(web) && /> CROWD_ESTIMATE;/.test(web) && /crowdedByDots \? \[\] : await fetchMapPins\(/.test(web));
check('the crowded bubbles come from the dots feed when it is the same 0.01° grid', /if \(dots !== 'unknown' && drawCell === 0\.01\) \{[\s\S]{0,200}?bubblesFromDots\(dotsInView\(dots, pins\.deals, paddedBox\(center, span\)\)\)/.test(web));
check('a failed pin read is never remembered', /if \(rows !== 'unknown'\) \{\n\s*recent\.delete\(key\); recent\.set\(key, \{ at: Date\.now\(\), rows \}\);/.test(data));
check('the fine grid is ~14 rows on the ladder, floor 0.01°, and finer than the normal grid', fineCellForSpan(0.14) === 0.01 && fineCellForSpan(0.001) === 0.01 && fineCellForSpan(1) === 0.02 && fineCellForSpan(1) < cellForSpan(1));
mustCatch('a fine grid coarser than the normal grid (the fallback would not resolve a dense view)', fineCellForSpan(0.5) < cellForSpan(0.5));
check('PIN_LIMIT is the cap the data module sends by default', PIN_LIMIT === 3000 && /limit = 3000\)/.test(readFileSync(join(root, 'src/data/mapPins.ts'), 'utf8')));
// A VIEW SHOWS AT MOST PIN_SHOW_MAX PRICE HEADS (owner 2026-11-02: «when I zoom in I start seeing so many things»): a
// denser view keeps the fine dots until the user zooms closer. The exact read asks for one row over the cap, no more.
check('PIN_SHOW_MAX is a few hundred heads, well under the read cap', PIN_SHOW_MAX === 400 && PIN_SHOW_MAX < PIN_LIMIT);
mustCatch('a view that draws thousands of overlapping heads (the cap gone)', PIN_SHOW_MAX <= 500);
check('AppleMap.web.tsx reloads on region-change-end and drops a late answer', /addEventListener\('region-change-end', onRegion\)/.test(web) && /if \(my !== seq \|\| rows === 'unknown'/.test(web));
check('AppleMap.web.tsx keeps the layer on a failed fetch (unknown → return before clear)', web.indexOf("rows === 'unknown'") < web.indexOf('const keyOf = (r: PinRow)'));
check('Apply turns the drawn shape into the pin polygon; Remove clears it; the count pill shows inside the boundary', /setPoly\(polygonOf\(shape\.points/.test(web) && /shapeRef\.current = null; setHasShape\(false\); setPoly\(null\);/.test(web) && /poly: poly \?\? pins\.poly \?\? null/.test(web) && /hasShape \? t\('\{n\} listings inside the boundary'/.test(web));
check('a bubble tap zooms in; a pin tap hands the row up (one shared pick)', /const pick = \(row: PinRow, cell: number\) => \{[\s\S]{0,400}?if \(cell > 0\) \{[\s\S]{0,700}?\} else onPinSelectRef\.current\?\.\(row\);/.test(web));
// TOUCH: on a phone MapKit's `select` never fired for a tap on a custom annotation (owner 2026-11-02: «when I click it
// doesn't show»). The head element carries its own pointerdown/pointerup tap (≤ 10 px of movement), and MapKit's
// mouse `select` is deduped against it by time.
check('the head element handles its own tap (pointerdown → pointerup within 10 px → pick)',
  /el\.addEventListener\('pointerdown'/.test(web) && /el\.addEventListener\('pointerup'[\s\S]{0,300}?< 10\) \{ e\.stopPropagation\(\); pick\(row, cell\); \}/.test(web));
check('MapKit select is deduped against the element tap and routes to the same pick', /if \(Date\.now\(\) - lastPick < 600\) return;[\s\S]{0,80}?pick\(d\.pin, d\.cell \?\? 0\);/.test(web));
mustCatch('a pin that only MapKit select can pick (touch would open nothing)', /el\.addEventListener\('pointerup'/.test(web));
// SMALL HEADS (owner 2026-11-02: «the pin is so so big»): 11 px text, slim pill, 26 px bubble.
check('pin heads are small: 11 px text, 4 px vertical padding', /font:600 11px\/1/.test(web) && /padding:4px 7px/.test(web));
mustCatch('the big 12 px / 34 px heads', !/font:600 12px/.test(web) && !/height:34px/.test(web));
// ZOOMED OUT = DOTS, NO NUMBER (owner 2026-11-02, Zillow: «pins don't show the price unless you zoom in»): a 14 px
// deal-coloured dot per cell (mixed deals → neutral dark, never gold), empty text; the count lives in the bottom pill,
// which now shows for every view, not only a drawn boundary.
check('a zoomed-out cell is a 14 px dot with no text, coloured by dotColor', /cell > 0 \? dotColor\(row\) : pinColor\(row\)/.test(web) && /border-radius:50%;width:14px;height:14px/.test(web) && /el\.textContent = cell > 0 \? '' : pinHead\(row, loc\)/.test(web));
check('dotColor is the deal colour, neutral for a mixed cell, never gold', dotColor({ deal: 'buy' }) === PIN_COLOR.buy && dotColor({ deal: 'rent' }) === PIN_COLOR.rent && dotColor({ deal: 'mixed' }) === MIXED_DOT && dotColor({ deal: 'mixed' }) !== GOLD);
mustCatch('a numbered bubble when zoomed out (the Zillow rule)', !/bubbleText\(row\.n, loc\)/.test(web));
check('the count pill shows for every view («N إعلانات في حي …» / «في هذه المنطقة», viewCountText) and for a drawn boundary', /!drawing && typeof pinCount === 'number' \?/.test(web) && /hasShape \? t\('\{n\} listings inside the boundary', \{ n: pinCount\.toLocaleString\('en-US'\) \}\) : viewCountText\(placeCount \?\? pinCount, viewPlace, locale === 'ar' \? 'ar' : 'en', pins\?\.deals, otherDeals\)/.test(web) && /'\{n\} listings here': '\{n\} إعلان في هذه المنطقة'/.test(readFileSync(join(root, 'src/i18n.tsx'), 'utf8')));
// (M.MapDealRow / M.countPinsInView since 2026-11-02: the deal row and the MapKit glue load as their own chunk — ALWAYS FAST)
check('the map screen feeds the deal button into the pins and clears the sheet on a deal change', /<M\.MapDealRow deals=\{deals\} onDeals=\{\(d\) => \{ setDeals\(d\); setPinRow\(null\); setMapFilter\(/.test(screen) && /pins=\{\{ deals, \.\.\.pinFilterOf\(mapFilter, deals\) \}\}/.test(screen));
check('the Filter button opens the centered filter card; Apply feeds the pins and counts in view', /onFilter=\{\(\) => setFilterOpen\(true\)\} filterOn=\{isNarrowed\(mapFilter\)\}/.test(screen) && /<MapFilterCard value=\{mapFilter\} deals=\{deals\}/.test(screen) && /countPins=\{\(f\) => M\.countPinsInView\(\{ deals, \.\.\.pinFilterOf\(f, deals\) \}\)\}/.test(screen));
const cardSrc = readFileSync(join(root, 'src/components/MapFilterCard.tsx'), 'utf8');
check('the filter card is the site\'s own tiles (OptionBox + the same icons), X top right, no transaction section', /<OptionBox compact key=\{cat\} label=\{t\(cat\)\} img=\{categoryImg\(cat\)\}/.test(cardSrc) && /img=\{groupImg\(g\.group\)\}/.test(cardSrc) && /img=\{BED_IMG\[opt\]\}/.test(cardSrc) && /testID="map-filter-close"/.test(cardSrc) && !/DEALS|MapDeal\b/.test(cardSrc));
// Owner 2026-11-08: «سكني» / «تجاري» first; the groups appear only once a category is picked (like the Filter home).
const groupsRx = /const groups = useMemo\(\(\) => \(f\.category \? groupsFor\(f\.category as Macro\) : \[\]\), \[f\.category\]\);/;
check('the map filter shows the property groups only after a category is picked', groupsRx.test(cardSrc) && /\{f\.category \? \(\s*<>\s*<FieldLabel>\{t\('Property group'\)\}/.test(cardSrc));
mustCatch('groups shown before a category (both lists mixed)', !groupsRx.test(cardSrc.replace(': []), [f.category]);', ": [...groupsFor('Residential'), ...groupsFor('Commercial')]), [f.category]);")));
// Owner 2026-11-09 (Zillow's mobile filter): on a phone the filter is FULL SCREEN, the live count is the title, and a
// fixed bottom bar carries «مسح الكل» + «عرض الإعلانات». A wider screen keeps the centered card.
const fullRx = /const phone = useWindowDimensions\(\)\.width < PHONE_MAX;/;
check('on a phone the map filter is full screen, titled «تصفية», with a Clear / «Show N listings» bar at the bottom (owner 2026-11-11: the count lives in the button, like Zillow)',
  fullRx.test(cardSrc) && /phone && s\.cardFull/.test(cardSrc) && /testID=\"map-filter-title\">\{t\('Filter'\)\}/.test(cardSrc) && (cardSrc.match(/count === null \? t\('Show listings'\) : isRTL \? showAdsAr\(count\) : t\('Show \{n\} listings'/g) ?? []).length === 2
  && /testID="map-filter-clear"/.test(cardSrc) && /export const PHONE_MAX = 768;/.test(cardSrc));
const filterCountSrc = readFileSync(join(root, 'src/lib/mapFilter.ts'), 'utf8');
const mf = await import('../src/lib/mapFilter.ts');
check('the map Filter button shows how many choices are picked', mf.filterCount({ category: 'Residential', groups: ['Villas & Houses'], types: ['Villa'], beds: ['3', '4'], furnished: null, areaMin: '200', areaMax: '', priceMin: '', priceMax: '900000' }) === 7
  && mf.filterCount({ category: null, groups: [], types: [], beds: [], furnished: null, areaMin: '', areaMax: '', priceMin: '', priceMax: '' }) === 0
  && /testID="map-filter-count"/.test(readFileSync(join(root, 'src/components/MapDealRow.tsx'), 'utf8')) && /filterCount=\{filterCount\(mapFilter\)\}/.test(readFileSync(join(root, 'src/app/map.tsx'), 'utf8')) && /export const filterCount/.test(filterCountSrc));
mustCatch('a phone filter button with no count (the old «Show listings» only)', !(cardSrc.replace(/count === null \? t\('Show listings'\) : t\('Show \{n\} listings', \{ n: count\.toLocaleString\('en-US'\) \}\)/, "t('Show listings')").match(/count === null \? t\('Show listings'\) : t\('Show \{n\} listings'/g)?.length === 2));
mustCatch('a phone filter that is still the small centered card', !/phone && s\.cardFull/.test(cardSrc.replace('phone && s.cardFull', 'false && s.cardFull')));
// Owner 2026-11-09: the «نوع الصفقة» popup is bigger, with «تطبيق» at the bottom. Ticks edit a DRAFT; only Apply
// hands them to the map (so the pins show exactly what was applied); X / a tap outside leaves the map as it was.
const dealSrc = readFileSync(join(root, 'src/components/MapDealRow.tsx'), 'utf8');
const draftRx = /const toggle = \(id: MapDeal\) => setDraft\(\(d\) => nextDeals\(d, id\)\);/;
check('the deal popup ticks a draft, and only «تطبيق» sends it to the map',
  draftRx.test(dealSrc) && /const apply = \(\) => \{ setDeals\(\(\) => draft\); setOpen\(false\); \};/.test(dealSrc)
  && /testID="map-deal-apply"/.test(dealSrc) && /const on = draft\.includes\(d\.id\);/.test(dealSrc) && /maxWidth: 440/.test(dealSrc));
mustCatch('a tick that changes the map at once again (no Apply)', !draftRx.test(dealSrc.replace('setDraft((d) => nextDeals(d, id))', 'setDeals((d) => nextDeals(d, id))')));
// A tap must NOT resize the map (owner 2026-11-02: «when I click it then I see the others, it's weird»): switching to
// full screen on the tap re-laid the map out, reloaded the pins and reshuffled them around the tapped one. The sheet
// opens over the map exactly as it is.
check('a tapped pin opens the card sheet over the map AS IT IS (no full-screen switch on the tap)', /onPinSelect=\{\(row\) => \{ setPinRow\(row\); \}\}/.test(screen) && /<MapPinSheet row=\{pinRow\} onClose=/.test(screen));
mustCatch('a tap that flips the map to full screen (the reshuffle the owner saw)', !/onPinSelect=\{[^}]*setFull\(true\)/.test(screen));
const sheet = readFileSync(join(root, 'src/components/MapPinSheet.tsx'), 'utf8');
check('the sheet loads every listing through fetchListingCards (the search\'s own card path) and opens with openListing', /fetchListingCards\(table, ids\)/.test(sheet) && /openListing\(main\)/.test(sheet) && /openListing\(o\)/.test(sheet) && /<ResultCard listing=\{main\}/.test(sheet));
check('the sheet says a failed load is a failed load, never «no listings»', /if \(!all\.length && \(row\.ids\?\.length \?\? 0\) > 0\) setFailed\(true\);/.test(sheet));
check('a committed migration creates map_pins_ar with the price and the filter arguments', readdirSync(join(root, 'supabase/migrations')).some((f) => { const t = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /create function public\.map_pins_ar\(/.test(t) && /p_price_min numeric/.test(t) && /price numeric, platform text/.test(t); }));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-pins-every-listing: all checks passed');
process.exit(failed ? 1 : 0);
