// INSTANT FIRST MAP (owner 2026-11-04: «why does it feel slow moving between tabs»). A few seconds after any page has
// settled — when the browser is idle — fetch the map screen's code and everything it needs (Apple's script, the region
// outlines, a map key, the labels and dots feeds) so the first tap on «خريطة» has nothing left to download. Once per
// page, web only, and skipped when the visitor asked to save data. Nothing here is on the first download's path: the
// map code stays its own chunk, fetched later (ALWAYS FAST, scripts/web-bundle-budget.mjs).
let started = false;

export const WARM_DELAY_MS = 2500;

export function warmMapSoon(delayMs = WARM_DELAY_MS): void {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  started = true;
  const go = () => {
    Promise.all([import('@/components/AppleMap'), import('@/components/MapDealRow')])
      .then(([a]) => { a.prewarmMap(); })
      .catch(() => { started = false; });   // a failed chunk fetch may be tried again on the next page
  };
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  setTimeout(() => (idle ? idle(go, { timeout: 4000 }) : go()), delayMs);
}
