// AREA LABELS — CITY AND DISTRICT NAMES WITH THEIR COUNTS (owner's father, relayed by the owner 2026-11-03: «show only
// the number of listings in the area at such low zoom, and show place marks only when the user zooms in further»; «at
// this zoom level show the names of the districts only and the number of listings»). This barrier EXECUTES the pure
// rules (which level a zoom shows, the label words, where a tap goes) with mutation proofs, and pins the wiring by
// shape: un-narrowed views read the labels first, a failed read falls back to the dots, labels are keyed and tappable.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { areaLevelFor, areaCount, areaName, areaZoomSpan, areasTotal, denseShowsDistricts, bubbleTapSpan, inView, parseAreasFeed, areasFromFeed, visibleAreas, CITY_LABELS_ABOVE, DISTRICT_LABELS_ABOVE } from '../src/lib/mapAreas.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

// Owner 2026-11-05: «first thing Saudi, the total number, then region, then city, then district» (the map opens at ~17°).
check('the opening view (17°) shows ONE country label; a zoom in shows regions, then cities', areaLevelFor(17) === 'country' && areaLevelFor(9) === 'region' && areaLevelFor(3) === 'city');
check('city zoom shows one label per DISTRICT', areaLevelFor(2.5) === 'district' && areaLevelFor(0.5) === 'district' && areaLevelFor(0.07) === 'district');
check('close in shows price pins (no label level)', areaLevelFor(0.06) === null && areaLevelFor(0.02) === null);
mustCatch('pins at city zoom (the clutter the owner\'s father saw)', areaLevelFor(0.3) !== null);
mustCatch('labels that never hand over to pins', areaLevelFor(0.01) === null);
check('the thresholds nest: city above district', CITY_LABELS_ABOVE > DISTRICT_LABELS_ABOVE);
check('counts are short: 245, 3.4 ألف / 3.4K, 1.2 مليون', areaCount(245, 'ar') === '245' && areaCount(3400, 'ar') === '3.4 ألف' && areaCount(3400, 'en') === '3.4K' && areaCount(12400, 'ar') === '12 ألف' && areaCount(1_200_000, 'ar') === '1.2 مليون');
check('the name is the city at city level and the district (no «حي ») at district level', areaName({ city: 'جدة', district: 'حي النعيم' }, 'city') === 'جدة' && areaName({ city: 'جدة', district: 'حي النعيم' }, 'district') === 'النعيم' && areaName({ city: 'جدة', district: '' }, 'district') === 'جدة');
check('each tap goes one level closer: country → regions → cities → districts → pins', areaLevelFor(areaZoomSpan('country')) === 'region' && areaLevelFor(areaZoomSpan('region')) === 'city' && areaLevelFor(areaZoomSpan('city')) === 'district' && areaLevelFor(areaZoomSpan('district')) === null);
mustCatch('a district tap that lands still on labels (the user taps forever)', areaLevelFor(areaZoomSpan('district')) === null);
check('the count pill is the labels\' total', areasTotal([{ city: 'a', district: '', lat: 1, lng: 1, n: 3 }, { city: 'b', district: '', lat: 1, lng: 1, n: 4 }]) === 7);

check('a crowded wide view shows district names while 2+ are on screen; inside a district (≤0.02°) never', denseShowsDistricts(5, 0.045) && denseShowsDistricts(2, 0.03) && !denseShowsDistricts(1, 0.045) && !denseShowsDistricts(3, 0.015) && !denseShowsDistricts(2, 0.02));
mustCatch('blue dots on a crowded multi-district view (the view the owner\'s father asked to replace)', denseShowsDistricts(3, 0.045));
mustCatch('district names coming back after a district tap (the flip-back measured live)', !denseShowsDistricts(2, areaZoomSpan('district')));
check('a label just off the screen edge does not count as on screen', inView({ lat: 21.5, lng: 39.2 }, { latitude: 21.5, longitude: 39.2 }, { latitudeDelta: 0.01, longitudeDelta: 0.01 }) && !inView({ lat: 21.51, lng: 39.2 }, { latitude: 21.5, longitude: 39.2 }, { latitudeDelta: 0.01, longitudeDelta: 0.01 }));
check('a bubble tap always zooms in: never wider than a third of the view', bubbleTapSpan(0.01, 0.015) === 0.005 && Math.abs(bubbleTapSpan(0.01, 0.3) - 0.022) < 1e-9 && bubbleTapSpan(0.075, 0.6) <= 0.2);
mustCatch('a bubble tap that zooms OUT (2.2 cells wider than the view)', bubbleTapSpan(0.01, 0.015) < 0.015);
check('a district tap zooms well past district level (0.015°), not onto a crowded neighbour view', areaZoomSpan('district') <= 0.02);
// THE LABELS FEED (owner 2026-11-03: «I want it to feel smooth»): every label once, filtered on the phone.
const feedRows = parseAreasFeed([[true, 'جدة', '', 21.5, 39.2, 100, 20, 0], [false, 'جدة', 'النعيم', 21.6, 39.14, 30, 5, 2], [false, 'جدة', 'الصفا', 21.58, 39.21, 0, 7, 0], ['bad'], [false, '', 'x', 1, 1, 1, 1, 1]]);
check('the feed keeps only well-formed rows', feedRows.length === 3);
check('a city view lists cities only, counted for the chosen deals', JSON.stringify(areasFromFeed(feedRows, 'city', ['buy'], { s: 20, n: 23, w: 38, e: 40 })) === JSON.stringify([{ city: 'جدة', district: '', lat: 21.5, lng: 39.2, n: 100 }]));
check('a district view counts the chosen deals, drops a district with none, biggest first', JSON.stringify(areasFromFeed(feedRows, 'district', ['buy', 'short'], { s: 20, n: 23, w: 38, e: 40 }).map((a) => [a.district, a.n])) === JSON.stringify([['النعيم', 32]]));
check('a label outside the box is left out', areasFromFeed(feedRows, 'district', ['buy', 'rent', 'short'], { s: 21.59, n: 23, w: 38, e: 40 }).length === 1);
mustCatch('a district counted with a deal the user did not choose', areasFromFeed(feedRows, 'district', ['buy'], { s: 20, n: 23, w: 38, e: 40 })[0].n === 30);
check('fetchMapAreas answers from the feed and keeps the RPC as the fallback', /const local = await fetchAreasFeed\(\);\n\s*if \(local\) return areasFromFeed\(local, level, deals, box, 400\);/.test(readFileSync(join(root, 'src/data/mapAreas.ts'), 'utf8')) && /if \(!rows\.length\) return null;/.test(readFileSync(join(root, 'src/data/mapAreas.ts'), 'utf8')));
// ONLY THE PLACES THAT MATTER (owner 2026-11-03: «the numbers 1 … look weird»): the screenshot's own country view.
const country = [['الرياض', 98000], ['جدة', 77000], ['حفر الباطن', 751], ['عرعر', 390], ['القنفذة', 318], ['الافلاج', 104], ['العلا', 35], ['رنية', 29], ['طبرجل', 8], ['يدمة', 2], ['الحزم', 1]].map(([city, n]) => ({ city: city as string, district: '', lat: 0, lng: 0, n: n as number }));
const shown = visibleAreas(country).map((a) => a.city);
check('the country view keeps the big places and drops «الحزم 1», «يدمة 2», «طبرجل 8»', shown.includes('الرياض') && shown.includes('حفر الباطن') && !shown.includes('الحزم') && !shown.includes('يدمة') && !shown.includes('طبرجل'));
check('zoomed into a small region, its small places show (the floor follows the biggest label in view)', visibleAreas(country.filter((a) => a.n < 400)).map((a) => a.city).includes('العلا'));
mustCatch('a label of 1 listing drawn next to 98 thousand', !visibleAreas(country).some((a) => a.n === 1));
// Umluj, 2026-11-05: districts of 1-2 listings each, nothing bigger in view — the map was empty while the pill said 6.
const umluj = [{ city: 'املج', district: 'حي الدقم', lat: 25.07, lng: 37.25, n: 2 }, { city: 'املج', district: 'حي الضويحي', lat: 25.12, lng: 37.26, n: 2 }, { city: 'املج', district: 'حي البلد', lat: 25.02, lng: 37.26, n: 1 }];
check('a small town with no big place in view shows all its places (Umluj: 3 districts of 1-2 listings)', visibleAreas(umluj).length === 3);
mustCatch('the LABEL_MIN floor hiding every label of a small town (the empty Umluj map)', visibleAreas(umluj).length > 0);
check('the drawn labels are the visible ones; the pill still counts every listing in view', (src => /drawAreas\(visibleAreas\(areas, level\), level\);\n\s*setPinCount\(areasTotal\(areas\)\);/.test(src) && /drawAreas\(visibleAreas\(areas\), 'district'\);\n\s*setPinCount\(areasTotal\(areas\)\);/.test(src))(readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8')));
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const data = readFileSync(join(root, 'src/data/mapAreas.ts'), 'utf8');
check('an un-narrowed view reads the labels for its level first', /const level = narrowed \? null : areaLevelFor\(span\.latitudeDelta\);/.test(web) && /const areas = await fetchMapAreas\(paddedBox\(center, span\), level, pins\.deals\);/.test(web));
check('labels are drawn keyed, counted in the pill, and a failed read falls back to the dots', /drawAreas\(visibleAreas\(areas, level\), level\);\n\s*setPinCount\(areasTotal\(areas\)\);\n\s*return;/.test(web) && /if \(areas !== 'unknown'\) \{/.test(web) && /next\.set\(`A\|\$\{level\}\|\$\{a\.city\}\|\$\{a\.district\}\|\$\{a\.n\}`, a\)/.test(web));
check('labels never pile up: MapKit collision hides the smaller neighbour, priority follows the count', /collisionMode: mk\.Annotation\.CollisionMode\?\.Rectangle, displayPriority: 250 \+ Math\.round\(499 \* a\.n \/ maxN\)/.test(web));
check('the crowded exact-point read shows district names before falling back to the fine grid', /if \(areas !== 'unknown' && denseShowsDistricts\(areas\.filter\(\(a\) => inView\(a, center, span\)\)\.length, span\.latitudeDelta\)\) \{\n\s*drawAreas\(visibleAreas\(areas\), 'district'\);\n\s*setPinCount\(areasTotal\(areas\)\);\n\s*return;/.test(web));
check('a close-in crowded bubble shows its count; zoomed-out dots stay plain (owner 2026-11-02)', /if \(counted && cell > 0 && row\.n > 1\) el\.textContent = areaCount\(row\.n, loc\);/.test(web) && /\(\) => element\(row, drawCell, cell === 0 && drawCell > 0\), \{/.test(web));
mustCatch('a bubble of 5,399 listings drawn as a blank dot at street zoom', /counted && cell > 0 && row\.n > 1/.test(web));
check('a bubble tap uses bubbleTapSpan (always in)', /const sp = bubbleTapSpan\(cell, m\.region\.span\.latitudeDelta\);/.test(web));
check('a tap on a label zooms into it', /if \(d && Math\.hypot\(e\.clientX - d\.x, e\.clientY - d\.y\) < 10\) \{ e\.stopPropagation\(\); pickArea\(a, level\); \}/.test(web));
check('the labels come through the bounded RPC and a failed read is unknown', /boundedRpc<AreaRow\[\]>\(supabase\.rpc\('map_areas_ar'/.test(data) && /if \(error \|\| !Array\.isArray\(data\)\) return 'unknown';/.test(data));
check('src/lib/mapAreas.ts is import-free (the barrier executes it in Node)', !/^import /m.test(readFileSync(join(root, 'src/lib/mapAreas.ts'), 'utf8')));
check('a committed migration builds map_area_ar (median positions) in the hourly refresh and serves map_areas_ar', readdirSync(join(root, 'supabase/migrations')).some((f) => { if (!/map_area_labels/.test(f)) return false; const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /create table if not exists public\.map_area_ar/.test(sql) && /percentile_cont\(0\.5\) within group \(order by k\.la\)/.test(sql) && /create or replace function public\.map_areas_ar\(/.test(sql) && /ops_public_secdef_allowlist/.test(sql); }));

if (failed) { console.error(`\n❌ verify-map-area-labels: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-area-labels: all checks passed');
