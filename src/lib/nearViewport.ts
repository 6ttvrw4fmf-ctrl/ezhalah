// Calls `onNear` once `el` comes within NEAR_MARGIN of the screen, then stops watching. Used to hold
// back per-card photo work (ResultCard's ListingPhoto probe) until a card is about to be seen.
//
// WHAT is watched, against WHAT (nearGeometry): the cards scroll inside a react-native-web ScrollView,
// which clips them, so the observer's root is that nearest scrolling ancestor (a root margin is
// honoured by every engine; `scrollMargin` is kept for the window case). And a card mounted "still"
// by «عرض المزيد» sits inside `content-visibility: auto` (CardReveal CardIn): WebKit reports nothing
// inside skipped content until it is on screen, so the outermost such wrapper is watched instead —
// it always has a real box. Measured 2026-10-09, WebKit 26.5, brisk scroll over 72 new cards:
// watching the photo itself started each photo ~75 ms before its card was on screen and 43 cards
// flashed an empty box; watching the wrapper instead: 0–1 of 72.
//
// No IntersectionObserver, no element to watch, or one it refuses to observe → `onNear` runs right
// away: the gate can only delay work, never lose it.
//
// ~6 phone cards ahead, so a brisk scroll never meets an empty box. Chrome's own lazy <img> reaches
// only 1250px on a fast connection and Safari's is shorter still; the probe's fetch fills the cache,
// so this margin is what actually decides how early a photo is ready.
export const NEAR_MARGIN = '2500px';

type IOInit = IntersectionObserverInit & { scrollMargin?: string };
type IOLike = new (cb: (entries: { isIntersecting: boolean }[]) => void, init?: IOInit) => { observe(el: Element): void; disconnect(): void };

type Styled = { overflowY?: string; contentVisibility?: string };

/** Watch the outermost `content-visibility` wrapper (or `el` itself) against the nearest scroller. */
export function nearGeometry(el: unknown): { target: unknown; root: Element | null } {
  const style = (globalThis as { getComputedStyle?: (e: Element) => Styled }).getComputedStyle;
  let target = el;
  if (style) {
    for (let p = (el as Element | null)?.parentElement; p; p = p.parentElement) {
      const s = style(p);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') return { target, root: p };
      if (s.contentVisibility && s.contentVisibility !== 'visible') target = p;
    }
  }
  return { target, root: null };
}

export function whenNear(
  el: unknown,
  onNear: () => void,
  IO: IOLike | undefined = (globalThis as { IntersectionObserver?: IOLike }).IntersectionObserver,
): () => void {
  if (!IO || !el) { onNear(); return () => {}; }
  let done = false;
  const { target, root } = nearGeometry(el);
  const io = new IO((entries) => {
    if (done || !entries.some((e) => e.isIntersecting)) return;
    done = true;
    io.disconnect();
    onNear();
  }, { root, rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN });
  try { io.observe(target as Element); } catch { done = true; io.disconnect(); onNear(); }
  return () => { done = true; io.disconnect(); };
}
