// THE SEARCH LOADER'S LOGOS ARE ON THE PHONE BEFORE THE LOADER APPEARS (owner, 2026-10-25).
//
// Owner's iPhone screenshot: «نبحث في 148 منصة عقارية…» with every tile showing its name and an empty
// frame — the logos never arrived. The loader is up for a few seconds and mounts ~145 logo PNGs
// (≈3 MB); on mobile data they were still downloading when the results replaced it. Two causes, two
// fixes: vercel.json served /assets/* with `max-age=0, must-revalidate`, so every search re-fetched
// them (now `immutable` — every /assets/ name carries a content hash, measured on the export); and
// nothing fetched them before the loader mounted. This schedules that fetch a moment after the app
// opens, web only (native bundles its assets), skipped when the browser asks to save data.
//
// Import-light on purpose (no react-native, no expo-image): scripts/verify-loader-logos-prefetched.ts
// imports and EXECUTES it.
export const LOGO_PREFETCH_DELAY_MS = 2500;

/** The web URLs of the logos (a web `require()` of an image is `{ uri, width, height }`); native ids are skipped. */
export function logoUris(logos: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const l of logos) {
    const uri = l && typeof l === 'object' ? (l as { uri?: unknown }).uri : null;
    if (typeof uri === 'string' && uri.length > 0) out.add(uri);
  }
  return [...out];
}

type Nav = { connection?: { saveData?: boolean } } | null | undefined;

/** Fetches the logos once, `delayMs` after the call. Returns false (nothing scheduled) on Save-Data or with no URLs. */
export function scheduleLogoPrefetch(
  logos: readonly unknown[],
  prefetch: (uris: string[]) => unknown,
  nav: Nav = typeof navigator !== 'undefined' ? (navigator as Nav) : null,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  delayMs: number = LOGO_PREFETCH_DELAY_MS,
): boolean {
  if (nav?.connection?.saveData) return false;
  const uris = logoUris(logos);
  if (uris.length === 0) return false;
  schedule(() => { try { void prefetch(uris); } catch { /* a failed prefetch only means the loader fetches them itself */ } }, delayMs);
  return true;
}
