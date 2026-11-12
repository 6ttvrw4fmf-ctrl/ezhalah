// A straight drag on the map is not an area (2026-11-12, found live on ezhalah.com: a line was accepted as a
// boundary and showed «0 إعلان داخل الحدود»). Executes the real rule, then checks the map uses it at finger-lift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRealDrawnArea, drawnAreaPx } from '../src/lib/drawnArea.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; };

const mustCatch = (name: string, mutantPasses: () => boolean) => check(`(mutation) catches ${name}`, !mutantPasses());

const line = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 10, y: 200 + i * 6 }));
const wobbly = Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 10, y: 200 + (i % 2) }));
const circle = Array.from({ length: 40 }, (_, i) => ({ x: 300 + 80 * Math.cos(i / 40 * 2 * Math.PI), y: 300 + 80 * Math.sin(i / 40 * 2 * Math.PI) }));
const tiny = Array.from({ length: 12 }, (_, i) => ({ x: 300 + 8 * Math.cos(i / 12 * 2 * Math.PI), y: 300 + 8 * Math.sin(i / 12 * 2 * Math.PI) }));

check('a straight drag is NOT an area', !isRealDrawnArea(line), `${drawnAreaPx(line)} px²`);
check('a shaky straight drag is NOT an area', !isRealDrawnArea(wobbly), `${drawnAreaPx(wobbly)} px²`);
check('a speck smaller than a fingertip is NOT an area', !isRealDrawnArea(tiny), `${Math.round(drawnAreaPx(tiny))} px²`);
check('a real loop IS an area', isRealDrawnArea(circle), `${Math.round(drawnAreaPx(circle))} px²`);
check('the same loop drawn the other way round IS an area', isRealDrawnArea([...circle].reverse()));
check('two points are never an area', !isRealDrawnArea(circle.slice(0, 2)));

const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const wired = (src: string) => /import \{ isRealDrawnArea \} from '@\/lib\/drawnArea'/.test(src)
  && /if \(isRealDrawnArea\(pagePts\)\) \{\s*(?:\/\/[^\n]*\n\s*)*const coords/.test(src)
  && /pagePts\.push\(last\)/.test(src) && /pagePts = \[last\]/.test(src);
check('the map measures the stroke at finger-lift before it becomes a shape', wired(web));
mustCatch('the old «any 3 points is a shape» rule', () => wired(web.replace('if (isRealDrawnArea(pagePts)) {', 'if (pts.length >= 3) {')));
mustCatch('a rule that only counts points (a straight drag would pass)', () => { const pointsOnly = (pts: unknown[]) => pts.length >= 3; return !pointsOnly(line) && pointsOnly(circle); });

console.log(failed ? `\n${failed} check(s) FAILED` : '\nverify-drawn-line-is-not-an-area: all checks passed');
process.exit(failed ? 1 : 0);
