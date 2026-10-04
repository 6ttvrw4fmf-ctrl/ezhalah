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

// THE TAB MODEL (owner 2026-10-03: «whenever I click, a new tab happens … I click Deal again, a new tab
// happens to Deal … as many tabs as possible», like a browser). Pure so
// scripts/verify-in-app-viewer-allowlist.ts can execute it: EVERY allowed click opens a NEW tab — even
// for a listing that is already open — and fronts it. Nothing is deduplicated and no click resets an
// older tab; the tab strip is the only way back to one. The strip caps at MAX_AD_TABS (each tab is a
// live page kept mounted, so memory is the ceiling, not taste) and the OLDEST tab is evicted, with a
// small hint from the UI.
export const MAX_AD_TABS = 12;

// ── THE BROWSER PANE (owner 2026-10-03: «make it seem like Safari / Chrome») ─────────────────────
// Everything below is pure for the same reason as addAdTab: the verify script executes it.

/** One tab in the pane. `tid` is unique per tab for the whole session, so two tabs of the SAME listing
 *  have different keys (frames, ← history and reloads are all keyed by it). */
export type AdTab = { source: string; id: number; title: string; url: string; tid?: number };
export const adTabKey = (t: { source: string; id: number; tid?: number }) =>
  `${t.source}:${t.id}${t.tid != null ? `#${t.tid}` : ''}`;

// HIDE IS NOT CLOSE (owner 2026-10-03: «closing doesn't mean he deletes it, it just means he wants
// it hidden»). The pane's own ✕, Escape and the browser's Back HIDE the pane: every tab stays (and
// stays mounted, so a half-finished booking survives). A tab's ✕ closes that one tab for real;
// closing the last one clears the pane. A hidden pane comes back with the next card click (or the
// browser's Forward); there is deliberately no on-screen reopen button (owner 2026-10-03).
// `seq` is the last tab id handed out: it only counts up (closing tabs never frees an id).
export type AdPane<T> = { tabs: T[]; active: number; hidden: boolean; seq: number };
export const EMPTY_AD_PANE: AdPane<never> = { tabs: [], active: 0, hidden: false, seq: 0 };

/** A card click: ALWAYS a new tab, fronted, and the pane is SHOWN — also from hidden. */
export function openAdTab<T extends { source: string; id: number; tid?: number }>(
  p: AdPane<T>, l: T, max: number = MAX_AD_TABS,
): AdPane<T> & { evicted: boolean } {
  const tid = p.seq + 1;
  let tabs: T[] = [...p.tabs, { ...l, tid }];
  const evicted = tabs.length > max;
  if (evicted) tabs = tabs.slice(tabs.length - max);
  return { tabs, active: tabs.length - 1, hidden: false, seq: tid, evicted };
}
export function closeAdTab<T>(p: AdPane<T>, i: number): AdPane<T> {
  const tabs = p.tabs.filter((_, x) => x !== i);
  if (tabs.length === 0) return { tabs, active: 0, hidden: false, seq: p.seq };
  return { tabs, active: p.active > i ? p.active - 1 : Math.min(p.active, tabs.length - 1), hidden: p.hidden, seq: p.seq };
}
export const hideAdPane = <T>(p: AdPane<T>): AdPane<T> => ({ ...p, hidden: p.tabs.length > 0 });
export const showAdPane = <T>(p: AdPane<T>): AdPane<T> => ({ ...p, hidden: false });

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
