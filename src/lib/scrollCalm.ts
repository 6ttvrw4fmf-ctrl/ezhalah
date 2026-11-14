// THE LIVE-ANIMATION BUDGET (owner 2026-10-24: «on a laptop it feels slow when I scroll … on the phone it's perfect»).
//
// MEASURED on a production build, Chromium 1440×900, a blank page = steady 17 ms frames: the Riyadh results
// scrolled at 34 ms median / 119 ms p95 (500 cards: 67 / 118 ms, 157 long tasks); the graphics compositor thread
// was busy 93 % of the trace. Switching off every CSS animation gave 17 / 35 ms. The page's own code was ~1 s of it.
// The cost is not the motion, it is the LAYERS: each card carries three never-ending gold glints (the ring, the photo
// strip, the button) and each glint clips card content that paints after it, so the browser keeps a composited layer
// (and a rounded mask) for all of it, per card — 45 live animations on the first page, 1,509 after two taps of
// «عرض المزيد», and the laptop adds a docked sidebar sky and full-width hero clouds the phone does not have.
// A PAUSED animation keeps its layer (measured: no gain); only removing it frees the layer.
//
// So the budget is: animation only where it can be seen, and nothing decorative competes with a scroll.
//   · while anything scrolls: the gold glints are removed and the sky/cloud drifts are paused (data-scrolling on <html>);
//   · at rest: only the cards within one screen of the viewport glint (data-near on the card cell), so the live count is
//     ~50 at any list length and switching them costs one frame, not 300 ms on a 500-card list.
// At rest the screen is exactly what it was; the glints replay from the start once scrolling stops.
// The rules live in src/app/+html.tsx (BUDGET_CSS); scripts/verify-live-animation-budget.ts pins all of it, and
// scripts/verify-web-scroll-smooth.mjs measures it in a real browser on every PR.

/** How long after the last scroll event the page counts as «at rest». */
export const SCROLL_QUIET_MS = 180;
/** A card glints at rest while it is within this many screens of the scroller's viewport, above and below. */
export const GLINT_WINDOW_SCREENS = 0.5;

let installed = false;
const restListeners = new Set<() => void>();

/** Mark <html data-scrolling> while ANY element scrolls; clear it SCROLL_QUIET_MS after the last scroll event, and tell
 *  the watchers the page is at rest just BEFORE clearing it (so the glint window is right the moment glints return).
 *  Scroll events do not bubble, so one capture listener on the document hears every inner scroller. Idempotent. */
export function installScrollCalm(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (installed || !doc) return;
  installed = true;
  const root = doc.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  doc.addEventListener('scroll', () => {
    if (!root.hasAttribute('data-scrolling')) root.setAttribute('data-scrolling', '');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { restListeners.forEach((f) => f()); root.removeAttribute('data-scrolling'); }, SCROLL_QUIET_MS);
  }, { capture: true, passive: true });
}

/** The nearest ancestor that actually scrolls vertically (the chat's ScrollView), or null (the viewport scrolls). */
export function nearestScroller(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** Keep `data-near` on exactly the grid's cells within GLINT_WINDOW_SCREENS of the scroller's viewport — computed when
 *  the page COMES TO REST, when the list grows («عرض المزيد»), and when the window is resized; never per frame. (An
 *  IntersectionObserver over 500 cells did this for free on paper, and cost ~3 ms of every frame — measured, 498 runs
 *  while typing in a saved chat — so the answer is read once, from the cells' rectangles: all reads first, then all
 *  writes, so it is one layout and no thrash.) The attribute is set on the DOM node — no React state, no re-render. */
export function watchGlintCells(grid: HTMLElement): () => void {
  const scroller = nearestScroller(grid);
  const mark = () => {
    const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const margin = (box.bottom - box.top) * GLINT_WINDOW_SCREENS;
    const lo = box.top - margin, hi = box.bottom + margin;
    const cells = Array.from(grid.children);
    const near = cells.map((c) => { const r = c.getBoundingClientRect(); return r.bottom > lo && r.top < hi; });
    cells.forEach((c, i) => { if (c.hasAttribute('data-near') !== near[i]) c.toggleAttribute('data-near', near[i]); });
  };
  let frame = 0;
  const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; mark(); }); };
  restListeners.add(mark);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(soon) : null;
  mo?.observe(grid, { childList: true });
  window.addEventListener('resize', soon);
  soon();
  return () => {
    restListeners.delete(mark); mo?.disconnect(); window.removeEventListener('resize', soon);
    if (frame) cancelAnimationFrame(frame);
  };
}

/** Web-only attributes that opt an element into the budget. Spread onto a View: `<View {...GLINT_PROPS}>`. Typed `object`
 *  because React Native's View type has no `dataSet`; react-native-web turns it into data-* attributes. */
export const GLINT_PROPS: object = { dataSet: { glint: '1' } };          // a never-ending gold glint layer
export const GLINT_CELL_PROPS: object = { dataSet: { glintCell: '1' } }; // a result-grid cell that owns glints
export const SKY_CALM_PROPS: object = { dataSet: { skyCalm: '1' } };     // a drifting sky/cloud layer

/** The style rules. One place, injected by +html.tsx, pinned by the barrier. */
export const BUDGET_CSS =
  // gold glints: gone while scrolling, and gone for cells outside the window (a paused one keeps its layer)
  'html[data-scrolling] [data-glint],[data-glint-cell]:not([data-near]) [data-glint]{animation:none!important}' +
  // sky/cloud drifts: paused while scrolling (a pause keeps the clouds where they are — no jump when you stop)
  'html[data-scrolling] [data-sky-calm]{animation-play-state:paused!important}';
