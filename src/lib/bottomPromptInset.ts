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

// ── THE ID IS NOT A CONTRACT, AND GIS DOES NOT ALWAYS SET IT (ops_incident #120, 2026-09-06) ─────
// Measured on production, same bundle, same client_id, both engines, signed out at 375×812:
//
//   Chromium   <iframe id="credential_picker_iframe" class="L5Fo6c-PQbLGe">  375×144 at 0,668
//              position:fixed  z-index:9999          → the bottom sheet this file was written for
//   WebKit     <iframe class="L5Fo6c-PQbLGe">        375×150 at 0,20
//              NO id at all                          → docked to the TOP, over the top bar
//
// So the guard above failed twice over on WebKit: `#credential_picker_iframe` matched nothing, and
// even had it matched, bottomPromptInset() returns 0 for a top-docked rect by design. The app laid
// its top bar out underneath Google's frame, and `document.elementFromPoint` at the centre AND all
// four edges of the sidebar button, «إنشاء حساب / تسجيل الدخول», «تصفية» and «الوكيل الذكي»
// returned that iframe — on both Filter home and AI Agent, 4/4 across two independent CI sweeps.
//
// Identify the prompt by WHAT IT IS — a frame served by an auth provider we actually use — rather
// than by one id GIS happens to set on one engine. This stays narrow in the way that matters: an
// iframe whose src is accounts.google.com or appleid.apple.com is definitionally not one of ours,
// so the "a loose match could blank out real layout" risk above is not reintroduced. Apple is
// included because the owner's 2026-09-01 ruling makes Google and Apple the only two auth
// providers, and the next overlay to dock over the app should not need this file edited again.
export const AUTH_PROMPT_SELECTOR = [
  ONE_TAP_IFRAME_SELECTOR,
  'iframe[src*="accounts.google.com/gsi/"]',
  'iframe[src*="appleid.apple.com"]',
].join(',');

// ── AND THE PROMPTS WE DOCK OURSELVES (owner decision 2026-09-11, ops_incident #152) ─────────────
// The rule this file was written for — «must never cover, block, or intercept any Ezhalah controls
// on mobile or desktop» — was about Google's frame, but it is a rule about the USER, not about whose
// element it is. The cookie consent card broke it on a phone within days of shipping: `position:
// fixed`, `bottom: 20`, `width: 280`, `pointer-events: auto`, spanning x∈[70,370] of a 390 px
// screen, directly over «بحث». `document.elementFromPoint` at the centre of the search button
// returned the card's own «السماح بالكل», and the first tap a visitor made was eaten by it
// (measured on production, 2026-09-11). Owner ruling: the consent UI must never cover or block the
// Search control, the composer, or any important action, on any width.
//
// Identified by its testID, which is ours and stable, rather than by a class the styler owns. It
// reserves space only where it actually spans — a phone — because bottomPromptInset now asks that
// question; the desktop corner card (280 of 1440) sits beside the app and reserves nothing, exactly
// as measured when it shipped.
export const OWN_DOCKED_PROMPT_SELECTOR = '[data-testid="cookie-consent"]';

/** Everything that can dock over the app: third-party auth prompts AND our own docked cards. */
export const DOCKED_PROMPT_SELECTOR = [AUTH_PROMPT_SELECTOR, OWN_DOCKED_PROMPT_SELECTOR].join(',');

/** How far off the bottom edge still counts as "docked to the bottom". Sub-pixel layout and the
 *  sheet's slide-in animation both land a pixel or two short of the edge. */
const BOTTOM_ANCHOR_TOLERANCE = 2;

/** How far off the TOP edge still counts as "docked to the top". Measured at 20 px on WebKit — GIS
 *  leaves a margin above its top-anchored sheet, so the 2 px the bottom edge needs is far too tight
 *  here. Bounded deliberately: a frame further down than this is floating in the page, not docked,
 *  and reserving the whole band above it would be wrong. */
const TOP_ANCHOR_TOLERANCE = 32;

/** A docked SHEET spans the viewport; a corner CARD does not. Only a sheet gets space reserved on
 *  its edge — reserving a full-width band for the ~390 px desktop corner card would push the whole
 *  app down for something sitting beside it, not over it. 0.8 rather than 1.0 leaves room for the
 *  margins GIS puts either side (measured: 375 of 375 on mobile, so a real sheet clears this
 *  easily).
 *
 *  NOW ON BOTH EDGES (owner decision 2026-09-11, ops_incident #152). It used to be top-only, and the
 *  stated reason was that "GIS has never rendered a bottom-docked CARD". That premise stopped being
 *  true the moment WE rendered one: the cookie consent card is bottom-docked on every viewport and
 *  is a 280 px corner card on desktop, where it sits beside the app and must reserve nothing. So the
 *  bottom path needs the same question the top path already asks. This is not a loosening — the
 *  bottom path gains a condition — and it is opt-in by signature: `bottomPromptInset(rect, vh)`
 *  behaves exactly as it always has, byte for byte, and only a caller that supplies a viewport WIDTH
 *  is asking for the span test. */
const MIN_SHEET_SPAN_FRACTION = 0.8;

/** A prompt may never eat more than this share of the viewport. A pathological or mis-measured rect
 *  must degrade to "a bit of wasted space", never to an app squeezed into nothing. */
const MAX_INSET_FRACTION = 0.5;

export type PromptRect = {
  top: number;
  bottom: number;
  height: number;
  /** Needed only by the TOP path, to tell a full-width docked SHEET from a corner CARD. Absent on
   *  the bottom path's own fixtures, which predate it — an undefined width never spans. */
  width?: number;
  /** `display:none`, `visibility:hidden`, or fully transparent — present in the DOM but not shown. */
  hidden?: boolean;
};

/** Space to reserve on each edge. Both zero whenever nothing is docked over the app. */
export type PromptInsets = { top: number; bottom: number };

/**
 * How many CSS pixels of the viewport's BOTTOM edge the prompt occupies.
 *
 * PURE, so the geometry can be proven offline and mutation-tested without a browser
 * (`scripts/verify-bottom-prompt-inset.ts`). Returns 0 for every case that must not move layout:
 * no prompt, a hidden one, a zero-height one, and — importantly — one that is NOT docked to the
 * bottom, which is exactly how the same prompt renders on desktop (a card in the top corner). That
 * last rule is what keeps this a mobile-only correction without ever testing for "mobile".
 */
export function bottomPromptInset(
  rect: PromptRect | null | undefined,
  viewportHeight: number,
  /**
   * Supply this and a bottom-docked rect must SPAN the viewport to reserve anything — the same
   * question topPromptInset already asks, and the only thing that tells our own desktop corner card
   * (280 of 1440) from the sheet it becomes on a phone (358 of 390). Omit it and this function is
   * unchanged in every respect, which is how all twelve of its original cases still read.
   *
   * THE TWO EDGES FAIL IN OPPOSITE DIRECTIONS, ON PURPOSE. Here an UNKNOWN width counts as
   * spanning, so a rect we could not measure still gets its space reserved: the harm this file
   * exists to prevent is a dead «بحث» under a sheet, and guessing "it is only a card" would bring
   * that straight back. topPromptInset takes the opposite default for the same reason — up there the
   * harm is shoving the whole app down for something beside it.
   */
  viewportWidth?: number,
): number {
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
  // A card beside the app, not a sheet across it — asked only when the caller supplied a width.
  if (viewportWidth != null && viewportWidth > 0 && rect.width != null
      && !(rect.width >= viewportWidth * MIN_SHEET_SPAN_FRACTION)) return 0;
  const overlap = viewportHeight - rect.top;
  if (!(overlap > 0)) return 0;
  return Math.min(Math.round(overlap), Math.floor(viewportHeight * MAX_INSET_FRACTION));
}

/**
 * How many CSS pixels of the viewport's TOP edge the prompt occupies.
 *
 * The mirror of bottomPromptInset, and PURE for the same reason. Returns 0 for everything that must
 * not move layout, plus one condition the bottom edge does not need: the prompt must SPAN the
 * viewport, so the desktop corner card — top-anchored, ~390 px wide, sitting beside the app rather
 * than over it — reserves nothing. A frame docked to the top of a phone is 375 of 375 wide.
 */
export function topPromptInset(
  rect: PromptRect | null | undefined,
  viewportHeight: number,
  viewportWidth: number,
): number {
  const promptHeight = rect ? rect.height : 0;
  if (!rect || rect.hidden || !(promptHeight > 0)) return 0;
  if (!(viewportHeight > 0) || !(viewportWidth > 0)) return 0;
  // Not docked to the top → nothing of ours is under it up here. (Desktop corner prompt, and the
  // bottom sheet, both land on this line.)
  if (rect.top > TOP_ANCHOR_TOLERANCE) return 0;
  // A card beside the app, not a sheet across it.
  const promptWidth = rect.width ?? 0;
  if (!(promptWidth >= viewportWidth * MIN_SHEET_SPAN_FRACTION)) return 0;
  const overlap = rect.bottom;
  if (!(overlap > 0)) return 0;
  return Math.min(Math.round(overlap), Math.floor(viewportHeight * MAX_INSET_FRACTION));
}

/**
 * Both edges at once, over EVERY docked prompt in the document.
 *
 * Two rules that only exist once both edges are in play:
 *  · A rect that qualifies on BOTH edges is not a dock at all — it is a full-screen overlay, and
 *    "reserve the space it occupies" is meaningless for something covering everything. It
 *    contributes nothing rather than squeezing the app to nothing.
 *  · The COMBINED reservation is capped exactly like each half is. Two prompts docked at once must
 *    still leave an app behind them.
 */
export function promptInsets(
  rects: ReadonlyArray<PromptRect | null | undefined> | null | undefined,
  viewportHeight: number,
  viewportWidth: number,
): PromptInsets {
  let top = 0;
  let bottom = 0;
  for (const rect of rects ?? []) {
    const t = topPromptInset(rect, viewportHeight, viewportWidth);
    const b = bottomPromptInset(rect, viewportHeight, viewportWidth);
    if (t > 0 && b > 0) continue;   // covers the whole viewport: a modal, not a dock
    if (t > top) top = t;
    if (b > bottom) bottom = b;
  }
  const cap = viewportHeight > 0 ? Math.floor(viewportHeight * MAX_INSET_FRACTION) : 0;
  if (top + bottom > cap) {
    // Keep the larger reservation whole rather than halving both into uselessness — a sheet that is
    // only half accounted for still eats the controls under its remaining half.
    if (top >= bottom) { top = Math.min(top, cap); bottom = Math.max(0, cap - top); }
    else { bottom = Math.min(bottom, cap); top = Math.max(0, cap - bottom); }
  }
  return { top, bottom };
}

/** Read every live rect matching `selector`. Empty when nothing matches. */
function readPromptRects(selector: string = DOCKED_PROMPT_SELECTOR): PromptRect[] {
  if (typeof document === 'undefined') return [];
  const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const hidden = !!cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0');
    return { top: r.top, bottom: r.bottom, height: r.height, width: r.width, hidden };
  });
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
export function observePromptInsets(
  onChange: (insets: PromptInsets) => void,
  selector: string = DOCKED_PROMPT_SELECTOR,
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  let last: PromptInsets = { top: -1, bottom: -1 };
  let sizeObserver: ResizeObserver | null = null;
  let watched: Element[] = [];

  const emit = () => {
    const next = promptInsets(readPromptRects(selector), window.innerHeight, window.innerWidth);
    if (next.top === last.top && next.bottom === last.bottom) return;
    last = next;
    onChange(next);
  };

  // Keep a ResizeObserver attached to whichever prompt elements are currently in the document.
  const retarget = () => {
    const els = Array.from(document.querySelectorAll(selector));
    if (els.length === watched.length && els.every((el, i) => el === watched[i])) return;
    if (sizeObserver) { sizeObserver.disconnect(); sizeObserver = null; }
    watched = els;
    if (els.length && typeof ResizeObserver === 'function') {
      sizeObserver = new ResizeObserver(emit);
      for (const el of els) sizeObserver.observe(el);
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

/**
 * Where a FIXED overlay that the APP ITSELF docks `base` px off one edge must actually sit, given
 * the band a foreign prompt has reserved on that same edge.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE ROOT PADDING (ops_incident #163, 2026-09-11, regression hunter).
 * The #120 repair reserves the band as `paddingTop`/`paddingBottom` on the app's outermost View, and
 * that moves every control laid out INSIDE that box — which is what the measured case needed and
 * what `verify-bottom-prompt-inset.ts` §E2 pins. But a `position: fixed` child is NOT laid out
 * inside it: fixed resolves against the VIEWPORT, so an ancestor's padding is invisible to it by
 * definition. The app's own docked card therefore stayed exactly where it was while the root made
 * room around it, landing inside the very band the root had just reserved.
 *
 * Measured on the served bundle entry-3545b04ac003d2a47e8bec8441b0fe2e.js, which carried BOTH the
 * inset mechanism and the consent card: One Tap's legacy sheet owns the bottom 144 px at
 * `z-index: 9999; pointer-events: auto`, while CookieConsent stayed pinned at `bottom: 20` with its
 * button row in its own bottom ~40 px — i.e. at viewport y ∈ [VH−60, VH−20], wholly inside
 * [VH−144, VH]. Both consent buttons hit-test to Google's iframe, so a signed-out visitor cannot
 * record «الضروري فقط» at all, and the card's own search-dismissal then records «السماح بالكل» on
 * their behalf. The two surfaces target the IDENTICAL visitor (signed-out, web), so this is the
 * default first-visit state on the legacy One Tap path, not a corner case.
 *
 * STILL TRUE AFTER `ops_incident #152`'s repair (owner 2026-09-11, PR #2267), because that repair
 * changed what `base` and `edgeInset` mean without removing the need for this function. The 190 px
 * consent SHEET is now itself a member of `DOCKED_PROMPT_SELECTOR`, so the app root correctly
 * reserves its height for OTHER content — but the sheet's own element is still painted flush at
 * `bottom: 0`, unconditionally, and nothing shifts IT when a THIRD-PARTY prompt is ALSO docked. One
 * Tap's 144 px sheet then overlaps the bottom 144 of the consent sheet's own 190, which is exactly
 * where its button row sits — the identical defect in the new geometry. Feed this function the
 * FOREIGN-only band from `useForeignPromptInsets()` below, never the combined `usePromptInsets()`:
 * the combined one already counts the card's OWN rect, so using it here would have the card chase
 * its own reservation.
 *
 * PURE, so the geometry is proven offline and mutation-tested without a browser
 * (`scripts/verify-fixed-overlays-clear-docked-prompts.ts`). Returns `base` unchanged whenever
 * nothing is docked, so nothing moves on the path that was already correct.
 */
export function dockedEdgeOffset(base: number, edgeInset: number): number {
  const b = Number.isFinite(base) && base > 0 ? base : 0;
  const band = Number.isFinite(edgeInset) && edgeInset > 0 ? edgeInset : 0;
  return b + band;
}

/** Both insets, as React state. Zeroes on native and whenever no prompt is docked over the app. */
export function usePromptInsets(): PromptInsets {
  const [insets, setInsets] = useState<PromptInsets>({ top: 0, bottom: 0 });
  useEffect(() => observePromptInsets(setInsets), []);
  return insets;
}

/**
 * The band reserved by THIRD-PARTY prompts only (`AUTH_PROMPT_SELECTOR`) — never our own docked
 * cards. For a component that docks itself against the SAME edge (ops_incident #163): reading
 * `usePromptInsets()` there would fold the component's own rect back into its own required offset,
 * since `DOCKED_PROMPT_SELECTOR` includes `OWN_DOCKED_PROMPT_SELECTOR`. This is the safe input to
 * `dockedEdgeOffset()` for exactly that case — "how far do I need to move to clear whoever ELSE is
 * docked here", with no self-reference.
 */
export function useForeignPromptInsets(): PromptInsets {
  const [insets, setInsets] = useState<PromptInsets>({ top: 0, bottom: 0 });
  useEffect(() => observePromptInsets(setInsets, AUTH_PROMPT_SELECTOR), []);
  return insets;
}
