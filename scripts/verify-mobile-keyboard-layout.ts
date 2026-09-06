#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-mobile-keyboard-layout — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * OWNER REPORT, 2026-09-05 (iPhone Safari): opening the keyboard "basically loses the conversation
 * above it". The composer looked right, which is why this did not read as a keyboard bug.
 *
 * WHAT WAS ACTUALLY WRONG, measured on the live site before any code changed. iOS does TWO things
 * when the keyboard opens, and the app only handled the first:
 *   1. the visual viewport shrinks (window.innerHeight does NOT), and
 *   2. Safari SCROLLS the layout viewport, so visualViewport.offsetTop becomes > 0.
 * Compensating only for (1) with per-screen padding put the composer in the right place while the
 * whole page slid up underneath the visible window:
 *   390x844, 336px keyboard, Safari scrolled 150 → visible window [150, 658], messages 120–538:
 *   clipped 30px at the top, header entirely gone. After pinning the root: messages 270–352, inside.
 *
 * The second half was forced by the same measurement: with the root pinned, a screen that ALSO pads
 * for the keyboard lifts twice — live, the composer floated 259px up where 73px was correct.
 *
 * This barrier EXECUTES the real geometry from lib/visualViewportFrame.ts across a matrix of iPhone
 * sizes, keyboard heights and Safari scroll offsets, and pins the wiring that makes it reachable.
 */
import { readFileSync } from 'node:fs';
import { rootFrame, coversVisibleWindow, screenKeyboardInset, composerBottomWithin } from '../src/lib/visualViewportFrame.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// Real iPhone CSS viewports × real keyboard heights × how far Safari scrolls the page.
const VIEWPORTS = [
  { name: 'iPhone SE', h: 667 }, { name: 'iPhone 13/14', h: 844 },
  { name: 'iPhone Pro Max', h: 932 }, { name: 'iPhone mini', h: 812 },
];
const KEYBOARDS = [0, 291, 336, 398];      // 0 = closed, then ar/en keyboards with/without predictive bar
const SCROLLS = [0, 80, 150, 300];         // how far Safari moved the layout viewport

let cases = 0, clipped = 0, behind = 0, blank = 0;
for (const vp of VIEWPORTS) {
  for (const kb of KEYBOARDS) {
    for (const rawScroll of SCROLLS) {
      // Safari cannot scroll further than the keyboard freed up.
      const scroll = kb === 0 ? 0 : Math.min(rawScroll, kb);
      const v = { visualHeight: vp.h - kb, visualOffsetTop: scroll };
      const visibleTop = scroll, visibleBottom = scroll + (vp.h - kb);
      const f = rootFrame(v);
      cases++;
      // 1. the root IS the visible window — nothing above it is clipped, nothing below is blank
      if (!coversVisibleWindow(f, v)) clipped++;
      // 2. a bottom-anchored composer inside that root ends exactly at the visible bottom, i.e. on
      //    top of the keyboard's edge and never underneath it
      if (composerBottomWithin(v) > visibleBottom) behind++;
      // 3. content starts at the visible top, so the conversation above the composer stays on screen
      if (f.top !== visibleTop) clipped++;
      // 4. keyboard closed → the frame is the whole viewport: no leftover strip after it closes
      if (kb === 0 && (f.height !== vp.h || f.top !== 0)) blank++;
    }
  }
}
check(`root covers the visible window in all ${cases} phone/keyboard/scroll combinations`, clipped === 0, `${clipped} clipped`);
check('a bottom-anchored composer is never behind the keyboard', behind === 0, `${behind} behind`);
check('closing the keyboard restores the full viewport with no blank strip', blank === 0, `${blank} left a strip`);

// 5. no double compensation
check('a screen adds ZERO keyboard padding of its own on web', screenKeyboardInset() === 0);

// ── MUTATION PROOF (executable — the geometry is watched failing) ────────────────────────────────
const mustCatch = (label: string, brokenIsCaught: boolean) =>
  check(`mutation caught: ${label}`, brokenIsCaught, 'a broken frame was accepted');
const v = { visualHeight: 508, visualOffsetTop: 150 };
mustCatch('root ignores Safari\'s scroll (the exact bug — content slides off the top)',
  !coversVisibleWindow({ top: 0, height: 508 }, v));
mustCatch('root keeps the full page height (composer ends up behind the keyboard)',
  !coversVisibleWindow({ top: 150, height: 844 }, v));
mustCatch('root is one pixel short (a blank strip at the bottom)',
  !coversVisibleWindow({ top: 150, height: 507 }, v));
check('…and the correct frame is accepted, so the proofs above are not vacuous',
  coversVisibleWindow(rootFrame(v), v));

// ── the wiring that makes the geometry reachable ─────────────────────────────────────────────────
const layout = readFileSync('src/app/_layout.tsx', 'utf8');
const agent = readFileSync('src/app/agent.tsx', 'utf8');
const lib = readFileSync('src/lib/visualViewportFrame.ts', 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

check('the root layout applies the frame (every screen, not just the chat)',
  /useVisualViewportRoot\(\)/.test(code(layout)));
// scroll is the half that was missing: with only resize the root is the right SIZE in the wrong PLACE.
check('the hook listens to BOTH visualViewport resize AND scroll',
  /addEventListener\('resize', apply\)/.test(lib) && /addEventListener\('scroll', apply\)/.test(lib));
check('the hook restores the root on unmount (no stale height after a hot reload)',
  /root\.style\.height = '';/.test(lib));
// Bans DIRECT tracking, not the shared import — importing lib/visualViewportFrame is the point.
// The first version of this check matched the module name in the import line and failed on the fix.
check('/agent no longer tracks the viewport itself (that is the root\'s job now)',
  !/window\.visualViewport|visualViewport\.addEventListener/.test(code(agent)));
mustCatch('a screen starts tracking the viewport again on its own',
  /window\.visualViewport|visualViewport\.addEventListener/.test("const vv = window.visualViewport;"));
check('/agent takes its keyboard inset from the shared helper',
  /const kbInset = screenKeyboardInset\(\);/.test(code(agent)));

if (failed) {
  console.error(`\n${failed} check(s) FAILED — the keyboard would hide the conversation again`);
  process.exit(1);
}
console.log(`\nOK — ${cases} phone/keyboard/scroll combinations hold; composer above the keyboard, conversation on screen.`);
