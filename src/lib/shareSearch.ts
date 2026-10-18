// SHARE A SEARCH (owner 2026-10-17). A signed-in user's «مشاركة» under a result sends THAT search,
// not the bare homepage: whoever opens the link sees «عقارات من {name} لك على إزهله», taps «اضغط وشوف
// العقارات», and lands on the same results — saved to their own list, because it runs through the
// Filter's ordinary search path. A guest's Share is unchanged (the homepage link).
//
// The owner-approved wording (option C, gender-neutral) never says "sign in" — the sign-in screen
// simply appears after the tap for a visitor who isn't signed in.
//
// THE LINK LANDS ON HOME, NEVER ON /agent. A pasted link must not execute a search (the appSession
// gate, owner 2026-08-16 — see src/lib/appSession.ts and src/app/agent.tsx). So the link is
// `/?share=<payload>`: Home shows the card, and the user's TAP is what runs the search.
//
// Pure: no React, no storage, no network. Executed by scripts/verify-share-search-link.ts.
import type { SearchQuery } from '@/data/search';

export const SHARE_PARAM = 'share';
export const SHARE_PAYLOAD_VERSION = 1;

/** The approved lines (owner 2026-10-17, option C). {name} is the sender's first name. */
export const SHARE_COPY = {
  ar: {
    message: 'عقارات من {name} لك على إزهله 🦅 اضغط الرابط وشوف 👇',
    title: 'عقارات من {name} لك على إزهله',
    button: 'اضغط وشوف العقارات',
  },
  en: {
    message: 'Properties from {name}, just for you on Ezhalah 🦅 Tap to see 👇',
    title: 'Properties from {name}, just for you on Ezhalah',
    button: 'Tap to see the properties',
  },
} as const;

const firstName = (name: string): string => (name ?? '').trim().split(/\s+/)[0] ?? '';
const fill = (tpl: string, name: string) => tpl.replace('{name}', name);

/** The text sent next to the link, or null when there is no name to say it with. */
export function shareMessage(name: string, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  return n ? fill(SHARE_COPY[locale].message, n) : null;
}
export function shareLandingTitle(name: string, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  return n ? fill(SHARE_COPY[locale].title, n) : null;
}

// UTF-8 safe base64url (Arabic names and place names survive the round trip; no '+', '/', '=').
function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

/** Packs the search and the sender's first name into the link payload. */
export function encodeSharePayload(q: SearchQuery, senderName: string, locale: 'ar' | 'en' = 'ar'): string | null {
  const n = firstName(senderName);
  if (!n || !q || typeof q.location !== 'string') return null;
  // `l` = the sender's language, so the WhatsApp preview card speaks it (owner 2026-10-17).
  return toB64Url(JSON.stringify({ v: SHARE_PAYLOAD_VERSION, n, l: locale, q }));
}

/** Unpacks a payload; anything malformed, foreign or from another version is null (never a guess). */
export function decodeSharePayload(raw: string | null | undefined): { q: SearchQuery; name: string; locale: 'ar' | 'en' } | null {
  if (!raw || raw.length > 8000) return null;
  const json = fromB64Url(raw);
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || p.v !== SHARE_PAYLOAD_VERSION) return null;
    const name = firstName(String(p.n ?? ''));
    const q = p.q;
    if (!name || !q || typeof q !== 'object' || typeof q.location !== 'string') return null;
    if (q.deal !== 'Rent' && q.deal !== 'Buy') return null; // the only two Deal values (data/taxonomy.ts)
    return { q: q as SearchQuery, name, locale: p.l === 'en' ? 'en' : 'ar' };
  } catch { return null; }
}

/** The link itself: always Home with the share param (a pasted link never runs a search by itself). */
export function shareLink(origin: string, payload: string): string {
  // /s/<payload> is the WhatsApp PREVIEW page (api/share-card.ts): it serves the card's tags and then
  // sends a person straight to Home with ?share=. It still never opens /agent and never runs a search.
  return `${origin.replace(/\/+$/, '')}/s/${payload}`;
}

/** Where the preview page sends a person: Home with the share param (the card + tap flow). */
export function shareLandingPath(payload: string): string {
  return `/?${SHARE_PARAM}=${payload}`;
}

// THE WHATSAPP PREVIEW CARD (owner 2026-10-17: «like this, simple, short» — a bold title with the
// sender's name, one short line, the site, the link). WhatsApp/iMessage/X build that card from these
// Open Graph tags, read from the page the link points to — so /s/<payload> answers with them. Every
// URL is built from the REQUEST'S OWN origin, so a domain change needs no code change.
export const SHARE_CARD = {
  ar: { title: 'عقارات من {name} لك على إزهله 🦅', desc: 'كل مواقع العقار في السعودية في مكان واحد. اضغط وشوف.', site: 'إزهله' },
  en: { title: 'Properties from {name}, just for you on Ezhalah 🦅', desc: 'Every Saudi real-estate site in one place. Tap to see.', site: 'Ezhalah' },
} as const;
export const SHARE_CARD_IMAGE_PATH = '/og-image-v5.png';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The preview page for /s/<payload>. A valid payload → the personal card + a redirect to Home with
 * ?share=; anything else → the plain Ezhalah card + a redirect to Home. Never throws.
 */
export function shareCardHtml(origin: string, rawPayload: string | null | undefined): string {
  const o = origin.replace(/\/+$/, '');
  const d = decodeSharePayload(rawPayload);
  const loc = d?.locale ?? 'ar';
  const c = SHARE_CARD[loc];
  const title = d ? fill(c.title, d.name) : (loc === 'ar' ? 'إزهله 🦅' : 'Ezhalah 🦅');
  const to = d && rawPayload ? shareLandingPath(rawPayload) : '/';
  const url = `${o}${d && rawPayload ? `/s/${rawPayload}` : '/'}`;
  const image = `${o}${SHARE_CARD_IMAGE_PATH}`;
  return `<!doctype html><html lang="${loc}" dir="${loc === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(title)}</title>`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(c.site)}">`
    + `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(c.desc)}">`
    + `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">`
    + `<meta property="og:image:width" content="512"><meta property="og:image:height" content="512">`
    + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}">`
    + `<meta name="twitter:description" content="${esc(c.desc)}"><meta name="twitter:image" content="${esc(image)}">`
    + `<meta http-equiv="refresh" content="0;url=${esc(to)}">`
    + `</head><body><script>location.replace(${JSON.stringify(to)})</script>`
    + `<a href="${esc(to)}">${esc(title)}</a></body></html>`;
}
