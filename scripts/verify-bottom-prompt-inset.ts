// BARRIER: a docked third-party auth prompt must never be laid out ON TOP of the app's own
// controls — on EITHER edge, on any engine.
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
import {
  bottomPromptInset, topPromptInset, promptInsets,
  ONE_TAP_IFRAME_SELECTOR, AUTH_PROMPT_SELECTOR,
} from '../src/lib/bottomPromptInset.ts';
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
    /usePromptInsets/.test(layout) && /@\/lib\/bottomPromptInset/.test(layout));
  check('E2. the app root APPLIES the bottom inset as paddingBottom on its outermost View',
    /paddingBottom:\s*promptInset\.bottom/.test(layout),
    'the hook may be called but its value never reserved — the bug returns silently');
  // #120: reserving one edge and not the other is how a top-docked sheet went unnoticed for as long
  // as it did. Both halves are load-bearing and both are pinned.
  check('E2b. …and the top inset as paddingTop on the same View',
    /paddingTop:\s*promptInset\.top/.test(layout),
    'a top-docked sheet would be measured correctly and then never reserved — #120 exactly');
  // The selector is the contract with GIS; a rename here silently disables the whole fix.
  check('E3. the legacy One Tap id is still recognised',
    ONE_TAP_IFRAME_SELECTOR === '#credential_picker_iframe', `got ${ONE_TAP_IFRAME_SELECTOR}`);
  // …and the id ALONE is no longer the contract. GIS omits it entirely on WebKit (measured #120),
  // which is why the selector must also identify the frame by its auth-provider origin.
  check('E3b. the prompt is also identified by origin, not only by an id GIS sometimes omits',
    AUTH_PROMPT_SELECTOR.includes('accounts.google.com/gsi/')
      && AUTH_PROMPT_SELECTOR.includes(ONE_TAP_IFRAME_SELECTOR),
    `got ${AUTH_PROMPT_SELECTOR}`);
  check('E3c. …and covers the other provider the owner\'s 2026-09-01 ruling allows',
    AUTH_PROMPT_SELECTOR.includes('appleid.apple.com'), `got ${AUTH_PROMPT_SELECTOR}`);
  const libSrc = readFileSync(join(ROOT, 'src/lib/bottomPromptInset.ts'), 'utf8');
  check('E3d. the DOM read uses the WIDE selector, not the legacy id',
    /querySelectorAll\(AUTH_PROMPT_SELECTOR\)/.test(libSrc),
    'the wide selector may exist and never be the thing actually queried');
  const lib = readFileSync(join(ROOT, 'src/lib/bottomPromptInset.ts'), 'utf8');
  // The sheet arrives ~1.3s after load and animates its height in; a mount-time measurement alone
  // reads 0 forever. Both observers are load-bearing.
  check('E4. the observer watches for the prompt ARRIVING (MutationObserver)',
    /new MutationObserver\(/.test(lib));
  check('E5. …and for it GROWING once inserted (ResizeObserver)',
    /new ResizeObserver\(/.test(lib));
  check('E6. this barrier is discovered by `npm test`', npmTestRuns(ROOT, 'verify-bottom-prompt-inset'));
}


// ── F. THE TOP EDGE (ops_incident #120) ──────────────────────────────────────────────────────────
// Measured on production, signed out, 375×812, the SAME bundle and client_id on both engines:
//   Chromium  <iframe id="credential_picker_iframe">  375×144 at 0,668  → the bottom sheet, §A
//   WebKit    <iframe class="L5Fo6c-PQbLGe">, NO id   375×150 at 0,20   → docked to the TOP
// On WebKit `elementFromPoint` at the centre and all four edges of the sidebar button,
// «إنشاء حساب / تسجيل الدخول», «تصفية» and «الوكيل الذكي» returned that iframe, on both Filter home
// and AI Agent, 4/4 across two independent CI sweeps. The old guard missed it twice over: the id
// selector matched nothing, and bottomPromptInset() returns 0 for a top-docked rect by design.
const VH_PHONE = 812;
const VW_PHONE = 375;
const TOP_SHEET = { top: 20, bottom: 170, height: 150, width: 375 };
const BOTTOM_SHEET = { top: 668, bottom: 812, height: 144, width: 375 };
// The desktop corner card: top-anchored, but BESIDE the app rather than across it.
const CORNER_CARD = { top: 20, bottom: 200, height: 180, width: 391 };
{
  check('F1. the measured WebKit top sheet reserves everything above its bottom edge',
    topPromptInset(TOP_SHEET, VH_PHONE, VW_PHONE) === 170,
    `got ${topPromptInset(TOP_SHEET, VH_PHONE, VW_PHONE)}`);
  // The whole point: with the inset applied, the top bar starts BELOW Google's frame.
  check('F2. …so the app\'s first control is laid out clear of it',
    topPromptInset(TOP_SHEET, VH_PHONE, VW_PHONE) >= TOP_SHEET.bottom);
  check('F3. the desktop corner CARD spans too little to be a dock → 0',
    topPromptInset(CORNER_CARD, 900, 1440) === 0,
    `got ${topPromptInset(CORNER_CARD, 900, 1440)} — the whole app would shift down for a card beside it`);
  check('F4. the bottom sheet is not a top dock → 0',
    topPromptInset(BOTTOM_SHEET, VH_PHONE, VW_PHONE) === 0);
  check('F5. a frame floating below the tolerance is not docked → 0',
    topPromptInset({ ...TOP_SHEET, top: 33 }, VH_PHONE, VW_PHONE) === 0);
  check('F6. …and one just inside it still is',
    topPromptInset({ ...TOP_SHEET, top: 32 }, VH_PHONE, VW_PHONE) === 170);
  check('F7. hidden → 0', topPromptInset({ ...TOP_SHEET, hidden: true }, VH_PHONE, VW_PHONE) === 0);
  check('F8. zero height → 0', topPromptInset({ top: 0, bottom: 0, height: 0, width: 375 }, VH_PHONE, VW_PHONE) === 0);
  check('F9. no width measured → never spans → 0',
    topPromptInset({ top: 20, bottom: 170, height: 150 }, VH_PHONE, VW_PHONE) === 0);
  check('F10. nothing there → 0', topPromptInset(null, VH_PHONE, VW_PHONE) === 0
    && topPromptInset(undefined, VH_PHONE, VW_PHONE) === 0);
  check('F11. a nonsense viewport → 0', topPromptInset(TOP_SHEET, 0, VW_PHONE) === 0
    && topPromptInset(TOP_SHEET, VH_PHONE, 0) === 0);
  check('F12. a pathological rect is clamped, never blanking the app',
    topPromptInset({ top: 0, bottom: 5000, height: 5000, width: 375 }, VH_PHONE, VW_PHONE) === 406,
    `got ${topPromptInset({ top: 0, bottom: 5000, height: 5000, width: 375 }, VH_PHONE, VW_PHONE)}`);
}

// ── G. BOTH EDGES AT ONCE ────────────────────────────────────────────────────────────────────────
{
  const eq = (a: { top: number; bottom: number }, t: number, b: number) => a.top === t && a.bottom === b;
  check('G1. the WebKit case reserves the top and nothing else',
    eq(promptInsets([TOP_SHEET], VH_PHONE, VW_PHONE), 170, 0));
  check('G2. the Chromium case is unchanged — bottom only',
    eq(promptInsets([BOTTOM_SHEET], VH_PHONE, VW_PHONE), 0, 144));
  check('G3. nothing docked → nothing reserved',
    eq(promptInsets([], VH_PHONE, VW_PHONE), 0, 0) && eq(promptInsets(null, VH_PHONE, VW_PHONE), 0, 0));
  check('G4. the desktop corner card reserves nothing on either edge',
    eq(promptInsets([CORNER_CARD], 900, 1440), 0, 0));
  // A frame covering the whole viewport qualifies on BOTH edges. Reserving "the space it occupies"
  // is meaningless for something occupying everything — that is a modal, and it must not squeeze
  // the app to nothing.
  check('G5. a full-screen overlay is a modal, not a dock → nothing reserved',
    eq(promptInsets([{ top: 0, bottom: VH_PHONE, height: VH_PHONE, width: VW_PHONE }], VH_PHONE, VW_PHONE), 0, 0));
  check('G6. two prompts docked at once are both reserved',
    eq(promptInsets([TOP_SHEET, BOTTOM_SHEET], VH_PHONE, VW_PHONE), 170, 144));
  // 300 + 300 exceeds half the viewport; the larger survives whole and the app keeps the rest.
  check('G7. the COMBINED reservation is capped, so an app always remains',
    eq(promptInsets([
      { top: 0, bottom: 300, height: 300, width: 375 },
      { top: VH_PHONE - 300, bottom: VH_PHONE, height: 300, width: 375 },
    ], VH_PHONE, VW_PHONE), 300, 106));
  check('G8. a hidden prompt beside a real one does not disturb it',
    eq(promptInsets([{ ...TOP_SHEET, hidden: true }, BOTTOM_SHEET], VH_PHONE, VW_PHONE), 0, 144));
}

// ── H. MUTATION PROOFS ON THE REAL FILE ──────────────────────────────────────────────────────────
// §D mutates by re-implementation, which cannot notice the real file drifting away from the mutant.
// These edit `src/lib/bottomPromptInset.ts` itself and re-import it, so the evidence is the shipped
// code changing behaviour — the standard AGENTS.md holds barriers to after five source-TEXT
// tripwires sat green over live defects on 2026-09-04.
{
  const LIB = join(ROOT, 'src/lib/bottomPromptInset.ts');
  const original = readFileSync(LIB, 'utf8');
  const { writeFileSync } = await import('node:fs');

  // Signal-safe restore. This proof mutates PRODUCT SOURCE, which raises the stakes over the two
  // harness mutators that share this pattern: the `finally` below does not run on a signal,
  // scripts/run-tests.mjs treats a signal-killed child (timeout, OOM) as a failure because it
  // happens, and AGENTS.md states this working directory is shared by concurrent sessions with no
  // isolation. A mutant left in src/ by a timeout is one `git add -A` away from being committed by
  // another session — and src/ is what ships. SIGKILL and a hard OOM cannot be trapped by anyone;
  // SIGTERM and SIGINT can, so they are. Enforced by verify-in-place-mutators-restore-on-signal.ts,
  // which is what found this file.
  const restore = () => { try { writeFileSync(LIB, original); } catch { /* best effort */ } };
  const onSignal = (sig: NodeJS.Signals) => {
    restore();
    process.removeListener(sig, onSignal);
    process.kill(process.pid, sig);
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  process.once('exit', restore);
  let n = 0;
  const withMutation = async (
    label: string,
    mutate: (src: string) => string,
    broken: (m: typeof import('../src/lib/bottomPromptInset.ts')) => boolean,
  ) => {
    const mutated = mutate(original);
    if (mutated === original) {
      failures++; console.error(`FAIL  H. (mutation) «${label}» changed nothing — the anchor missed`); return;
    }
    writeFileSync(LIB, mutated);
    try {
      const mod = await import(`../src/lib/bottomPromptInset.ts?promptmut=${++n}`);
      check(`H. mutant killed: ${label}`, broken(mod as never));
    } catch (e) {
      // A throw is not a killed mutation: the evidence must be behaviour changing, never the module
      // falling over.
      failures++;
      console.error(`FAIL  H. (mutation) «${label}» broke the module instead of changing its behaviour: ${String(e).slice(0, 120)}`);
    } finally {
      writeFileSync(LIB, original);
    }
  };

  // H1 — THE #120 DEFECT ITSELF: no top reservation at all.
  await withMutation(
    'the top edge reserves nothing (ops_incident #120 exactly)',
    (src) => src.replace('  const overlap = rect.bottom;\n  if (!(overlap > 0)) return 0;', '  const overlap = 0;\n  if (!(overlap > 0)) return 0;'),
    (m) => m.topPromptInset(TOP_SHEET, VH_PHONE, VW_PHONE) === 0,
  );

  // H2 — drop the span test: the desktop corner card would shove the whole app down.
  await withMutation(
    'the span test is dropped, so a corner CARD moves the app',
    (src) => src.replace('  if (!(promptWidth >= viewportWidth * MIN_SHEET_SPAN_FRACTION)) return 0;', ''),
    (m) => m.topPromptInset(CORNER_CARD, 900, 1440) !== 0,
  );

  // H3 — drop the top-anchor test: the BOTTOM sheet would also reserve space at the top.
  await withMutation(
    'the top-anchor test is dropped, so a bottom sheet reserves the top too',
    (src) => src.replace('  if (rect.top > TOP_ANCHOR_TOLERANCE) return 0;', ''),
    (m) => m.topPromptInset(BOTTOM_SHEET, VH_PHONE, VW_PHONE) !== 0,
  );

  // H4 — the selector reverts to the id GIS omits on WebKit: the frame is never found at all.
  await withMutation(
    'the selector reverts to the legacy id alone, which WebKit never sets',
    (src) => src.replace(/export const AUTH_PROMPT_SELECTOR = \[[\s\S]*?\]\.join\(','\);/,
      "export const AUTH_PROMPT_SELECTOR = ONE_TAP_IFRAME_SELECTOR;"),
    (m) => !m.AUTH_PROMPT_SELECTOR.includes('accounts.google.com'),
  );

  // H5 — drop the both-edges guard: a full-screen overlay squeezes the app out of existence.
  await withMutation(
    'the full-screen guard is dropped, so a modal squeezes the app',
    (src) => src.replace('    if (t > 0 && b > 0) continue;   // covers the whole viewport: a modal, not a dock', ''),
    (m) => {
      const i = m.promptInsets([{ top: 0, bottom: VH_PHONE, height: VH_PHONE, width: VW_PHONE }], VH_PHONE, VW_PHONE);
      return i.top !== 0 || i.bottom !== 0;
    },
  );

  // H6 — drop the combined cap: two docked prompts leave no app behind them.
  await withMutation(
    'the combined cap is dropped, so two prompts can reserve the whole viewport',
    (src) => src.replace('  if (top + bottom > cap) {', '  if (false) {'),
    (m) => {
      const i = m.promptInsets([
        { top: 0, bottom: 300, height: 300, width: 375 },
        { top: VH_PHONE - 300, bottom: VH_PHONE, height: 300, width: 375 },
      ], VH_PHONE, VW_PHONE);
      return i.top + i.bottom > Math.floor(VH_PHONE * 0.5);
    },
  );
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll bottom-prompt-inset checks passed.');
process.exit(failures ? 1 : 0);
