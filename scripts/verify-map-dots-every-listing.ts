// EVERY LISTING'S SPOT AT ANY ZOOM — THE DOTS FEED AND THE CANVAS (owner 2026-11-02: «can you do it in a way that
// even when I am zoomed out they all show?»). Zoomed out with no narrowing, the map paints every pinned listing's 1 km
// cell on a canvas from one feed (map_dots_ar(), rebuilt hourly). This barrier EXECUTES the pure rules (the feed's
// parse, the deal/box filter, the count, the Mercator projection calibrated on two map-placed points, the tap pick)
// with mutation proofs, and pins the wiring by shape: the feed is read once and cached, a failed feed keeps the live
// grid path (never an empty map), the canvas hides while the map moves and repaints when it settles.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDots, dotsInView, dotsTotal, mercY, projectorFrom, dotRadius, nearestDot, bubblesFromDots } from '../src/lib/mapDots.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

// ── the feed's shape ──────────────────────────────────────────────────────────────────────────────────────────────
const feed = [[24.7, 46.7, 0, 12], [21.5, 39.2, 1, 3], [26.3, 50.2, 2, 1], [1, 2], ['x', 46, 0, 1], [24.1, 46.1, 7, 2], [24.2, 46.2, 0, 0]];
const dots = parseDots(feed);
check('parseDots reads [lat, lng, deal, n] rows and maps 0/1/2 → buy/rent/short', dots.length === 3 && dots[0].deal === 'buy' && dots[1].deal === 'rent' && dots[2].deal === 'short' && dots[0].n === 12);
check('a short row, a non-number, an unknown deal code and a zero count are dropped, never invented', dots.every((d) => Number.isFinite(d.lat) && d.n > 0));
check('a non-array feed parses to nothing', parseDots({ rows: 3 }).length === 0 && parseDots(null).length === 0);
mustCatch('an unknown deal code kept as a dot', !parseDots([[24, 46, 9, 1]]).length);

// ── deal + box filter, count ──────────────────────────────────────────────────────────────────────────────────────
const box = { s: 20, w: 38, n: 27, e: 52 };
check('dotsInView keeps the chosen deals inside the box', dotsInView(dots, ['buy'], box).length === 1 && dotsInView(dots, ['buy', 'rent', 'short'], box).length === 3 && dotsInView(dots, ['buy'], { s: 25, w: 38, n: 27, e: 52 }).length === 0);
check('dotsTotal is the sum of the listings the dots stand for (the count pill)', dotsTotal(dots) === 16 && dotsTotal([]) === 0);
mustCatch('a deal filter that keeps everything', dotsInView(dots, ['rent'], box).length === 1);

// ── projection ────────────────────────────────────────────────────────────────────────────────────────────────────
check('mercY is monotonic north → smaller and clamped at the poles', mercY(30) < mercY(20) && Number.isFinite(mercY(89)) && mercY(89) === mercY(85.05));
const a = { lat: 26, lng: 44, x: 100, y: 100 }; const b = { lat: 22, lng: 48, x: 300, y: 350 };
const project = projectorFrom(a, b)!;
check('the projector returns the two calibration points exactly', !!project && project(26, 44).every((v, i) => Math.abs(v - [100, 100][i]) < 1e-9) && project(22, 48).every((v, i) => Math.abs(v - [300, 350][i]) < 1e-9));
check('the projector is linear in longitude and Mercator in latitude (a midpoint lands between, not at the linear middle)', (() => { const [x, y] = project(24, 46); return Math.abs(x - 200) < 1e-9 && y > 100 && y < 350 && Math.abs(y - 225) > 0.5; })());
check('two reference points on one line yield no projector (never a wrong picture)', projectorFrom(a, { ...a, x: 5 }) === null && projectorFrom(a, { lat: 26, lng: 48, x: 300, y: 350 }) === null);
mustCatch('a latitude-linear projector (dots drift off Apple\'s map between the two points)', Math.abs(project(24, 46)[1] - 225) > 0.5);

// ── dot size and tap pick ─────────────────────────────────────────────────────────────────────────────────────────
check('dots are a whisper over the country and clearer near a city', dotRadius(17) < dotRadius(5) && dotRadius(5) < dotRadius(1) && dotRadius(1) <= 3);
const near = nearestDot(dots, project, project(24.7, 46.7)[0] + 3, project(24.7, 46.7)[1] - 2);
check('nearestDot picks the dot under the tap and nothing far away', near?.lat === 24.7 && nearestDot(dots, project, -500, -500) === null);
mustCatch('a tap on empty map picking some dot anyway', nearestDot(dots, project, -500, -500) === null);

// ── wiring ────────────────────────────────────────────────────────────────────────────────────────────────────────
const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const data = readFileSync(join(root, 'src/data/mapDots.ts'), 'utf8');
check('the feed is read once per session through the bounded RPC and cached; an empty feed is a failed build', /boundedRpc<unknown>\(supabase\.rpc\('map_dots_ar'\)/.test(data) && /if \(cache\) return Promise\.resolve\(cache\)/.test(data) && /if \(!dots\.length\) return 'unknown'/.test(data));
check('zoomed out with no narrowing, the map paints the dots in view on the canvas and counts them', /if \(cell > 0 && !narrowed\) \{\n\s*const all = await fetchMapDots\(\);/.test(web) && /const inView = dotsInView\(all, pins\.deals, paddedBox\(center, span\)\);/.test(web) && /if \(paint\(inView\)\) \{ setPinCount\(dotsTotal\(inView\)\); return; \}/.test(web));
check('a failed feed falls through to the live grid path (never an empty map)', /if \(all !== 'unknown'\) \{/.test(web) && /hideCanvas\(\); shown = \[\];/.test(web));
check('the canvas hides while the map moves and is removed with the layer', /m\.addEventListener\('region-change-start', hideCanvas\)/.test(web) && /canvas\.remove\(\);/.test(web));
check('the projection is calibrated on two points MapKit itself placed on the page', /convertCoordinateToPointOnPage/.test(web) && /project = projectorFrom\(ref\(/.test(web));
check('a tap on a dot zooms into it through the shared pick', /onSurface\(m, 'click', onCanvasTap\)/.test(web) && /const d = nearestDot\(shown, project,/.test(web));
check('narrowing (category, type, beds, area, price, polygon) keeps the live filtered path', /const narrowed = !!\(pins\.category \|\| pins\.scope \|\| pins\.furnished != null \|\| pins\.postedWithinDays != null \|\| pins\.types\?\.length \|\| pins\.beds\?\.length/.test(web));
check('src/lib/mapDots.ts is import-free apart from a type (the barrier executes it in Node)', !/^import (?!type )/m.test(readFileSync(join(root, 'src/lib/mapDots.ts'), 'utf8')));
check('a committed migration creates map_dots_ar() from the 0.01° grid and allowlists it', readdirSync(join(root, 'supabase/migrations')).some((f) => { if (!/map_dots_feed/.test(f)) return false; const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8'); return /create or replace function public\.map_dots_ar\(\)/.test(sql) && /where g\.cell = 0\.01/.test(sql) && /ops_public_secdef_allowlist/.test(sql); }));

// SMOOTH (owner 2026-11-03): the crowded street-zoom bubbles are built on the phone from the dots feed — every listing
// counted once, one bubble per 0.01° cell, deals merged into «mixed».
{
  const ds = [{ lat: 21.6141, lng: 39.1421, deal: 'buy' as const, n: 900 }, { lat: 21.6139, lng: 39.1419, deal: 'rent' as const, n: 19 }, { lat: 21.6302, lng: 39.1501, deal: 'buy' as const, n: 415 }];
  const bs = bubblesFromDots(ds);
  check('bubblesFromDots: one bubble per cell, every listing counted once', bs.length === 2 && bs.reduce((a, b) => a + b.n, 0) === dotsTotal(ds));
  check('bubblesFromDots: two deals in one cell read «mixed», one deal keeps its own', bs.some((b) => b.n === 919 && b.deal === 'mixed') && bs.some((b) => b.n === 415 && b.deal === 'buy'));
  mustCatch('a bubble that drops a deal\'s listings', bs.find((b) => b.deal === 'mixed')?.n !== 900);
}

if (failed) { console.error(`\n❌ verify-map-dots-every-listing: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-dots-every-listing: all checks passed');
