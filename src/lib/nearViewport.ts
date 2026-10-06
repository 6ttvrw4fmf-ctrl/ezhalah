// Calls `onNear` once `el` comes within NEAR_MARGIN of the screen, then stops watching. Used to hold
// back per-card photo work (ResultCard's ListingPhoto probe) until a card is about to be seen.
//
// `scrollMargin` is what makes this work for the results list: the cards scroll inside a
// react-native-web ScrollView, and that scroller clips its children, so `rootMargin` alone (which
// only widens the WINDOW) would wait until a card is actually visible. Browsers without
// `scrollMargin` (Safari < 26) ignore the key and fall back to exactly that, which is later but
// still correct.
//
// No IntersectionObserver, no element to watch, or one it refuses to observe → `onNear` runs right
// away: the gate can only delay work, never lose it.
export const NEAR_MARGIN = '1250px'; // Chrome's own lazy-<img> distance on a fast connection

type IOInit = IntersectionObserverInit & { scrollMargin?: string };
type IOLike = new (cb: (entries: { isIntersecting: boolean }[]) => void, init?: IOInit) => { observe(el: Element): void; disconnect(): void };

export function whenNear(
  el: unknown,
  onNear: () => void,
  IO: IOLike | undefined = (globalThis as { IntersectionObserver?: IOLike }).IntersectionObserver,
): () => void {
  if (!IO || !el) { onNear(); return () => {}; }
  let done = false;
  const io = new IO((entries) => {
    if (done || !entries.some((e) => e.isIntersecting)) return;
    done = true;
    io.disconnect();
    onNear();
  }, { rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN });
  try { io.observe(el as Element); } catch { done = true; io.disconnect(); onNear(); }
  return () => { done = true; io.disconnect(); };
}
