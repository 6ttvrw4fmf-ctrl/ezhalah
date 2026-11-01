// THE AD OPENS IN THE APP'S LANGUAGE (owner 2026-10-03: «when Ezhalah is in Arabic … it should display
// in Arabic»). Pure and import-free so scripts/verify-in-app-viewer-allowlist.ts can execute it.
//   Deal App and FIRST_SEGMENT_HOSTS: the first path segment is the language (/ar/…, /en/…).
//   Gathern:  Arabic is /ar/…, English is /en/…. The UNPREFIXED /view/… (what we store) is never opened:
//   measured 2026-10-20 by 🔧 on 280 random served units like a phone, 7 live units (2.5%) answered
//   307 → gathern.co/ar?error=500 on that path while /ar/view/ and /en/view/ opened all of them
//   (units 272013, 245201, 250785, 253015, 260160, 256173, 62414; backlog 768). The owner's rule:
//   a customer never lands on a dead page — so the Arabic app opens the address Gathern's own
//   Arabic site uses, the same way the English app already opens /en/.
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
    const bare = u.pathname.replace(/^\/(?:ar|en)(?=\/|$)/, '');
    u.pathname = en ? `/en${bare}` : `/ar${bare}`;
    return u.href;
  }
  return url;
}
