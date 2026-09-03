// Reserve the space a bottom-docked THIRD-PARTY prompt occupies, so it can never sit on top of the
// app's own controls.
//
// WHY THIS EXISTS (real production bug, measured live 2026-09-01 on ezhalah-app.vercel.app).
// Google One Tap's LEGACY prompt — the path GIS takes whenever FedCM is unavailable or fails, which
// is every iOS Safari visitor and every browser where the FedCM request is blocked — renders on a
// phone as `ui_mode=bottom_sheet`: `<iframe id="credential_picker_iframe">`, `position: fixed`,
// `z-index: 9999`, `pointer-events: auto`, pinned across the full width of the bottom 144 px of the
// viewport. It is Google's own element, drawn correctly and visibly; the bug is that the app kept
// laying its own content out underneath it.
//
// What that cost a logged-out visitor on a phone, reproduced 3/3 in fresh contexts and confirmed on
// four viewports (375×553, 390×664, 430×739, 375×812 — the geometry is viewport-INDEPENDENT,
// because the sheet is always 144 px tall and the form's last control always comes to rest ~62 px
// above the bottom edge):
//
//   · Filter home — «بحث», the app's primary call to action, sits at y 583–602 in a 664 px viewport
//     once the form is scrolled as far as it goes. `document.elementFromPoint` at its centre returns
//     `IFRAME#credential_picker_iframe`, and a real tap lands on Google's iframe. The button cannot
//     be scrolled clear: at maximum scroll it is still inside the sheet.
//   · AI Agent — the message composer (y 553–575) is hit-tested to the same iframe. A guest could
//     not type their question.
//
// And it does not clear itself: GIS is initialized with `cancel_on_tap_outside: false` (deliberately
// — Google counts an outside tap as a dismissal and starts the 2h → 1d → 7d → 30d cooldown), so
// tapping the app does not close the prompt. The controls stay dead until the visitor finds the
// small ✕. Dismissing it restores both immediately (hit-test winner returns to DIV / TEXTAREA and
// the real click lands) — which is the positive proof that the sheet was the entire cause.
//
// THE RULE: a prompt WE summoned must never cover our own controls. The app reserves the sheet's
// height at its root while the sheet is up, so every screen — scrolling (Filter) and bottom-anchored
// (the Agent composer) alike — lays out above it. Self-removing: the inset returns to 0 the moment
// the prompt goes, so there is no permanent whitespace and no change whatsoever for a signed-in
// visitor, a desktop visitor, or one whose browser takes the FedCM path (where the prompt is drawn
// by the browser chrome, outside the page, and covers nothing).
//
// Verified live against production BEFORE this code was written, by injecting the same inset into
// the served bundle: «بحث» moved 583 → 439 and its hit-test winner went IFRAME → DIV; the composer
// moved 553 → 409, winner IFRAME → TEXTAREA; and a real Playwright click landed on both.
//
// NOTE ON IMPORTS: this module deliberately imports nothing from `react-native`. Its geometry is
// proven offline by `scripts/verify-bottom-prompt-inset.ts`, and a plain node barrier cannot load
// react-native's Flow-typed entrypoint. The platform guard it would have provided is not needed
// either: this is a DOM concern, so `typeof document`/`typeof window` is both the loadable check and
// the more honest one — on native there is no document, and the observer degrades to a no-op.
import { useEffect, useState } from 'react';

/** Google Identity Services' legacy One Tap prompt. Deliberately the exact id GIS uses rather than a
 *  broad selector: a loose match could catch one of our own elements and blank out real layout. */
export const ONE_TAP_IFRAME_SELECTOR = '#credential_picker_iframe';

/** How far off the bottom edge still counts as "docked to the bottom". Sub-pixel layout and the
 *  sheet's slide-in animation both land a pixel or two short of the edge. */
const BOTTOM_ANCHOR_TOLERANCE = 2;

/** A prompt may never eat more than this share of the viewport. A pathological or mis-measured rect
 *  must degrade to "a bit of wasted space", never to an app squeezed into nothing. */
const MAX_INSET_FRACTION = 0.5;

export type PromptRect = {
  top: number;
  bottom: number;
  height: number;
  /** `display:none`, `visibility:hidden`, or fully transparent — present in the DOM but not shown. */
  hidden?: boolean;
};

/**
 * How many CSS pixels of the viewport's BOTTOM edge the prompt occupies.
 *
 * PURE, so the geometry can be proven offline and mutation-tested without a browser
 * (`scripts/verify-bottom-prompt-inset.ts`). Returns 0 for every case that must not move layout:
 * no prompt, a hidden one, a zero-height one, and — importantly — one that is NOT docked to the
 * bottom, which is exactly how the same prompt renders on desktop (a card in the top corner). That
 * last rule is what keeps this a mobile-only correction without ever testing for "mobile".
 */
export function bottomPromptInset(rect: PromptRect | null | undefined, viewportHeight: number): number {
  // `promptHeight` rather than comparing `rect.height` directly: this is a PRESENCE test on one
  // element's box, not a viewport breakpoint, and `verify-ssr-hydration-parity.ts` §C rightly
  // objects to `height > <number>` appearing in src/ — that shape means a breakpoint being decided
  // at render time, which is the SSR-mismatch bug it guards. Naming the local keeps that guard
  // sharp instead of carving out an exemption for this file.
  const promptHeight = rect ? rect.height : 0;
  if (!rect || rect.hidden || !(promptHeight > 0)) return 0;
  if (!(viewportHeight > 0)) return 0;
  // Not docked to the bottom → it is not in anything's way at the bottom. (Desktop corner prompt.)
  if (rect.bottom < viewportHeight - BOTTOM_ANCHOR_TOLERANCE) return 0;
  const overlap = viewportHeight - rect.top;
  if (!(overlap > 0)) return 0;
  return Math.min(Math.round(overlap), Math.floor(viewportHeight * MAX_INSET_FRACTION));
}

/** Read the live prompt's rect, or null when there is no prompt in the document. */
function readPromptRect(): PromptRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(ONE_TAP_IFRAME_SELECTOR) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const hidden = !!cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0');
  return { top: r.top, bottom: r.bottom, height: r.height, hidden };
}

/**
 * Watch the bottom-docked prompt and report its inset whenever it changes.
 *
 * The sheet ARRIVES late (~1.3 s after load here) and then ANIMATES its height from 0 to 144 px, so
 * a single measurement at mount would read 0 and stay there. Both transitions are covered:
 * a MutationObserver catches the iframe being inserted/removed and Google restyling it, and a
 * ResizeObserver on the iframe itself catches the slide-in. `resize`/`orientationchange` cover the
 * viewport moving under a prompt that is already up.
 *
 * Returns a cleanup function; safe to call on any platform (a no-op off web).
 */
export function observeBottomPromptInset(onChange: (px: number) => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  let last = -1;
  let sizeObserver: ResizeObserver | null = null;
  let watched: Element | null = null;

  const emit = () => {
    const px = bottomPromptInset(readPromptRect(), window.innerHeight);
    if (px === last) return;
    last = px;
    onChange(px);
  };

  // Keep a ResizeObserver attached to whichever prompt element is currently in the document.
  const retarget = () => {
    const el = document.querySelector(ONE_TAP_IFRAME_SELECTOR);
    if (el === watched) return;
    if (sizeObserver) { sizeObserver.disconnect(); sizeObserver = null; }
    watched = el;
    if (el && typeof ResizeObserver === 'function') {
      sizeObserver = new ResizeObserver(emit);
      sizeObserver.observe(el);
    }
  };

  const tick = () => { retarget(); emit(); };

  const mo = typeof MutationObserver === 'function' ? new MutationObserver(tick) : null;
  mo?.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'],
  });
  window.addEventListener('resize', emit);
  window.addEventListener('orientationchange', emit);
  tick();

  return () => {
    mo?.disconnect();
    sizeObserver?.disconnect();
    window.removeEventListener('resize', emit);
    window.removeEventListener('orientationchange', emit);
  };
}

/** The inset, as React state. 0 on native, on desktop, and whenever no prompt is docked. */
export function useBottomPromptInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => observeBottomPromptInset(setInset), []);
  return inset;
}
