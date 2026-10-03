// WHICH SOURCE SITES OPEN INSIDE EZHALAH (web only; owner 2026-10-03, practice version).
//
// A listing from one of these hosts opens in the in-app ad viewer (AdViewer.tsx) instead of a new
// tab: a side panel beside the results on a laptop, a full-screen sheet on a phone. Every other host
// keeps today's behaviour exactly (src/lib/openListing.ts → window.open on web, the system in-app
// browser on native).
//
// A host earns its place here ONLY after its real ad page was proven to render inside a plain
// <iframe> with the site's own headers — no X-Frame-Options, no CSP frame-ancestors, no
// frame-busting script. Both entries were proven 2026-10-03 with Playwright against a local page
// (dealapp.sa/ar/ad-details/530440, gathern.co/view/193264/unit/270328). We never proxy or strip a
// site's headers to force an embed; a site that says no stays a new tab.
export const IN_APP_VIEWER_HOSTS = ['dealapp.sa', 'gathern.co'] as const;

/** The allowlisted host a listing URL belongs to, or null when it must open the old way. */
export function inAppViewerHost(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const bare = host.replace(/^www\./, '');
  return IN_APP_VIEWER_HOSTS.find((h) => bare === h || bare.endsWith('.' + h)) ?? null;
}

// THE TAB MODEL (owner revision 2026-10-03: «whenever I click a new tab pops up», like a browser).
// Pure so scripts/verify-in-app-viewer-allowlist.ts can execute it: every allowed click opens a NEW
// tab; clicking a card whose tab is already open REFRONTS that tab (no duplicate); the strip caps at
// MAX_AD_TABS and the OLDEST tab is evicted (the UI shows a small hint when that happens).
export const MAX_AD_TABS = 6;

export function addAdTab<T extends { source: string; id: number }>(
  tabs: T[], l: T, max: number = MAX_AD_TABS,
): { tabs: T[]; active: number; evicted: boolean } {
  const key = `${l.source}:${l.id}`;
  const existing = tabs.findIndex((t) => `${t.source}:${t.id}` === key);
  if (existing >= 0) return { tabs, active: existing, evicted: false };
  let next = [...tabs, l];
  const evicted = next.length > max;
  if (evicted) next = next.slice(next.length - max);
  return { tabs: next, active: next.length - 1, evicted };
}
