// EVERY PROPERTY PIN ON THE MAP — the rules EXECUTED (owner 2026-11-02: «display all property pins … Buy, Rent, Short
// stays … one golden pin with the number when several listings share the exact same coordinates … always show the
// price as the head of the pin»). This runs src/lib/mapPins.ts under plain Node: the colour rule, the price head, the
// zoom→cell rule, the padded box, the RPC arguments and the failed-fetch answer, each with a mutation that must be
// caught. Then the wiring: the data module asks map_pins_ar through the bounded RPC, the map component draws from it,
// the deal button feeds it, and a committed migration creates the function.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinFilterOf, isNarrowed, EMPTY_MAP_FILTER } from '../src/lib/mapFilter.ts';
import { pinColor, pinHead, shortMoney, cellForSpan, fineCellForSpan, PIN_LIMIT, paddedBox, bubbleText, rpcArgs, pinsFrom, idsByTable, orderLike, polygonOf, PIN_COLOR, GOLD } from '../src/lib/mapPins.ts';

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
check('a shared spot head is its count, never a price (3 → «3 إعلانات», 12 → «12 إعلان», 2 → «إعلانان»)', pinHead({ n: 3, deal: 'mixed', price: 1, platform: null }, 'ar') === '3 إعلانات' && pinHead({ n: 12, deal: 'buy', price: 1, platform: null }, 'ar') === '12 إعلان' && pinHead({ n: 2, deal: 'buy', price: 1, platform: null }, 'ar') === '2 إعلانان');
check('a Short-stays head prints no figure (Gathern / Aqar Monthly rule), by deal AND by platform', pinHead(one('short', 3000, 'gathern'), 'ar') === 'إقامة قصيرة' && pinHead(one('rent', 3000, 'aqarmonthly'), 'ar') === 'إقامة قصيرة' && !/\d/.test(pinHead(one('short', 3000), 'en')));
check('an unpriced listing says price on request, never a blank head', pinHead(one('buy', null), 'ar') === 'السعر عند الطلب' && pinHead(one('buy', 0), 'en') === 'Price on request');
check('a price that arrives as a string (numeric over JSON) still formats', pinHead({ n: 1, deal: 'buy', price: '650000', platform: 'aqar' }, 'ar') === '650 ألف');
check('shortMoney keeps one decimal under 10 and none above (1.25M → 1.3M, 12.4K → 12K)', shortMoney(1250000, 'en') === '1.3M' && shortMoney(12400, 'en') === '12K' && shortMoney(950, 'en') === '950');
mustCatch('a Short-stays pin printing its stored price', !/3/.test(pinHead(one('short', 3000, 'gathern'), 'ar')));
mustCatch('a shared spot printing a price instead of its count', !/ألف|مليون/.test(pinHead({ n: 4, deal: 'buy', price: 650000, platform: 'aqar' }, 'ar')));

// Zoom → cell: exact points from city zoom inward, cells sized to ~7 rows wider out (measured live 2026-11-02: /30 drew
// hundreds of overlapping «1» bubbles over the country), never below 0.01°.
check('city zoom and closer asks for exact points (cell 0)', cellForSpan(0.12) === 0 && cellForSpan(0.03) === 0);
check('a region view asks for cells of span/7; the country view (17°) ~2.4°; a floor of 0.01°', Math.abs(cellForSpan(0.7) - 0.1) < 1e-9 && Math.abs(cellForSpan(17) - 17 / 7) < 1e-9 && Math.abs(cellForSpan(0.14) - 0.02) < 1e-9 && cellForSpan(0.121) >= 0.01);
mustCatch('exact points requested for the whole country (424k rows)', cellForSpan(17) > 0);
mustCatch('a bubble grid finer than ~12 rows (the overlapping-bubbles defect of 2026-11-02)', cellForSpan(17) >= 17 / 12);
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

// Wiring.
const data = readFileSync(join(root, 'src/data/mapPins.ts'), 'utf8');
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const screen = readFileSync(join(root, 'src/app/map.tsx'), 'utf8');
check('mapPins.ts asks map_pins_ar through the bounded RPC with the pure arguments', /boundedRpc<PinRow\[\]>\(supabase\.rpc\('map_pins_ar', rpcArgs\(box, cell, filter, limit\)\)\)/.test(data) && /return pinsFrom\(result\)/.test(data));
check('AppleMap.web.tsx fetches the padded visible box with the zoom cell and draws every row', /fetchMapPins\(paddedBox\(center, span\), cell, pins\)/.test(web) && /mine = rows\.map\(\(row\) => new mk\.Annotation\(/.test(web));
// The layer mounts BEFORE MapKit has loaded and returns early; the map's arrival must re-run it (measured live
// 2026-11-02: a fresh /map load drew nothing until the deal changed).
check('AppleMap.web.tsx re-runs the pin layer once the map object exists (mapReady bumped where live.map is set, in the deps)',
  /live\.map = map;\n\s*setMapReady\(\(n\) => n \+ 1\);/.test(web) && /\}, \[pinsKey, failed, mapReady\]\);/.test(web) && /if \(!mk \|\| !m \|\| !pinFilter\) return;/.test(web));
check('AppleMap.web.tsx adds the biggest count last so it sits on top', /rows\.sort\(\(a, b\) => a\.n - b\.n\);\n\s*setPinCount\(/.test(web));
// NEVER A PARTIAL SET OF PINS: an exact-point read that hit PIN_LIMIT is re-read as a fine bubble grid (every listing
// counted), and the bubbles are drawn with THAT cell (element, data and anchor all follow drawCell).
check('AppleMap.web.tsx falls back to a fine bubble grid when the exact read hit its cap, and draws with that cell',
  /if \(cell === 0 && rows\.length >= PIN_LIMIT\) \{\n\s*drawCell = fineCellForSpan\(span\.latitudeDelta\);\n\s*rows = await fetchMapPins\(paddedBox\(center, span\), drawCell, pins\);/.test(web)
  && /element\(row, drawCell\)/.test(web) && /data: \{ pin: row, cell: drawCell \}/.test(web) && /anchorOffset: drawCell > 0/.test(web));
check('the fine grid is ~14 rows with a floor of 0.002° and finer than the normal grid', Math.abs(fineCellForSpan(0.14) - 0.01) < 1e-9 && fineCellForSpan(0.001) === 0.002 && fineCellForSpan(1) < cellForSpan(1));
mustCatch('a fine grid coarser than the normal grid (the fallback would not resolve a dense view)', fineCellForSpan(0.5) < cellForSpan(0.5));
check('PIN_LIMIT is the cap the data module sends by default', PIN_LIMIT === 3000 && /limit = 3000\)/.test(readFileSync(join(root, 'src/data/mapPins.ts'), 'utf8')));
check('AppleMap.web.tsx reloads on region-change-end and drops a late answer', /addEventListener\('region-change-end', onRegion\)/.test(web) && /if \(my !== seq \|\| rows === 'unknown'/.test(web));
check('AppleMap.web.tsx keeps the layer on a failed fetch (unknown → return before clear)', web.indexOf("rows === 'unknown'") < web.indexOf('clear();\n      mine = rows.map'));
check('Apply turns the drawn shape into the pin polygon; Remove clears it; the count pill shows inside the boundary', /setPoly\(polygonOf\(shape\.points/.test(web) && /shapeRef\.current = null; setHasShape\(false\); setPoly\(null\);/.test(web) && /poly: poly \?\? pins\.poly \?\? null/.test(web) && /hasShape && !drawing && pinCount !== null/.test(web));
check('a bubble tap zooms in; a pin tap hands the row up', /d\.cell && d\.cell > 0/.test(web) && /onPinSelectRef\.current\?\.\(d\.pin\)/.test(web));
// (M.MapDealRow / M.countPinsInView since 2026-11-02: the deal row and the MapKit glue load as their own chunk — ALWAYS FAST)
check('the map screen feeds the deal button into the pins and clears the sheet on a deal change', /<M\.MapDealRow deals=\{deals\} onDeals=\{\(d\) => \{ setDeals\(d\); setPinRow\(null\); \}\} onFilter=/.test(screen) && /pins=\{\{ deals, \.\.\.pinFilterOf\(mapFilter\) \}\}/.test(screen));
check('the Filter button opens the centered filter card; Apply feeds the pins and counts in view', /onFilter=\{\(\) => setFilterOpen\(true\)\} filterOn=\{isNarrowed\(mapFilter\)\}/.test(screen) && /<MapFilterCard value=\{mapFilter\}/.test(screen) && /countPins=\{\(f\) => M\.countPinsInView\(\{ deals, \.\.\.pinFilterOf\(f\) \}\)\}/.test(screen));
const cardSrc = readFileSync(join(root, 'src/components/MapFilterCard.tsx'), 'utf8');
check('the filter card is the site\'s own tiles (OptionBox + the same icons), X top right, no transaction section', /<OptionBox compact key=\{cat\} label=\{t\(cat\)\} img=\{categoryImg\(cat\)\}/.test(cardSrc) && /img=\{groupImg\(g\.group\)\}/.test(cardSrc) && /img=\{BED_IMG\[opt\]\}/.test(cardSrc) && /testID="map-filter-close"/.test(cardSrc) && !/DEALS|MapDeal\b/.test(cardSrc));
check('a tapped pin opens the card sheet inside the map (Zillow-style), full screen', /onPinSelect=\{\(row\) => \{ setPinRow\(row\); setFull\(true\); \}\}/.test(screen) && /<MapPinSheet row=\{pinRow\} onClose=/.test(screen));
const sheet = readFileSync(join(root, 'src/components/MapPinSheet.tsx'), 'utf8');
check('the sheet loads every listing through fetchListingCards (the search\'s own card path) and opens with openListing', /fetchListingCards\(table, ids\)/.test(sheet) && /openListing\(l\)/.test(sheet) && /<ResultCard listing=\{l\}/.test(sheet));
check('the sheet says a failed load is a failed load, never «no listings»', /if \(!all\.length && \(row\.ids\?\.length \?\? 0\) > 0\) setFailed\(true\);/.test(sheet));
check('a committed migration creates map_pins_ar with the price and the filter arguments', readdirSync(join(root, 'supabase/migrations')).some((f) => { const t = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /create function public\.map_pins_ar\(/.test(t) && /p_price_min numeric/.test(t) && /price numeric, platform text/.test(t); }));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-map-pins-every-listing: all checks passed');
process.exit(failed ? 1 : 0);
