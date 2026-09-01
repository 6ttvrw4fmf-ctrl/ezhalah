// BARRIER: a bottom-docked third-party prompt must never be laid out ON TOP of the app's own
// controls.
//
// WHY THIS EXISTS (real production bug, measured live 2026-09-01 against ezhalah-app.vercel.app).
// Google One Tap's legacy prompt — the path GIS takes whenever FedCM is unavailable or fails, which
// includes every iOS Safari visitor — renders on a phone as a bottom sheet: `<iframe
// id="credential_picker_iframe">`, `position: fixed`, `z-index: 9999`, `pointer-events: auto`,
// spanning the full width of the bottom 144 px. The app kept laying its own content out underneath
// it, so for a logged-out visitor on a phone:
//
//   · «بحث» — the primary call to action — came to rest at y 583–602 in a 664 px viewport with the
//     form scrolled as far as it goes. `elementFromPoint` at its centre returned
//     `IFRAME#credential_picker_iframe`; a real Playwright click was intercepted, 3/3 in fresh
//     contexts. The button could not be scrolled clear — at MAXIMUM scroll it was still inside the
//     sheet, on all four viewports measured (375×553, 390×664, 430×739, 375×812). The geometry is
//     viewport-independent: the sheet is always 144 px and the last control always rests ~62 px
//     above the bottom edge.
//   · The AI Agent composer (y 553–575) was hit-tested to the same iframe — a guest could not type.
//
// GIS is initialized with `cancel_on_tap_outside: false` on purpose (Google counts an outside tap as
// a dismissal and starts the 2h → 1d → 7d → 30d cooldown), so tapping the app did NOT clear it: the
// controls stayed dead until the visitor found the small ✕. Dismissing it restored both instantly —
// the positive proof that the sheet was the entire cause, not layout and not the harness.
//
// THE RULE THIS PINS: the app reserves the prompt's height at its ROOT while the prompt is docked,
// so every screen — scrolling and bottom-anchored alike — lays out above it, and reserves NOTHING
// otherwise (no permanent whitespace; no change for signed-in, desktop, or FedCM-path visitors).
//
//   node --experimental-strip-types scripts/verify-bottom-prompt-inset.ts   (discovered by `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bottomPromptInset, ONE_TAP_IFRAME_SELECTOR } from '../src/lib/bottomPromptInset.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// ── A. THE MEASURED PRODUCTION CASE ──────────────────────────────────────────────────────────────
// These are not invented numbers: they are what the live sheet measured on an iPhone 13 viewport.
const VH = 664;
const SHEET = { top: 520, bottom: 664, height: 144 };
{
  check('A1. the measured One Tap sheet reserves its full height',
    bottomPromptInset(SHEET, VH) === 144, `got ${bottomPromptInset(SHEET, VH)}`);

  // The whole point, expressed as arithmetic over the measured geometry: «بحث» rests 62 px above the
  // bottom of the area the app is given. Without the inset that area is the whole viewport, so the
  // button lands at 602 — inside the sheet, which starts at 520. With the inset the app's area ends
  // at 520, so the button lands at 458 and is clear.
  const CTA_GAP = 62;              // measured: viewport bottom (664) − CTA bottom (602)
  const ctaBottom = (inset: number) => VH - inset - CTA_GAP;
  check('A2. WITHOUT the inset the CTA lands inside the sheet (this is the bug)',
    ctaBottom(0) > SHEET.top, `CTA bottom ${ctaBottom(0)} vs sheet top ${SHEET.top}`);
  check('A3. WITH the inset the CTA clears the sheet (this is the fix)',
    ctaBottom(bottomPromptInset(SHEET, VH)) <= SHEET.top,
    `CTA bottom ${ctaBottom(bottomPromptInset(SHEET, VH))} vs sheet top ${SHEET.top}`);
}

// ── B. EVERY CASE THAT MUST NOT MOVE LAYOUT ──────────────────────────────────────────────────────
{
  check('B1. no prompt in the document → 0', bottomPromptInset(null, VH) === 0);
  check('B2. undefined → 0', bottomPromptInset(undefined, VH) === 0);
  check('B3. a zero-height prompt (present but not yet grown) → 0',
    bottomPromptInset({ top: 664, bottom: 664, height: 0 }, VH) === 0);
  check('B4. a hidden prompt → 0',
    bottomPromptInset({ ...SHEET, hidden: true }, VH) === 0);
  // The desktop prompt is a card in the TOP corner. It is not in the way, and treating it as an
  // inset would push desktop layout up for nothing.
  check('B5. a prompt NOT docked to the bottom (the desktop corner card) → 0',
    bottomPromptInset({ top: 20, bottom: 200, height: 180 }, 1100) === 0,
    `got ${bottomPromptInset({ top: 20, bottom: 200, height: 180 }, 1100)}`);
  check('B6. a nonsense viewport height → 0', bottomPromptInset(SHEET, 0) === 0);
}

// ── C. EDGES ─────────────────────────────────────────────────────────────────────────────────────
{
  // Sub-pixel layout and the slide-in animation land a pixel or two short of the edge; that is still
  // docked. Ten pixels short is not.
  check('C1. 1 px short of the bottom edge still counts as docked',
    bottomPromptInset({ top: 520, bottom: VH - 1, height: 143 }, VH) === 144,
    `got ${bottomPromptInset({ top: 520, bottom: VH - 1, height: 143 }, VH)}`);
  check('C2. 10 px short of the bottom edge does NOT count as docked',
    bottomPromptInset({ top: 520, bottom: VH - 10, height: 134 }, VH) === 0);
  // A pathological rect must degrade to wasted space, never to an app squeezed into nothing.
  check('C3. a prompt claiming the whole viewport is clamped to half of it',
    bottomPromptInset({ top: 0, bottom: VH, height: VH }, VH) === 332,
    `got ${bottomPromptInset({ top: 0, bottom: VH, height: VH }, VH)}`);
  check('C4. the clamp holds even for a rect starting above the viewport',
    bottomPromptInset({ top: -500, bottom: VH, height: 1164 }, VH) === 332);
  // Viewport-independence — the sheet is 144 px whatever the phone.
  for (const vh of [553, 664, 739, 812]) {
    check(`C5. reserves 144 px on a ${vh} px viewport`,
      bottomPromptInset({ top: vh - 144, bottom: vh, height: 144 }, vh) === 144);
  }
}

// ── D. MUTATION PROOFS — each rule, deliberately broken, must turn a check above red ──────────────
// A barrier no mutation can redden is decoration (JOURNEY_PERSISTENCE_ENGINEER.md PART 11.4).
{
  type Rect = { top: number; bottom: number; height: number; hidden?: boolean };
  const mutants: Array<{ name: string; fn: (r: Rect | null | undefined, vh: number) => number; killedBy: string }> = [
    {
      name: 'M1 drop the bottom-anchored test (desktop corner card would move layout)',
      killedBy: 'B5',
      fn: (r, vh) => (!r || r.hidden || !(r.height > 0) ? 0 : Math.min(Math.round(vh - r.top), Math.floor(vh * 0.5))),
    },
    {
      name: 'M2 drop the hidden test (a hidden prompt would reserve space)',
      killedBy: 'B4',
      fn: (r, vh) => {
        if (!r || !(r.height > 0)) return 0;
        if (r.bottom < vh - 2) return 0;
        return Math.min(Math.round(vh - r.top), Math.floor(vh * 0.5));
      },
    },
    {
      name: 'M3 drop the clamp (a pathological rect would blank the app)',
      killedBy: 'C3',
      fn: (r, vh) => {
        if (!r || r.hidden || !(r.height > 0) || !(vh > 0)) return 0;
        if (r.bottom < vh - 2) return 0;
        return Math.round(vh - r.top);
      },
    },
    {
      name: 'M4 return 0 always (the bug itself — no space is ever reserved)',
      killedBy: 'A1/A3',
      fn: () => 0,
    },
    {
      name: 'M5 tighten the tolerance to 0 (the slide-in would be missed a pixel short)',
      killedBy: 'C1',
      fn: (r, vh) => {
        if (!r || r.hidden || !(r.height > 0) || !(vh > 0)) return 0;
        if (r.bottom < vh) return 0;
        return Math.min(Math.round(vh - r.top), Math.floor(vh * 0.5));
      },
    },
  ];

  // The assertions each mutant must fail, re-stated against an injectable implementation.
  const suite = (f: (r: Rect | null | undefined, vh: number) => number) => [
    f(SHEET, VH) === 144,                                                        // A1
    VH - f(SHEET, VH) - 62 <= SHEET.top,                                         // A3
    f({ ...SHEET, hidden: true }, VH) === 0,                                     // B4
    f({ top: 20, bottom: 200, height: 180 }, 1100) === 0,                        // B5
    f({ top: 520, bottom: VH - 1, height: 143 }, VH) === 144,                    // C1
    f({ top: 0, bottom: VH, height: VH }, VH) === 332,                           // C3
  ];

  check('D0. the real implementation passes the whole suite', suite(bottomPromptInset).every(Boolean));
  for (const m of mutants) {
    check(`D. mutant killed (${m.killedBy}): ${m.name}`, suite(m.fn).some((ok) => !ok));
  }
}

// ── E. WIRING — the guarantee is worthless if nothing applies it ─────────────────────────────────
{
  const layout = readFileSync(join(ROOT, 'src/app/_layout.tsx'), 'utf8');
  check('E1. the app root imports the inset hook',
    /useBottomPromptInset/.test(layout) && /@\/lib\/bottomPromptInset/.test(layout));
  check('E2. the app root APPLIES it as paddingBottom on its outermost View',
    /paddingBottom:\s*bottomPromptInset/.test(layout),
    'the hook may be called but its value never reserved — the bug returns silently');
  // The selector is the contract with GIS; a rename here silently disables the whole fix.
  check('E3. the prompt selector is still GIS\'s legacy One Tap iframe',
    ONE_TAP_IFRAME_SELECTOR === '#credential_picker_iframe', `got ${ONE_TAP_IFRAME_SELECTOR}`);
  const lib = readFileSync(join(ROOT, 'src/lib/bottomPromptInset.ts'), 'utf8');
  // The sheet arrives ~1.3s after load and animates its height in; a mount-time measurement alone
  // reads 0 forever. Both observers are load-bearing.
  check('E4. the observer watches for the prompt ARRIVING (MutationObserver)',
    /new MutationObserver\(/.test(lib));
  check('E5. …and for it GROWING once inserted (ResizeObserver)',
    /new ResizeObserver\(/.test(lib));
  check('E6. this barrier is discovered by `npm test`', npmTestRuns(ROOT, 'verify-bottom-prompt-inset'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll bottom-prompt-inset checks passed.');
process.exit(failures ? 1 : 0);
