// INSTANT FIRST MAP (owner 2026-11-04: «why does it feel slow moving between tabs»). A few seconds after any page has
// settled — when the browser is idle — fetch the map screen's code and everything it needs (Apple's script, the region
// outlines, a map key, the labels and dots feeds) so the first tap on «خريطة» has nothing left to download. Once per
// page, web only, and skipped when the visitor asked to save data. Nothing here is on the first download's path: the
// map code stays its own chunk, fetched later (ALWAYS FAST, scripts/web-bundle-budget.mjs).
let started = false;   // the fetches have begun (once per page)
let armed = false;     // the timer and the first-touch listener are set

// 1.2 s + at most 1.5 s of waiting for idle (was 2.5 s + 4 s): a visitor who taps «خريطة» right after the page
// answers measured 5.8 s to city names on a mid-range phone (site-speed robot, 2026-11-05), because nothing had been
// fetched yet. The first touch anywhere on the page now starts the warm-up at once (warmMapNow), whichever is first.
export const WARM_DELAY_MS = 1200;
// THE TABS' CODE GOES FIRST (owner 2026-11-13: «slow slow slow moving between AI agent, map …»). Measured with Safari's
// engine: tapping «خريطة» or «الوسيط الذكي» 1.5 s after opening downloaded 286 / 614 KB on the tap and took ~1 s; with
// that code already fetched the same tap took 0.37 s. The three screens' code alone (no map data, no feeds) is fetched
// CODE_WARM_MS after the page starts — light enough not to slow the home page; the map's data still waits WARM_DELAY_MS.
export const CODE_WARM_MS = 300;
let codeStarted = false;
const goCode = () => {
  if (codeStarted) return;
  codeStarted = true;
  void import('@/app/agent').catch(() => { codeStarted = false; });
  void import('@/app/map').catch(() => { codeStarted = false; });
  void import('@/app/index').catch(() => { codeStarted = false; });
  // The map screen's own pieces (code only — Apple's script and the feeds still wait for go()).
  void import('@/components/AppleMap').catch(() => {});
  void import('@/components/MapDealRow').catch(() => {});
};

const go = () => {
  if (started) return;
  started = true;
  Promise.all([import('@/components/AppleMap'), import('@/components/MapDealRow')])
    .then(([a]) => { a.prewarmMap(); })
    .catch(() => { started = false; });   // a failed chunk fetch may be tried again on the next page
  // THE OTHER TABS TOO (owner 2026-11-04: «changing between filter, smart broker and map»): each tab is its own
  // route chunk, fetched on the first tap — on a phone over 4G that download is most of the first switch. Fetch all
  // three screens' code now (the one already open is a no-op), plus the site list the Smart Broker reads on opening.
  void import('@/app/agent').catch(() => {});
  void import('@/app/map').catch(() => {});
  void import('@/app/index').catch(() => {});
  void import('@/data/loaderActivePlatforms').then((m) => m.loadHiddenPlatformNames()).catch(() => {});
};

/** Start the warm-up now — the visitor is about to act (owner 2026-11-05: «so slow … gets stuck»). */
export function warmMapNow(): void {
  if (typeof window === 'undefined') return;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  go();
}

export function warmMapSoon(delayMs = WARM_DELAY_MS): void {
  if (armed || started || typeof window === 'undefined' || typeof document === 'undefined') return;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  armed = true;
  setTimeout(goCode, CODE_WARM_MS);
  // the first finger on the page (a pointerdown comes before the tap on «خريطة» itself) starts it at once
  window.addEventListener('pointerdown', warmMapNow, { once: true, passive: true, capture: true });
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  setTimeout(() => (idle ? idle(go, { timeout: 1500 }) : go()), delayMs);
}
