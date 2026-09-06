// CANONICAL photo-display URL — one place that decides the URL the card's <img> actually loads.
//
// THE DEFECT (production, 2026-09-05, owner-found on the live site). Sadin serves its listing images
// with `Cross-Origin-Resource-Policy: same-origin`. A cross-origin <img> from ezhalah-app.vercel.app
// is therefore BLOCKED by the browser (Chrome: net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin; even a
// no-cors fetch throws), expo-image's onError fires, and the card falls to "No photo available" even
// though the DB holds a real, publicly-fetchable photo. Verified live: BOTH Sadin URL shapes fail —
// `sadin.com.sa/media/property-assets/…/display` (200 + CORP) and `www.sadin.com.sa/media/
// properties/…/main.png` (308 www→root, then CORP). Of the nine image-repaired platforms, Sadin is
// the ONLY one whose host sets a blocking CORP; the other eight render fine cross-origin.
//
// THE FIX. Route Sadin images through a SAME-ORIGIN Vercel rewrite (`/_img/sadin/*` → sadin.com.sa,
// declared in vercel.json). Vercel proxies the bytes server-side, so the browser sees a resource on
// ezhalah-app's own origin — CORP (a cross-origin-only check) no longer applies and the image
// renders. No third party, no credentials, and the rewrite destination is pinned to sadin.com.sa so
// it is not an open proxy. The rewrite also strips `www.`, side-stepping the 308 hop.
//
// This is the shared/canonical layer: every photo entering the client (remote.ts finalize) passes
// through here, so a card, a share image, or any future photo consumer all get the renderable URL.
const SADIN_HOSTS = new Set(['sadin.com.sa', 'www.sadin.com.sa']);

export function photoDisplayUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  let u: URL;
  try { u = new URL(raw); } catch { return raw; } // relative/garbage → leave untouched
  if (SADIN_HOSTS.has(u.hostname)) {
    // `/_img/sadin` + the ORIGINAL path + query — a same-origin path the Vercel rewrite proxies to
    // https://sadin.com.sa/<path><query>. Relative on purpose: it resolves against whatever origin
    // is serving the app (prod, preview, or localhost), never a hardcoded domain.
    return `/_img/sadin${u.pathname}${u.search}`;
  }
  return raw;
}
