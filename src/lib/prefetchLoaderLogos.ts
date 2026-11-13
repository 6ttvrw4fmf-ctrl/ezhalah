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

// THE MAP'S CITY NAMES GO FIRST (🔧 2026-11-11, site-speed-live «map: tapped at once» 7,321 ms vs 5,000). Measured on
// the robot's mid-range phone (1.5 Mbps, run 43102576192): the city-names feed map_areas_feed_ar took 311 → 7,164 ms
// after the tap while the server answered in ~61 ms — it shared the line with these ~200 logos, which this prefetch
// fired 2.07 s after the tap. A visitor ON THE MAP does not need the search loader's logos yet; their city names are
// what they wait for. So when the prefetch fires on /map before a city name is on screen, it waits for the first
// one (polled, capped at MAP_FIRST_CAP_MS so the logos always arrive), then fetches. Every other page: unchanged.
export const MAP_FIRST_POLL_MS = 250;
export const MAP_FIRST_CAP_MS = 10_000;

type MapEnv = { path: () => string; labelled: () => boolean; wait: (fn: () => void, ms: number) => unknown };

const browserMapEnv = (): MapEnv | null => (typeof window === 'undefined' || typeof document === 'undefined' ? null : {
  path: () => window.location.pathname,
  // the same marker the speed robot waits for: a city/area name laid out on screen
  labelled: () => [...document.querySelectorAll('[data-testid=map-area]')].some((a) => {
    const r = a.getBoundingClientRect();
    return r.width > 0 && r.top >= 0 && r.top < window.innerHeight;
  }),
  wait: (fn, ms) => setTimeout(fn, ms),
});

/** Runs `fetchLogos` now — or, on the map before its first city name is painted, once it is (at most capMs later). */
export function afterMapIsLabelled(fetchLogos: () => void, env: MapEnv | null = browserMapEnv(), capMs = MAP_FIRST_CAP_MS): void {
  if (!env || env.path() !== '/map' || env.labelled()) { fetchLogos(); return; }
  let waited = 0;
  const tick = () => {
    if (env.labelled() || env.path() !== '/map' || waited >= capMs) { fetchLogos(); return; }
    waited += MAP_FIRST_POLL_MS;
    env.wait(tick, MAP_FIRST_POLL_MS);
  };
  env.wait(tick, MAP_FIRST_POLL_MS);
}
