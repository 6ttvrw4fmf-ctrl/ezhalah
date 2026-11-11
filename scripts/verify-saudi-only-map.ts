// THE MAP IS ABOUT SAUDI ARABIA ONLY (owner 2026-11-11: «just Saudi Arabia focus … not everything shows»). Measured
// live that day on a phone: the map's home view showed Iraq, Iran, Egypt, Syria and the UAE as brightly as the Kingdom,
// and could be dragged anywhere. The «خريطة» map now (src/components/AppleMap.web.tsx):
//   • keeps its centre near the Kingdom and stops zooming out a little past the home view;
//   • suggests ONLY places inside the Kingdom in its search (owner, later that day: «I don't like how it shows
//     highlighted in Saudi … what I meant was the search on top should only get Saudi») — every suggestion is checked
//     against public/ksa-outline.json (src/lib/saudiOutline.ts). The fade over the neighbours was REMOVED.
// And on a phone the place search opens as a full-screen page (owner, same day: «I don't like how when you click
// search it shows like this») — src/components/MapDealRow.tsx.
//
// What this EXECUTES: the outline against the 13 region shapes and real cities (point-in-polygon), and the real
// keepSaudiPlaces() the search runs, against Saudi and foreign places. The wiring checks carry mutations.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keepSaudiPlaces } from '../src/lib/saudiOutline.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `  — ${extra}`}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

type Ring = [number, number][];   // [lng, lat]
const outline = JSON.parse(read('public/ksa-outline.json')) as Ring[];
const regions = JSON.parse(read('public/ksa-regions.json')) as { en: string; rings: Ring[]; label: [number, number] }[];

const inRing = ([x, y]: [number, number], ring: Ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inSaudi = (p: [number, number]) => outline.some((r) => inRing(p, r));
const nearEdge = (p: [number, number], km: number) => outline.some((r) => r.some(([x, y]) => Math.hypot((x - p[0]) * 102, (y - p[1]) * 111) <= km));

console.log('\nThe map is about Saudi Arabia only\n');

// 1. The outline is the Kingdom: every region's label point is inside, and (almost) every region border point is inside
//    or within 3 km of the outline (the outline is a simplified union of the same shapes).
check('outline: one mainland ring plus islands, each a closed ring', outline.length >= 1 && outline.every((r) => r.length >= 4 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1]));
check('outline: all 13 region label points are inside it', regions.length === 13 && regions.every((r) => inSaudi(r.label)), regions.filter((r) => !inSaudi(r.label)).map((r) => r.en).join(', '));
const verts = regions.flatMap((r) => r.rings.flat());
const off = verts.filter((p) => !inSaudi(p) && !nearEdge(p, 3));
check(`outline: region border points inside or within 3 km (${verts.length - off.length}/${verts.length})`, off.length / verts.length < 0.01, `${off.length} off`);

// 2. Cities (incl. coast and border towns) sit inside the outline, and the fade is gone by city zoom anyway.
const CITIES: [string, number, number][] = [
  ['Riyadh', 46.72, 24.71], ['Jeddah', 39.17, 21.54], ['Makkah', 39.83, 21.42], ['Madinah', 39.61, 24.47], ['Dammam', 50.1, 26.42],
  ['Khobar', 50.21, 26.28], ['Tabuk', 36.57, 28.38], ['Abha', 42.51, 18.22], ['Jazan', 42.55, 16.89], ['Najran', 44.13, 17.49],
  ['Hail', 41.69, 27.52], ['Arar', 41.04, 30.98], ['Haql', 34.94, 29.29], ['Al Khafji', 48.49, 28.42], ['Yanbu', 38.06, 24.09],
];
const outside = CITIES.filter(([, x, y]) => !inSaudi([x, y]));
check('cities: 15 cities incl. coast and border towns are inside the outline', outside.length === 0, outside.map((c) => c[0]).join(', '));
const map = read('src/components/AppleMap.web.tsx');
const at = (name: string, lng: number, lat: number) => ({ name, coordinate: { latitude: lat, longitude: lng } });
const saudiPlaces = CITIES.map(([n, x, y]) => at(n, x, y));
const FOREIGN = [at('Dubai', 55.27, 25.2), at('Baghdad', 44.36, 33.31), at('Cairo', 31.24, 30.04), at('Amman', 35.93, 31.95), at('Kuwait City', 47.98, 29.37),
  at('Manama', 50.58, 26.23), at('Doha', 51.53, 25.29), at('Sanaa', 44.21, 15.35), at('Basra', 47.78, 30.51), at('Aqaba', 35.0, 29.53)];
const kept = keepSaudiPlaces([...saudiPlaces, ...FOREIGN], outline).map((p) => p.name);
check('search: every Saudi city stays a suggestion', saudiPlaces.every((p) => kept.includes(p.name)));
check('search: no foreign place is suggested (Dubai, Baghdad, Cairo, Amman, Kuwait, Manama, Doha, Sanaa, Basra, Aqaba)', FOREIGN.every((p) => !kept.includes(p.name)), FOREIGN.filter((p) => kept.includes(p.name)).map((p) => p.name).join(', '));
check('search: a place with no coordinate is dropped; with no outline, Apple\'s Saudi-only answer stands', keepSaudiPlaces([{ name: 'x' }], outline).length === 0 && keepSaudiPlaces(FOREIGN, null).length === FOREIGN.length);
const searchWired = (src: string) => /live\.search = new mk\.Search\(\{ language, limitToCountries: 'SA', includePointsOfInterest: true \}\);/.test(src)
  && /const rings = await loadOutline\(\)\.catch\(\(\) => null\);\n\s*const out = keepSaudiPlaces\(sortByKind\(dropAreaShadows\(dedupePlaces\(places\.length \? places : named\)\), query\), rings\)\.slice\(0, 6\);/.test(src);
check('search: Apple is asked for Saudi places, and every suggestion passes the outline before it is shown', searchWired(map));
mustCatch('the outline check removed from the search', !searchWired(map.replace('keepSaudiPlaces(sortByKind(', '((x: unknown[]) => x)(sortByKind(')));
const routeWired = (src: string) => /export async function suggestPlaces\(q: string, uiLanguage: string\): Promise<PlaceSuggestion\[\]> \{\n  return \(await suggestPlacesResult\(q, uiLanguage\)\)\.rows;/.test(src);
check('search: the route fields ask the same Saudi-only lookup (suggestPlaces → suggestPlacesResult)', routeWired(map));
mustCatch('a route lookup that bypasses the Saudi check', !routeWired(map.replace('return (await suggestPlacesResult(q, uiLanguage)).rows;', 'return [];')));
const noFade = (src: string) => !/ensureSaudiMask|MASK_FADE|new mk\.PolygonOverlay\(\[world/.test(src);
check('map: no fade over the neighbouring countries (owner 2026-11-11)', noFade(map));
mustCatch('the fade coming back', !noFade(map + '\nensureSaudiMask(mk, map);'));

// 3. Wiring in the map, each with a mutation.
// The camera box: every city must be centrable (CodeRabbit on #11818: the first box shut out Tabuk, Jazan, Haql).
const num = (name: string, field: string) => Number(map.match(new RegExp(`const ${name} = \\{[^}]*${field}: ([\\d.]+)`))?.[1]);
const box = { lat: num('SAUDI_BOX_CENTER', 'latitude'), lng: num('SAUDI_BOX_CENTER', 'longitude'), dLat: num('SAUDI_CENTRE_BOX', 'latitudeDelta'), dLng: num('SAUDI_CENTRE_BOX', 'longitudeDelta') };
const inBox = (b: typeof box, x: number, y: number) => Math.abs(y - b.lat) <= b.dLat / 2 && Math.abs(x - b.lng) <= b.dLng / 2;
const shutOut = (b: typeof box) => CITIES.filter(([, x, y]) => !inBox(b, x, y)).map((c) => c[0]);
check('camera box: read from the map source', Object.values(box).every((v) => Number.isFinite(v) && v > 0));
check('camera box: all 15 cities can be centred (Haql, Tabuk, Jazan, Arar, Al Khafji included)', shutOut(box).length === 0, shutOut(box).join(', '));
mustCatch('the first, too-small box (±6° × ±7° around 23.5, 45.5)', shutOut({ lat: 23.5, lng: 45.5, dLat: 12, dLng: 14 }).length > 0);

// A missing marker reads as «not wired» (windowBetween throws), never as the rest of the file.
const win = (src: string, start: string, end: string) => { try { return windowBetween(src, start, end, 'AppleMap.web.tsx'); } catch { return ''; } };
const setup = (src: string) => win(src, 'map.cameraBoundary = ', '// The 13 regions:');
const wired = (src: string) => ({
  boundary: /map\.cameraBoundary = new mk\.CoordinateRegion\(new mk\.Coordinate\(SAUDI_BOX_CENTER\.latitude, SAUDI_BOX_CENTER\.longitude\)/.test(src),
  // Set as the map is made, from the view it settled on — never inside the outline's .then (a zoom meanwhile would
  // become «home» and the user could not zoom back out to the Kingdom; review of #11818).
  zoom: /map\.cameraZoomRange = new mk\.CameraZoomRange\(0, map\.cameraDistance \* MAX_ZOOM_OUT\);/.test(setup(src)),
  outlineReported: /\.catch\(\(e\) => \{ outlineLoad = null; reportError\(e, \{ where: 'map: Saudi outline' \}\); throw e; \}\);/.test(win(src, 'function loadOutline(', 'return outlineLoad;\n}'))
    && /void loadOutline\(\)\.catch\(\(\) => \{\}\);/.test(win(src, 'export function prewarmMap(', '\n}\n')),
});
const w = wired(map);
check('map: centre kept near the Kingdom (cameraBoundary)', w.boundary);
check('map: zoom-out stops past the home view (cameraZoomRange)', w.zoom);
check('map: the outline loads early and a failure reaches Sentry', w.outlineReported);
mustCatch('the zoom limit removed', !wired(map.replace('      map.cameraZoomRange = new mk.CameraZoomRange(0, map.cameraDistance * MAX_ZOOM_OUT);\n', '')).zoom);
mustCatch('an outline failure going unreported (the prewarm path included)', !wired(map.replace("outlineLoad = null; reportError(e, { where: 'map: Saudi outline' }); throw e;", 'outlineLoad = null; throw e;')).outlineReported);
mustCatch('the boundary removed', !wired(map.replace('map.cameraBoundary = ', 'void ')).boundary);

// 4. The phone's full-screen search.
const row = read('src/components/MapDealRow.tsx');
const search = (src: string) => ({
  opts: /testID="map-search"\s*fullOnPhone\s*\/>/.test(src),
  opens: /onFocus=\{\(\) => \{ setFocused\(true\); if \(fullOnPhone && phone\) setFullOpen\(true\); \}\}/.test(src),
  stays: /const open = \(focused \|\| full\) && hits\.length > 0;/.test(src),
  cancel: /onPress=\{cancel\}/.test(src) && /const cancel = \(\) => \{ setFullOpen\(false\);/.test(src),
  pickCloses: /setFullOpen\(false\); inputRef\.current\?\.blur\(\); onPick\(p\);/.test(src),
  // A failed lookup shows «البحث غير متاح الآن» + «حاول مرة أخرى», never the «nothing found» line (review of #11818).
  failedShown: /setStatus\(r\.failed \? 'failed' : 'done'\)/.test(src) && /status === 'failed' \? \(/.test(src) && /onPress=\{\(\) => setRetry\(\(n\) => n \+ 1\)\}/.test(src) && /\[q, locale, value, retry\]\);/.test(src),
  // The list scrolls on the phone page only (a scroll box would clip the desktop dropdown's absolute position).
  scrolls: /\{full && list \? \(\s*<ScrollView style=\{s\.fullScroll\}/.test(src) && /\) : list\}/.test(src),
});
const lookup = (src: string) => /if \(err \|\| !data\) \{ lookupFailed = true; reportError\(err \?\? new Error\('autocomplete returned no data'\), \{ where: 'map search: autocomplete' \}\); resolve\(\[\]\); return; \}/.test(src) && /if \(lookupFailed\) return \{ rows: \[\], failed: true \};/.test(src)
  && /try \{ mk = await loadMapKit\(\); \} catch \(e\) \{ reportError\(e, \{ where: 'map search: MapKit did not load' \}\); return \{ rows: \[\], failed: true \}; \}/.test(src);
const r0 = search(row);
check('phone search: the map\'s search field opts in to the full-screen page', r0.opts);
check('phone search: a tap opens it; a pick and «إلغاء» close it', r0.opens && r0.cancel && r0.pickCloses);
check('phone search: the list stays while the page is open even with the keyboard hidden', r0.stays);
check('phone search: a failed lookup says so, with «حاول مرة أخرى» (never «no places»)', r0.failedShown && lookup(map));
check('phone search: the list scrolls on the phone page, the desktop dropdown is untouched', r0.scrolls);
mustCatch('an autocomplete error read as an empty answer again', !lookup(map.replace("if (err || !data) { lookupFailed = true; reportError(", "if (err || !data) { reportError(")));
mustCatch('an autocomplete error not reported to Sentry', !lookup(map.replace("lookupFailed = true; reportError(err ?? new Error('autocomplete returned no data'), { where: 'map search: autocomplete' }); ", 'lookupFailed = true; ')));
mustCatch('a failed lookup shown as «nothing found»', !search(row.replace("setStatus(r.failed ? 'failed' : 'done')", "setStatus('done')")).failedShown);
mustCatch('the list closing on blur again', !search(row.replace('const open = (focused || full) && hits.length > 0;', 'const open = focused && hits.length > 0;')).stays);
mustCatch('the map search no longer opting in', !search(row.replace(/testID="map-search"\s*fullOnPhone/, 'testID="map-search"')).opts);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nSaudi-only search + phone search page: OK');
