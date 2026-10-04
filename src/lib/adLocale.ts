// THE AD OPENS IN THE APP'S LANGUAGE (owner 2026-10-03: «when Ezhalah is in Arabic … it should display
// in Arabic»). Pure and import-free so scripts/verify-in-app-viewer-allowlist.ts can execute it.
//   Deal App: the first path segment is the language (/ar/…, /en/…).
//   Gathern:  Arabic is the unprefixed default; English is /en/….
// Every other site is returned untouched (Aqar has its own rule in openListing.ts).
export function localizeAdUrl(url: string | null | undefined, locale: string): string | undefined {
  if (!url) return undefined;
  const en = locale === 'en';
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'dealapp.sa') {
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
