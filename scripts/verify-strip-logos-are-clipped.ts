// The home website strip's logos must never spill onto each other (owner iPhone screenshot 2026-10-17:
// وصلت / عقار / البوقري logos drawn on top of one another in the moving strip).
//
// Some logos are laid out LARGER than their 96×48 frame (the layout crops each image's transparent
// padding), so the frame's clip is load-bearing. iOS Safari does not honour overflow:hidden on a
// child of an animated, composited track — the frame must also carry clip-path (which WebKit does
// apply to composited children). This check measures the oversize set from the real layout data and
// requires the web frame to carry that clip while any oversize logo exists.
import { readFileSync } from 'node:fs';

const layout = JSON.parse(readFileSync(new URL('../src/data/platformPickerLogoLayout.json', import.meta.url), 'utf8')) as Record<string, { width: number; height: number; left: number; top: number }>;
const FRAME_W = 96, FRAME_H = 48;
const oversize = Object.entries(layout).filter(([, v]) => v.left < 0 || v.top < 0 || v.left + v.width > FRAME_W || v.top + v.height > FRAME_H).map(([k]) => k);

const web = readFileSync(new URL('../src/components/HomeWebsiteStrip.web.tsx', import.meta.url), 'utf8');
const frame = web.match(/<div style=\{\{ position: 'relative', width: 96, height: 48,[^\n]*/)?.[0] ?? '';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

check(`the 96×48 logo frame is found in HomeWebsiteStrip.web.tsx`, frame.length > 0);
check(`oversize logos measured from the layout data (${oversize.length})`, Object.keys(layout).length > 0);
const clips = (src: string) => /clipPath: 'inset\(0\)'/.test(src) && /overflow: 'hidden'/.test(src);
check('the frame clips with clip-path as well as overflow (iOS Safari ignores overflow alone here)', oversize.length === 0 || clips(frame));
// Mutation proof: the pre-fix frame (overflow only) must be refused by the same predicate.
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
mustCatch('an overflow-only frame (the pre-fix iPhone overlap)', !clips(`<div style={{ position: 'relative', width: 96, height: 48, backgroundColor: 'transparent', overflow: 'hidden' }}>`));

console.log(failed === 0 ? '\n✓ strip logos are clipped to their frames' : `\n✗ ${failed} strip clip check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
