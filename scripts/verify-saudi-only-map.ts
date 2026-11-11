// THE MAP IS ABOUT SAUDI ARABIA ONLY (owner 2026-11-11: «just Saudi Arabia focus … not everything shows»). Measured
// live that day on a phone: the map's home view showed Iraq, Iran, Egypt, Syria and the UAE as brightly as the Kingdom,
// and could be dragged anywhere. The «خريطة» map now (src/components/AppleMap.web.tsx):
//   • fades every country around Saudi Arabia (one polygon with the Kingdom cut out, from public/ksa-outline.json);
//   • lets the fade go as the user zooms in, so a simplified border never fogs an ad on the coast or the border;
//   • keeps its centre near the Kingdom and stops zooming out a little past the home view.
// And on a phone the place search opens as a full-screen page (owner, same day: «I don't like how when you click
// search it shows like this») — src/components/MapDealRow.tsx.
//
// What this EXECUTES: the outline against the 13 region shapes and real cities (point-in-polygon), and the real
// maskStrength() lifted from the map. The wiring checks carry mutations.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
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
const lifted = await liftSymbols(join(ROOT, 'src/components/AppleMap.web.tsx'),
  [{ header: 'const MASK_FULL', endsWith: /^const MASK_GONE/ }, { header: 'export const maskStrength' }], ['maskStrength']);
const maskStrength = lifted.maskStrength as (ratio: number) => number;
check('fade: full at the home view and when zoomed out', maskStrength(1) === 1 && maskStrength(2) === 1);
check('fade: gone at a region-sized view and closer (no fog over coastal ads)', maskStrength(0.2) === 0 && maskStrength(0.05) === 0 && maskStrength(0.01) === 0);
check('fade: never grows as the user zooms in', [1, 0.6, 0.45, 0.4, 0.3, 0.25, 0.2, 0.1].every((r, i, a) => i === 0 || maskStrength(r) <= maskStrength(a[i - 1])));

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
const setup = (src: string) => win(src, 'map.cameraBoundary = ', 'ensureSaudiMask(mk, map);');
const helper = (src: string) => win(src, 'function ensureSaudiMask(', '/** INSTANT FIRST MAP');
const wired = (src: string) => ({
  boundary: /map\.cameraBoundary = new mk\.CoordinateRegion\(new mk\.Coordinate\(SAUDI_BOX_CENTER\.latitude, SAUDI_BOX_CENTER\.longitude\)/.test(src),
  // Set as the map is made, from the view it settled on — never inside the outline's .then (a zoom meanwhile would
  // become «home» and the user could not zoom back out to the Kingdom; review of #11818).
  zoom: /map\.cameraZoomRange = new mk\.CameraZoomRange\(0, map\.cameraDistance \* MAX_ZOOM_OUT\);/.test(setup(src)) && !/cameraZoomRange/.test(helper(src)),
  mask: /new mk\.PolygonOverlay\(\[world, \.\.\.holes\], \{\s*enabled: false,/.test(src) && /m\.addOverlay\(mask\)/.test(helper(src)),
  fades: /mask\.style\.fillOpacity = MASK_FADE \* k;/.test(src) && /const k = maskStrength\(m\.region\.span\.latitudeDelta \/ home\);/.test(src),
  // Tied to the map: a parked map still gets it, a return visit retries a failure, and a failure reaches Sentry.
  // The outline loader reports every failure itself — so the prewarm path (before the map opens) is covered too.
  retried: /ensureSaudiMask\(mkKept, kept\.map\);/.test(src) && /saudiMasked\.delete\(m\); reportError\(e, \{ where: 'map: Saudi fade' \}\)/.test(helper(src))
    && /\}\)\.catch\(\(\) => \{ saudiMasked\.delete\(m\); \}\);/.test(helper(src))
    && /\.catch\(\(e\) => \{ outlineLoad = null; reportError\(e, \{ where: 'map: Saudi outline' \}\); throw e; \}\);/.test(win(src, 'function loadOutline(', 'return outlineLoad;\n}'))
    && /void loadOutline\(\)\.catch\(\(\) => \{\}\);/.test(win(src, 'export function prewarmMap(', '\n}\n')),
  noGone: !/\bgone\b/.test(helper(src)),
});
const w = wired(map);
check('map: centre kept near the Kingdom (cameraBoundary)', w.boundary);
check('map: zoom-out stops past the home view (cameraZoomRange)', w.zoom);
check('map: the fade polygon is drawn, and never takes a tap (enabled: false)', w.mask);
check('map: the fade follows the zoom through maskStrength()', w.fades);
check('map: the fade belongs to the map — a return visit retries it, a failure is reported to Sentry', w.retried && w.noGone);
mustCatch('the zoom limit set inside the outline wait again', !wired(map.replace('      map.cameraZoomRange = new mk.CameraZoomRange(0, map.cameraDistance * MAX_ZOOM_OUT);\n', '').replace("    const onView = () => {", "    m.cameraZoomRange = new mk.CameraZoomRange(0, m.cameraDistance * MAX_ZOOM_OUT);\n    const onView = () => {")).zoom);
mustCatch('a return visit no longer retrying the fade', !wired(map.replace('ensureSaudiMask(mkKept, kept.map);', '')).retried);
mustCatch('an outline failure going unreported (the prewarm path included)', !wired(map.replace("outlineLoad = null; reportError(e, { where: 'map: Saudi outline' }); throw e;", 'outlineLoad = null; throw e;')).retried);
mustCatch('the fade polygon taking taps', !wired(map.replace(/enabled: false,(\s*style: new mk\.Style\(\{ fillColor: MASK_COLOR)/, 'enabled: true,$1')).mask);
mustCatch('the fade not following the zoom', !wired(map.replace('mask.style.fillOpacity = MASK_FADE * k;', 'mask.style.fillOpacity = MASK_FADE;')).fades);
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
console.log('\nSaudi-only map + phone search page: OK');
