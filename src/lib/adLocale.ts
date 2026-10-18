// THE AD OPENS IN THE APP'S LANGUAGE (owner 2026-10-03: «when Ezhalah is in Arabic … it should display
// in Arabic»). Pure and import-free so scripts/verify-in-app-viewer-allowlist.ts can execute it.
//   Deal App and FIRST_SEGMENT_HOSTS: the first path segment is the language (/ar/…, /en/…).
//   Gathern:  Arabic is the unprefixed default; English is /en/….
// Every other site is returned untouched (Aqar has its own rule in openListing.ts).
// FIRST_SEGMENT_HOSTS were proven 2026-10-16 on real ads: both /ar and /en answer 200 at the same
// path with <html lang> matching, the same ad numbers, and no frame-blocking header. mar-ksa.com
// was left off (its /en redirects to /ar), and so was daryusuf.com (its /ar path is a 404).
const FIRST_SEGMENT_HOSTS = ['dealapp.sa', 'rakez.sa', 'snam.sa', 'gomenassat.com', 'aoujestates.com', 'abeea.com.sa'];
export function localizeAdUrl(url: string | null | undefined, locale: string): string | undefined {
  if (!url) return undefined;
  const en = locale === 'en';
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (FIRST_SEGMENT_HOSTS.includes(host)) {
    u.pathname = u.pathname.replace(/^\/(?:ar|en)(?=\/)/, en ? '/en' : '/ar');
    return u.href;
  }
  if (host === 'gathern.co') {
    const bare = u.pathname.replace(/^\/en(?=\/|$)/, '');
    u.pathname = en ? `/en${bare}` : bare;
    return u.href;
  }
  return url;
}
