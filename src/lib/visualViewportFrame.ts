// THE APP MUST OCCUPY THE VISIBLE WINDOW, NOT THE PAGE. (owner report, 2026-09-05: on iPhone,
// opening the keyboard "basically loses the conversation above it".)
//
// WHAT iOS SAFARI ACTUALLY DOES, measured live on ezhalah-app.vercel.app before this was written.
// Two things happen when the keyboard opens, and only the first is widely known:
//   1. the VISUAL viewport shrinks — visualViewport.height drops by the keyboard height, while
//      window.innerHeight (the LAYOUT viewport) does not change at all; and
//   2. Safari SCROLLS the layout viewport to bring the focused field into view, so
//      visualViewport.offsetTop becomes > 0.
// The app was compensating for (1) with per-screen bottom padding and ignoring (2) entirely. So the
// composer landed correctly above the keyboard — which is why the bug did not look like a keyboard
// bug — while everything above it slid out of the top of the visible window with the page.
//
// MEASURED, 390x844, a 336px keyboard, Safari scrolled 150px:
//   visible window [150, 658]  ·  messages 120–538  → clipped 30px at the top, header entirely gone
//   after this fix:            ·  messages 270–352  → fully inside the window
//
// THE FIX. Pin the app root to the visible window: position it at visualViewport.offsetTop with
// height visualViewport.height. Then the root IS what the user can see, every screen's normal
// bottom-anchored layout lands just above the keyboard for free, and the scroll area shrinks
// instead of being pushed off-screen — which is exactly the ChatGPT-mobile behaviour asked for.
//
// AND THE SECOND HALF, which the measurement forced: once the root is the visible window, a screen
// that ALSO adds keyboard padding compensates twice. Live proof — the composer floated 259px above
// the keyboard, and 259 − 186 (the padding /agent was still adding) = 73, the ordinary gap. So
// screenKeyboardInset() is 0 on web, and screens read it instead of computing their own.
//
// NOTE ON IMPORTS: like lib/bottomPromptInset.ts, this module imports nothing from react-native, so
// scripts/verify-mobile-keyboard-layout.ts can execute the geometry in plain node. `typeof window`
// is both the loadable check and the honest one: on native there is no visual viewport at all.
import { useEffect } from 'react';

export type Frame = { top: number; height: number };

/** Where the app root must sit to cover exactly what the user can see. */
export function rootFrame(v: { visualHeight: number; visualOffsetTop: number }): Frame {
  return { top: Math.max(0, Math.round(v.visualOffsetTop)), height: Math.max(0, Math.round(v.visualHeight)) };
}

/** True when `frame` covers the visible window exactly — no clipping, no blank strip. */
export function coversVisibleWindow(frame: Frame, v: { visualHeight: number; visualOffsetTop: number }): boolean {
  const want = rootFrame(v);
  return frame.top === want.top && frame.height === want.height;
}

/**
 * The extra bottom padding a SCREEN must add for the keyboard. Zero on web, because the root already
 * excludes the keyboard — a screen adding its own would lift the composer twice. Kept as a function
 * so the rule is stated in one place and a screen cannot quietly reintroduce its own arithmetic.
 */
export function screenKeyboardInset(): number {
  return 0;
}

/** Bottom-anchored content inside the pinned root, in LAYOUT coordinates — what a barrier asserts on. */
export function composerBottomWithin(v: { visualHeight: number; visualOffsetTop: number }): number {
  const f = rootFrame(v);
  return f.top + f.height;
}

/**
 * Pin the web app root to the visual viewport. No-op off web, and a no-op in any browser without
 * visualViewport — there the layout viewport already IS the visible window, which is the pre-2015
 * behaviour this compensates for.
 */
export function useVisualViewportRoot(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const vv = window.visualViewport;
    const root = document.getElementById('root');
    if (!vv || !root) return;

    const apply = () => {
      const f = rootFrame({ visualHeight: vv.height, visualOffsetTop: vv.offsetTop });
      root.style.position = 'fixed';
      root.style.left = '0';
      root.style.right = '0';
      root.style.top = `${f.top}px`;
      root.style.height = `${f.height}px`;
    };
    // resize fires as the keyboard animates; scroll fires as Safari moves the layout viewport under
    // it. Both are needed — with only resize the root lands at the right SIZE in the wrong PLACE.
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    apply();
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      // Restore, so a hot reload or an unmount cannot strand the app at a stale height.
      root.style.position = ''; root.style.left = ''; root.style.right = '';
      root.style.top = ''; root.style.height = '';
    };
  }, []);
}
