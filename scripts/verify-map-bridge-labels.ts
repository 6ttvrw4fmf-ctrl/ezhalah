// BRIDGE LABELS (owner 2026-11-04: «we need to make sure it's never ever slow»). Measured on ezhalah.com: a NEW map
// draws its first annotation ~3.0 s after creation whatever the map type (standard 3,046 ms, hybrid 3,053, satellite
// 3,065), and pre-drawing it off-screen or transparent did not shorten it, while convertCoordinateToPointOnPage answers
// at once. So the same labels are drawn by us over the map until Apple's appear. This barrier pins the bridge's
// contract: it is skipped when Apple already draws, placed through Apple's own projection with Apple's anchor and the
// same biggest-first priority, never overlapping, and it leaves when Apple's labels appear, when the map moves, on
// unmount, and after 6 s at most.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => check(`(mutation) catches ${name}`, caught);

const web = readFileSync(join(root, 'src/components/AppleMap.web.tsx'), 'utf8');
const ok = (src: string) =>
  /mine = \[\.\.\.keyed\.values\(\)\];\n\s*bridgeAreas\(\[\.\.\.next\.values\(\)\], level\);/.test(src)
  && /if \(!box \|\| !hostEl \|\| box\.querySelector\('\[data-testid=map-area\]'\)\) return;/.test(src)
  && /\.convertCoordinateToPointOnPage\.bind\(m\);/.test(src)
  && /el\.style\.transform = 'translate\(-50%, -100%\)';/.test(src)
  && /for \(const a of \[\.\.\.areas\]\.sort\(\(x, y\) => y\.n - x\.n\)\)/.test(src)
  && /placed\.some\(\(q\) => !\(r\.right < q\.left \|\| r\.left > q\.right \|\| r\.bottom < q\.top \|\| r\.top > q\.bottom\)\)/.test(src)
  && /if \(box\.querySelector\('\[data-testid=map-area\]'\) \|\| Date\.now\(\) - born > 6000\) clearBridge\(\);/.test(src)
  && /m\.addEventListener\('region-change-start', clearBridge\);/.test(src)
  && /offPanelsClose\(\);\n\s*clearBridge\(\);\n\s*m\.removeEventListener\('region-change-start', clearBridge/.test(src);
check('bridge labels: skipped when Apple draws, Apple projection + anchor, biggest first, no overlap, leave on time', ok(web));
mustCatch('a bridge that stays when the map moves (labels drift off their places)', !ok(web.replace("m.addEventListener('region-change-start', clearBridge);", '')));
mustCatch('a bridge drawn on top of Apple\'s own labels (double labels)', !ok(web.replace("if (!box || !hostEl || box.querySelector('[data-testid=map-area]')) return;", 'if (!box || !hostEl) return;')));
mustCatch('a bridge that never hands over', !ok(web.replace("|| Date.now() - born > 6000) clearBridge();", ') {}')));

if (failed) { console.error(`\n❌ verify-map-bridge-labels: ${failed} check(s) failed.`); process.exit(1); }
console.log('\nverify-map-bridge-labels: all checks passed');
