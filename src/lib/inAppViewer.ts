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

// ── THE BROWSER PANE (owner 2026-10-03: «make it seem like Safari / Chrome») ─────────────────────
// Everything below is pure for the same reason as addAdTab: the verify script executes it.

/** One tab in the pane. `url: ''` is the "+" start page (no site loaded yet). */
export type AdTab = { source: string; id: number; title: string; url: string; nonce?: number };
export const adTabKey = (t: { source: string; id: number }) => `${t.source}:${t.id}`;

// HIDE IS NOT CLOSE (owner 2026-10-03: «closing doesn't mean he deletes it, it just means he wants
// it hidden»). The pane's own ✕, Escape and the browser's Back HIDE the pane: every tab stays (and
// stays mounted, so a half-finished booking survives). A tab's ✕ closes that one tab for real;
// closing the last one clears the pane. A hidden pane comes back with the next card click (or the
// browser's Forward); there is deliberately no on-screen reopen button (owner 2026-10-03).
export type AdPane<T> = { tabs: T[]; active: number; hidden: boolean };
export const EMPTY_AD_PANE: AdPane<never> = { tabs: [], active: 0, hidden: false };

/** A card click (or "+"): new tab or refront, and the pane is SHOWN — also from hidden.
 *  RE-CLICKING A LISTING GOES BACK TO IT (owner 2026-10-03): the user may have wandered inside the ad,
 *  so a card whose tab is already open fronts that tab AND restarts its frame at the listing's own URL
 *  (a nonce bump remounts the frame). Switching with the tab strip never resets anything. */
export function openAdTab<T extends { source: string; id: number; nonce?: number }>(
  p: AdPane<T>, l: T, max: number = MAX_AD_TABS,
): AdPane<T> & { evicted: boolean } {
  const r = addAdTab(p.tabs, l, max);
  const reclicked = r.tabs === p.tabs; // addAdTab hands back the SAME array only for an open card
  const tabs = reclicked
    ? r.tabs.map((t, i) => (i === r.active ? { ...t, nonce: (t.nonce ?? 0) + 1 } : t))
    : r.tabs;
  return { tabs, active: r.active, hidden: false, evicted: r.evicted };
}
export function closeAdTab<T>(p: AdPane<T>, i: number): AdPane<T> {
  const tabs = p.tabs.filter((_, x) => x !== i);
  if (tabs.length === 0) return { tabs, active: 0, hidden: false };
  return { tabs, active: p.active > i ? p.active - 1 : Math.min(p.active, tabs.length - 1), hidden: p.hidden };
}
export const hideAdPane = <T>(p: AdPane<T>): AdPane<T> => ({ ...p, hidden: p.tabs.length > 0 });
export const showAdPane = <T>(p: AdPane<T>): AdPane<T> => ({ ...p, hidden: false });

// THE "+" TAB'S INPUT («اكتب رابط موقع أو ابحث»). An allowlisted site opens inside as a tab; any
// other URL opens in a real browser tab; plain words open a Google search in a real browser tab
// (Google refuses to be framed). Only http(s) is ever opened: `javascript:` / `data:` text is words.
export type AddressAction =
  | { kind: 'in-app'; url: string; host: string }
  | { kind: 'new-tab'; url: string }
  | { kind: 'search'; url: string };
const HOST_LIKE = /^(?:[^\s/?#:@]+\.)+[a-z؀-ۿ]{2,}(?::\d+)?(?:[/?#].*)?$/i;
export function resolveAddressInput(raw: string): AddressAction | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const search: AddressAction = { kind: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(text)}` };
  const candidate = /^https?:\/\//i.test(text) ? text : HOST_LIKE.test(text) ? `https://${text}` : null;
  if (!candidate) return search;
  let u: URL;
  try { u = new URL(candidate); } catch { return search; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return search;
  const host = inAppViewerHost(u.href);
  if (!host) return { kind: 'new-tab', url: u.href };
  u.protocol = 'https:'; // an http frame inside our https page would be blocked as mixed content
  return { kind: 'in-app', url: u.href, host };
}

/** The address bar's two tones: host (dark) and the rest (muted). The URL we LOADED, nothing else. */
export function splitUrlForDisplay(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    let rest = u.pathname + u.search + u.hash;
    if (rest === '/') rest = '';
    try { rest = decodeURI(rest); } catch { /* keep the encoded form */ }
    return { host: u.hostname.replace(/^www\./, ''), rest };
  } catch { return { host: url, rest: '' }; }
}

// ← / → INSIDE AN AD. A cross-origin frame's history cannot be read, but the browser keeps ONE joint
// session history for the page and all its frames, and window.history.back() steps whichever frame
// navigated LAST. So we mirror that list: each in-frame navigation we observe (a frame `load` after
// its first) pushes that tab's key; ← is offered only to the tab that owns the top entry, because
// that is the only frame back() would move. Closing or reloading a tab removes its frame, and the
// browser drops that frame's entries with it.
// ponytail: load-count mirror — same-document navigations inside the ad (pushState) fire no load and
// are not seen; the browser's own Back pressed while a frame is on top desyncs it (worst case our ←
// hides the pane, tabs intact). Upgrade path: the Navigation API, if frames ever expose it to us.
export type FrameNav = { stack: string[]; pos: number };
export const EMPTY_FRAME_NAV: FrameNav = { stack: [], pos: 0 };
export const canFrameBack = (n: FrameNav, key: string) => n.pos > 0 && n.stack[n.pos - 1] === key;
export const canFrameForward = (n: FrameNav, key: string) => n.pos < n.stack.length && n.stack[n.pos] === key;
/** The user navigated inside tab `key`: forward entries are gone, this one is on top. */
export const frameNavigated = (n: FrameNav, key: string): FrameNav =>
  ({ stack: [...n.stack.slice(0, n.pos), key], pos: n.pos + 1 });
/** We stepped the joint history ourselves (the caller checked canFrameBack / canFrameForward). */
export const frameStepped = (n: FrameNav, dir: -1 | 1): FrameNav => ({ stack: n.stack, pos: n.pos + dir });
/** Tab `key`'s frame was removed (closed or reloaded): its entries leave the joint history. */
export const frameDropped = (n: FrameNav, key: string): FrameNav =>
  ({ stack: n.stack.filter((k) => k !== key), pos: n.stack.slice(0, n.pos).filter((k) => k !== key).length });
