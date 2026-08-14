// Desktop UI scale — the mobile-first px design must stay 1:1 on phones/tablets and gain a
// calibrated, tiered scale on desktop (owner report 2026-08-14: "on a computer the entire interface
// feels too small and too zoomed out; mobile is perfect — do not change mobile").
//
// The scale layer lives in src/app/+html.tsx as media-gated `zoom` rules on <body>. This barrier
// pins the properties that make it CORRECT rather than the exact numbers:
//   • every zoom rule is inside a min-width media query of >= 1024px — so phones and tablets can
//     never be scaled, by construction;
//   • zoom values are sane (1.0 < z <= 1.4) — enough to fix "too small", incapable of "comically
//     oversized";
//   • tiers are monotonic (a wider viewport never gets a SMALLER scale);
//   • the layer keeps using `zoom` (which reflows layout) and not `transform: scale` (which does
//     not, and would break scrolling/hit-targets).
//
//   node --experimental-strip-types scripts/verify-desktop-ui-scale.ts    (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nDesktop UI scale — phones untouched, desktop tiers calibrated\n');

const html = readFileSync(join(import.meta.dirname, '..', 'src', 'app', '+html.tsx'), 'utf8');

// Collect every zoom declaration and the media query that encloses it.
const tierRe = /@media\s*\(\s*min-width:\s*(\d+)px\s*\)\s*\{\s*body\s*\{\s*zoom:\s*([\d.]+)\s*;?\s*\}\s*\}/g;
const tiers: Array<{ minWidth: number; zoom: number }> = [];
for (let m; (m = tierRe.exec(html)); ) tiers.push({ minWidth: +m[1], zoom: +m[2] });

check('at least 2 desktop scale tiers exist', tiers.length >= 2, `found ${tiers.length}`);

// Any `zoom:` in the file outside the tier pattern would be an un-gated (possibly mobile-reaching)
// scale — count raw occurrences and require them all to be tier-pattern matches.
const rawZoomCount = (html.match(/zoom:/g) ?? []).length;
check('every zoom rule is media-gated (no bare/global zoom that could reach mobile)',
  rawZoomCount === tiers.length, `raw zoom: count ${rawZoomCount} vs gated tiers ${tiers.length}`);

for (const t of tiers) {
  check(`tier @${t.minWidth}px: breakpoint is desktop-only (>= 1024px)`, t.minWidth >= 1024);
  check(`tier @${t.minWidth}px: zoom ${t.zoom} is sane (1.0 < z <= 1.4)`, t.zoom > 1.0 && t.zoom <= 1.4);
}

const sorted = [...tiers].sort((a, b) => a.minWidth - b.minWidth);
check('tiers are monotonic (wider viewport never scales SMALLER)',
  sorted.every((t, i) => i === 0 || t.zoom >= sorted[i - 1].zoom));

check('scale uses zoom (reflows layout), not transform:scale (would break scroll/hit-targets)',
  !/transform:\s*scale\s*\(/.test(html));

console.log(failures === 0
  ? '\n✓ desktop UI scale intact: mobile untouched, desktop tiers calibrated\n'
  : `\n✗ ${failures} check(s) FAILED — the desktop sizing fix is not intact\n`);
process.exit(failures === 0 ? 0 : 1);
