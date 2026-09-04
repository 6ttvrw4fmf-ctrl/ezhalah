// VIEWPORT BREAKPOINTS + THE ONE RULE THAT KEEPS THEM SSR-SAFE.
//
// WHY THIS FILE EXISTS (P0, 2026-08-21 — React #418 live on production since 04:23 UTC).
// The app is server-rendered (Expo static export) and then hydrated in the browser. On the server
// there is no `window`, so `useWindowDimensions()` reports width 0 and every width-gated flag comes
// out FALSE. On a desktop client the same flag comes out TRUE on the very first render — so React's
// first client render disagrees with the served HTML, which is exactly React error #418. React then
// throws the whole server tree away and re-renders on the client: the page still works, but SSR is
// silently lost on every desktop visit.
//
// It was NOT one bug, it was two — and they are why the live page logged exactly TWO errors:
//   • Sidebar `useDocked()`            at width ≥ 900 — STRUCTURAL (the docked <Sidebar/> is present
//                                       on the client and absent in the served HTML).
//   • ResultCard `horizontal`          at width ≥ 820 — ATTRIBUTE (flexDirection row/column and the
//                                       wide/compact style arrays differ).
// Bisection against the real production bundle matched this exactly: 0 errors at 375 and 768 (neither
// breakpoint trips), 2 errors at 900/1024/1280/1920 (both trip).
//
// THE RULE: the FIRST client render must equal the server render, always. So a width-gated flag
// starts FALSE (the server's answer) and only becomes true after mount, in a commit React is happy to
// re-render. The cost is that a desktop visitor gets the compact layout for one frame; the benefit is
// that hydration succeeds and SSR is actually kept.
//
// The decision lives in this pure function — not in a comment and not re-typed per call site — so
// scripts/verify-ssr-hydration-parity.ts can EXECUTE it rather than grep for it. Same reason
// runAfterAnimation() and shouldSendRefreshHome() are functions.

/** Sidebar becomes a permanent left column at/above this width (web only). */
export const DOCK_BREAKPOINT = 900;
/** Width of that docked column. */
export const DOCK_WIDTH = 300;
/** A result card switches from the stacked/compact row to the wide desktop layout at/above this. */
export const CARD_WIDE_BREAKPOINT = 820;

export type ViewportGate = {
  /** false until the client has mounted. On the server this is ALWAYS false. */
  mounted: boolean;
  /** Platform.OS === 'web' — native has no SSR and no docked/wide layouts. */
  isWeb: boolean;
  /** useWindowDimensions().width — 0 on the server. */
  width: number;
  /** the breakpoint being tested. */
  min: number;
};

/**
 * The single source of truth for "is this width-gated layout flag on?".
 *
 * Returns false before mount NO MATTER HOW WIDE the viewport is — that is the whole point: it makes
 * the first client render reproduce the server's answer byte for byte. Reading the real width before
 * mount is precisely the P0 this file exists to prevent.
 */
export function atLeast({ mounted, isWeb, width, min }: ViewportGate): boolean {
  if (!mounted) return false; // ← SSR parity. Never "optimise" this away.
  if (!isWeb) return false;
  return width >= min;
}

// «من نحن» composition (owner 2026-09-03): at/above this width the portrait artwork box sits BESIDE
// the intro column; below it the story stacks with the art box centered. Lives here — never inline
// in a component — so SSR (width 0) and the client agree through useAtLeast().
export const ABOUT_ART_BREAKPOINT = 640;
