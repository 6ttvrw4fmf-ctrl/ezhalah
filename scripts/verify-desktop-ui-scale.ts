// Desktop UI scale — REVERTED to strict 1:1 (owner decision, 2026-08-14 23:47, supersedes the
// same-day "too small and zoomed out" report this barrier originally enforced).
//
// HISTORY, so the next session doesn't relitigate it: a media-gated `zoom` layer on <body>
// (1.1/1.2/1.3 tiered by viewport width) shipped on 2026-08-14 to enlarge the mobile-first px
// design on desktops, and THIS script then pinned its presence. The same evening the owner,
// looking at production on a MacBook, ruled it "too zoomed in — keep it normal", with screenshot.
// The current owner call wins, so the barrier now pins the ABSENCE of any viewport scaling:
// no `zoom`, no `transform: scale`, no font-size percentage inflation in the web shell.
//
// If desktop sizing ever comes back, do it with real typography/spacing tokens per component —
// not a blanket body scale — and update this barrier deliberately in that PR.
//
//   node --experimental-strip-types scripts/verify-desktop-ui-scale.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src/app/+html.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

check('no body zoom rule survives in the web shell (owner 2026-08-14: "keep it normal")',
  !/zoom:\s*[\d.]+/.test(html));
check('no transform:scale substitute snuck in',
  !/transform:\s*scale/.test(html));
check('no font-size percentage inflation substitute',
  !/font-size:\s*1[1-9]\d%/.test(html));
check('the viewport meta stays standard initial-scale=1',
  /initial-scale=1/.test(html));
check('the revert is documented in place, so the next "too small" report finds the history',
  /REVERTED to 1:1/.test(html));

console.log(failed === 0 ? '\n✓ desktop-ui-scale barrier: 1:1 confirmed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
