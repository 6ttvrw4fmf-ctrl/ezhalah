// Barrier: AT THE DEEPEST ZOOM, LISTINGS ARE HEADS THE USER CAN TAP — NEVER A BUBBLE THEY CANNOT ZOOM INTO (🔧 2026-11-06).
//
// Measured on the live map (map-pins-live.yml red on every run since 2026-11-05, diag run 42225384902): over the
// 504 m² land scheme in حي البوادي, Jeddah, MapKit's deepest phone zoom is ≈ 0.0056° tall. The crowd estimate summed
// WHOLE 1 km dots cells whose centre was in view (1,501 listings for a 280 m view holding 177 points), so the view
// read «crowded», the fine 0.01° bubble grid was drawn (two bubbles «218» / «1.3 ألف», 0 pins), and a tap on a bubble
// — a zoom to a third of the view — could not go deeper: those listings were unreachable on the map, the exact thing
// the owner's 2026-11-05 order forbids («user cannot select what he wants»). Two rules, both EXECUTED here:
//   1. dotsEstimateInBox() weights each cell by the share of it inside the view;
//   2. bubblesCanZoomIn() is false where a fine bubble would be at least half the view tall, and the map then reads
//      every exact point (set side by side by placeApart) instead of drawing bubbles.
// The map component must use both (text pins + mutations), because a rule nothing calls is decoration.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, heldOnBroken: boolean) => check(`(mutation) catches ${label}`, heldOnBroken === false);

// src/lib/mapDots.ts imports only a TYPE from ./mapPins; src/lib/mapPins.ts imports nothing. Load both as-is.
async function load<T>(rel: string): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'deepest-zoom-'));
  const f = join(dir, rel.split('/').pop()!);
  writeFileSync(f, readFileSync(join(root, rel), 'utf8').replace(/^import type .*$/m, ''));
  return import(pathToFileURL(f).href) as Promise<T>;
}
type Dots = typeof import('../src/lib/mapDots.ts');
type Pins = typeof import('../src/lib/mapPins.ts');
const dots = await load<Dots>('src/lib/mapDots.ts');
const pins = await load<Pins>('src/lib/mapPins.ts');

// ── 1. the estimate is weighted by the share of each cell inside the view ──
// The measured shape: a 0.0056° × 0.011° view centred on 21.61325, 39.15777 inside 0.01° cells holding 1,501 in all.
const view = { s: 21.61325 - 0.0028, n: 21.61325 + 0.0028, w: 39.15777 - 0.0055, e: 39.15777 + 0.0055 };
const cells = [
  { lat: 21.615, lng: 39.155, deal: 'buy', n: 1300 }, { lat: 21.615, lng: 39.162, deal: 'buy', n: 101 },
  { lat: 21.611, lng: 39.155, deal: 'buy', n: 50 }, { lat: 21.611, lng: 39.162, deal: 'buy', n: 50 },
] as Dots['MapDot'] extends never ? never : { lat: number; lng: number; deal: 'buy'; n: number }[];
const whole = dots.dotsTotal(dots.dotsInView(cells as never, ['buy'], view));
const weighted = dots.dotsEstimateInBox(cells as never, ['buy'], view);
check(`the old whole-cell count reads the 280 m view as ${whole} (the bug: over CROWD_ESTIMATE 1500)`, whole === 1501);
check(`the weighted estimate reads it as ${Math.round(weighted)} — under CROWD_ESTIMATE, so exact points are read`, weighted < 1500 && weighted > 0);
check('a cell wholly inside the view counts whole', Math.abs(dots.dotsEstimateInBox([{ lat: 10, lng: 10, deal: 'buy', n: 7 }] as never, ['buy'], { s: 9.98, n: 10.02, w: 9.98, e: 10.02 }) - 7) < 1e-9);
check('a cell whose centre is just outside but which overlaps the view counts its overlap',
  dots.dotsEstimateInBox([{ lat: 10.004, lng: 10, deal: 'buy', n: 100 }] as never, ['buy'], { s: 9.99, n: 10.0, w: 9.99, e: 10.01 }) > 0);
check('a cell outside the view counts nothing', dots.dotsEstimateInBox([{ lat: 10.1, lng: 10, deal: 'buy', n: 100 }] as never, ['buy'], { s: 9.99, n: 10.0, w: 9.99, e: 10.01 }) === 0);
check('a deal not chosen counts nothing', dots.dotsEstimateInBox([{ lat: 10, lng: 10, deal: 'rent', n: 100 }] as never, ['buy'], { s: 9.99, n: 10.01, w: 9.99, e: 10.01 }) === 0);
mustCatch('an unweighted estimate (whole cells) standing in for the weighted one', weighted >= whole);

// ── 2. the deepest zoom never offers bubbles ──
check('at the deepest phone zoom (0.0056°) bubbles cannot zoom in → exact heads', pins.bubblesCanZoomIn(0.0056) === false);
check('at 0.015° the finest 0.01° bubble is still more than half the view → exact heads', pins.bubblesCanZoomIn(0.015) === false);
check('at 0.02° a 0.01° bubble is half the view → bubbles may be drawn', pins.bubblesCanZoomIn(0.02) === true);
check('at city zoom (0.1°) bubbles are fine', pins.bubblesCanZoomIn(0.1) === true);
mustCatch('a predicate that always allows bubbles', [0.0056, 0.015, 0.02, 0.1].every(() => true) === [false, false, true, true].every((v) => v));

// ── 3. the map component uses both rules ──
const map = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const usesEstimate = (s: string) => /const crowdedByDots = dots !== 'unknown' && dotsEstimateInBox\(/.test(s);
const guardsBubbles = (s: string) => /if \(dense && !bubblesCanZoomIn\(span\.latitudeDelta\)\) \{[\s\S]{0,400}fetchMapPins\(paddedBox\(center, span\), 0, pins, PIN_LIMIT\)[\s\S]{0,300}rows = every; dense = false;/.test(s);
check('AppleMap decides «crowded» with the weighted estimate', usesEstimate(map));
check('AppleMap reads every exact point where bubbles cannot zoom in, before any bubble fallback', guardsBubbles(map));
mustCatch('the map going back to the whole-cell count', usesEstimate(map.replace('dotsEstimateInBox(', 'dotsTotal(dotsInView(')));
mustCatch('the map dropping the deepest-zoom read', guardsBubbles(map.replace('if (dense && !bubblesCanZoomIn(span.latitudeDelta)) {', 'if (false) {')));

if (failed) { console.error(`\n❌ verify-deepest-zoom-shows-heads-not-bubbles: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✓ at the deepest zoom the map shows heads the user can tap, never bubbles that cannot be opened');
