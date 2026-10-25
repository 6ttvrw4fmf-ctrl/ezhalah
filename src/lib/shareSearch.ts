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
  // The title itself is built by shareTitle() (type + place + name + brand); this holds the fixed button.
  ar: { button: 'اضغط وشوف العقارات' },
  en: { button: 'Tap to see the properties' },
} as const;

const firstName = (name: string): string => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** The text sent next to the link, or null when there is no name to say it with. */
/** The personal title on its own (owner 2026-10-18: no emoji, never repeated — the share sends only the LINK; its card already shows this title). */
export function shareMessage(name: string, q: SearchQuery | null | undefined, locale: 'ar' | 'en'): string | null {
  const t = shareTitle(name, q, locale);
  return t;
}
/** The title on the landing card — the same personal title. */
export function shareLandingTitle(name: string, q: SearchQuery | null | undefined, locale: 'ar' | 'en'): string | null {
  return shareTitle(name, q, locale);
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

// AN INVITATION TO JOIN (owner 2026-10-23): the Share under a reply with no search (a «هلا», a question)
// sends a personal welcome, not a chat — «يوسف يرحّب بك للانضمام إلى إزهله» / "Yusuf welcomes you to join
// Ezhalah" — with the top Share's marketing line as the message text. `k: 'join'` marks it; no search inside.
export function encodeInvitePayload(senderName: string, locale: 'ar' | 'en' = 'ar'): string | null {
  const n = firstName(senderName);
  return n ? toB64Url(JSON.stringify({ v: SHARE_PAYLOAD_VERSION, n, l: locale, k: 'join' })) : null;
}
export function decodeInvitePayload(raw: string | null | undefined): { name: string; locale: 'ar' | 'en' } | null {
  if (!raw || raw.length > 2000) return null;
  const json = fromB64Url(raw);
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || p.v !== SHARE_PAYLOAD_VERSION || p.k !== 'join') return null;
    const name = firstName(String(p.n ?? ''));
    return name ? { name, locale: p.l === 'en' ? 'en' : 'ar' } : null;
  } catch { return null; }
}
/** The welcome on the invitation's card and on the sign-in popup (owner-approved wording 2026-10-23). */
export function shareJoinNote(name: string, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  if (!n) return null;
  return locale === 'ar' ? `${n} يرحّب بك للانضمام إلى إزهله` : `${n} welcomes you to join Ezhalah`;
}

// A SHARED CHAT (owner 2026-10-17: «sharing it means I share the chat history»). A signed-in user's
// Share saves a COPY of the whole conversation in the database (public.shared_chat, migration
// 20261018031834) under an 8-character code, and the link is /s/<code>. The recipient signs in and the
// chat is copied into their own history — never live-synced. Older links carry the search itself
// (the base64url payload above) and keep working.
export const SHARE_CODE_RE = /^[A-Za-z0-9]{8}$/;
export const isShareCode = (raw: string | null | undefined): boolean => !!raw && SHARE_CODE_RE.test(raw);
// q = null: a chat with no search in it (owner 2026-10-18, option A: «محادثة من يوسف على إزهله»).
export type SharedChatCard = { q: SearchQuery | null; name: string; locale: 'ar' | 'en' };
/** Validates a row the database returns (shared_chat_card / get_shared_chat); anything off is null. */
export function sharedChatCardFrom(row: unknown): SharedChatCard | null {
  const r = row as { sender_name?: unknown; locale?: unknown; query?: unknown } | null;
  const name = firstName(String(r?.sender_name ?? ''));
  const raw = r?.query as SearchQuery | undefined;
  if (!name || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // An empty query object is a chat with no search; anything else must be a real search.
  const q = Object.keys(raw).length === 0 ? null : raw;
  if (q && (typeof q.location !== 'string' || (q.deal !== 'Rent' && q.deal !== 'Buy'))) return null;
  return { q, name, locale: r?.locale === 'en' ? 'en' : 'ar' };
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

// THE PERSONAL TITLE (owner 2026-10-17: «real estate in this [place] from Yusuf on Ezhalah», then the
// 9.5 refinement — the TYPE and rent/sale when known). One title is used everywhere: the message, the
// WhatsApp card and the landing card. Examples:
//   «شقق للإيجار في حي النرجس من يوسف على إزهله»
//   «شقق للإيجار في النرجس والياسمين من يوسف على إزهله»
//   «شقق للإيجار في النرجس و3 أحياء ثانية من يوسف على إزهله»   (4+ districts stay short)
//   «فلل للبيع في جدة من يوسف على إزهله»   ·   «عقارات من يوسف على إزهله»   (nothing specific)
// A place written in the other script is left out rather than mixed into the sentence.
const TYPE_PLURAL: Record<string, { ar: string; en: string }> = {
  Apartment: { ar: 'شقق', en: 'Apartments' }, Villa: { ar: 'فلل', en: 'Villas' }, Floor: { ar: 'أدوار', en: 'Floors' },
  Duplex: { ar: 'دوبلكسات', en: 'Duplexes' }, Studio: { ar: 'استوديوهات', en: 'Studios' }, Room: { ar: 'غرف', en: 'Rooms' },
  Chalet: { ar: 'شاليهات', en: 'Chalets' }, 'Rest House': { ar: 'استراحات', en: 'Rest houses' }, Palace: { ar: 'قصور', en: 'Palaces' },
  'Residential Land': { ar: 'أراضي سكنية', en: 'Residential land' }, 'Residential Plots': { ar: 'أراضي سكنية', en: 'Residential plots' },
  'Raw Land': { ar: 'أراضي خام', en: 'Raw land' }, 'Agriculture Plot': { ar: 'أراضي زراعية', en: 'Farm land' },
  'Commercial Land': { ar: 'أراضي تجارية', en: 'Commercial land' }, 'Industrial Land': { ar: 'أراضي صناعية', en: 'Industrial land' },
  'Commercial Building': { ar: 'عمائر تجارية', en: 'Commercial buildings' },
};
const AR_SCRIPT = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
const stripDistrict = (s: string) => s.trim().replace(/^حي\s+/, '').replace(/\s+district$/i, '');

export function shareTitle(name: string, q: SearchQuery | null | undefined, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  if (!n) return null;
  if (q === null) return locale === 'ar' ? `محادثة من ${n} على إزهله` : `A chat from ${n} on Ezhalah`;
  const phrase = sharePhrase(q, locale);
  return locale === 'ar' ? `${phrase} من ${n} على إزهله` : `${phrase} from ${n} on Ezhalah`;
}

// THE NOTE ON THE SIGN-IN POPUP (owner 2026-10-18): a visitor who opens a shared link sees the normal
// sign-in / sign-up popup with this line on top — «يوسف شاركك: شقق للإيجار في حي النرجس» — and the
// chat opens, saved to their list, once they are in.
export function shareInviteNote(name: string, q: SearchQuery | null | undefined, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  if (!n) return null;
  if (q === null) return locale === 'ar' ? `${n} شاركك محادثة` : `${n} shared a chat with you`;
  const phrase = sharePhrase(q, locale);
  return locale === 'ar' ? `${n} شاركك: ${phrase}` : `${n} shared with you: ${phrase}`;
}

/** «شقق للإيجار في حي النرجس» — what the share holds, without the sender or the brand. */
export function sharePhrase(q: SearchQuery | null | undefined, locale: 'ar' | 'en'): string {
  const ar = locale === 'ar';
  const fits = (s: string) => !!s && (ar ? !LATIN.test(s) : !AR_SCRIPT.test(s));
  // WHAT: one picked type in plural, else «عقارات»; plus rent/sale when known.
  const types = (q as (SearchQuery & { types?: string[] | null }) | null | undefined)?.types ?? null;
  const oneType = q?.type ?? (types && types.length === 1 ? types[0] : null);
  const plural = oneType ? TYPE_PLURAL[oneType]?.[locale] : undefined;
  const deal = q?.deal === 'Rent' ? (ar ? 'للإيجار' : 'for rent') : q?.deal === 'Buy' ? (ar ? 'للبيع' : 'for sale') : '';
  const what = plural ? [plural, deal].filter(Boolean).join(' ') : (ar ? 'عقارات' : 'Properties');
  // WHERE: the picked district(s), else the city / region the search names.
  const label = q?.districtLabel?.trim();
  const ds = label ? [label] : (q?.districts ?? []).map((d) => String(d).trim()).filter(Boolean);
  let where = '';
  if (ds.length && ds.every(fits)) {
    const names = ds.map(stripDistrict);
    if (names.length === 1) where = ar ? `حي ${names[0]}` : names[0];
    else if (names.length <= 3) where = ar ? names.join(' و') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    else where = ar ? `${names[0]} و${names.length - 1} أحياء ثانية` : `${names[0]} + ${names.length - 1} more districts`;
  } else {
    const city = (q?.location ?? '').split(/[,،]/)[0].trim();
    if (fits(city)) where = city;
  }
  const place = where ? (ar ? ` في ${where}` : ` in ${where}`) : '';
  return `${what}${place}`;
}

// THE WHATSAPP PREVIEW CARD (owner 2026-10-17: «like this, simple, short» — a bold title with the
// sender's name, one short line, the site, the link). WhatsApp/iMessage/X build that card from these
// Open Graph tags, read from the page the link points to — so /s/<payload> answers with them. Every
// URL is built from the REQUEST'S OWN origin, so a domain change needs no code change.
export const SHARE_CARD = {
  // ONE SHORT LINE (owner 2026-10-18, WhatsApp screenshot): «· اضغط وشوف» wrapped to a 2nd line and pushed the
  // site name out of the thumbnail card. The link itself is the call to action.
  ar: { desc: 'كل مواقع العقار في مكان واحد', site: 'إزهله' },
  en: { desc: 'Every real-estate site in one place', site: 'Ezhalah' },
} as const;
// SMALL, under 300 px (owner 2026-10-18, twice: «look how big … keep it small», «the image is very big
// still»). Measured on the owner's own WhatsApp: the 512 px logo renders as a BIG banner over the card
// (11:42 PM screenshot, /s/lLzdSNTR); the 192 px one rendered as the small square beside the text (2:57 PM,
// /s/bkTsnLiQ). Same 192 px file as the main link's card (middleware.ts, og-image-v7.png).
export const SHARE_CARD_IMAGE_PATH = '/og-image-v7.png';
// A SHARED LINK's card (owner 2026-10-22, approved mockup): the title is the SAME invite the visitor then sees
// on the sign-in popup — «يوسف شاركك: شقق للإيجار في حي النرجس» (shareInviteNote) — and the line under it says
// what Ezhalah is. The live counts stay on the plain home-link card (middleware.ts) and a broken link's card.
export const SHARE_INVITE_LINE = {
  ar: 'افتحها على إزهله، محرك البحث العقاري بالذكاء الاصطناعي في السعودية',
  en: 'Open it on Ezhalah, the AI real estate search engine in Saudi Arabia',
} as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The preview page for /s/<payload>. A valid payload → the personal card + a redirect to Home with
 * ?share=; anything else → the plain Ezhalah card + a redirect to Home. Never throws.
 */
/** The live counts the home link's card shows (middleware.ts homeCardFactsFrom); null = unknown. */
export type ShareCardFacts = { sites?: number | null; listings?: number | null; cities?: number | null };
const factOk = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
/**
 * The card's bottom line (owner 2026-10-20): the SAME marketing line as the home link — three live
 * counts, nothing about the search itself — in the card's language. Any missing count → the plain
 * tagline, never a zero.
 */
export function shareCardFactsLine(f: ShareCardFacts | null | undefined, loc: 'ar' | 'en'): string {
  if (!f || !factOk(f.sites) || !factOk(f.listings) || !factOk(f.cities)) return SHARE_CARD[loc].desc;
  const n = (v: number) => v.toLocaleString('en-US');
  return loc === 'ar'
    ? `${n(f.sites)} موقع · ${n(f.listings)} إعلان · ${n(f.cities)} مدينة`
    : `${n(f.sites)} sites · ${n(f.listings)} listings · ${n(f.cities)} cities`;
}

export function shareCardHtml(origin: string, rawPayload: string | null | undefined, chatCard?: SharedChatCard | null, facts?: ShareCardFacts | null): string {
  const o = origin.replace(/\/+$/, '');
  // A short code is a SAVED CHAT (shared_chat); its card facts come from the database (chatCard). A code
  // whose card could not be read still goes to Home + ?share=<code> — the app fetches it there.
  const code = isShareCode(rawPayload);
  const d = code ? (chatCard ?? null) : decodeSharePayload(rawPayload);
  const join = !code && !d ? decodeInvitePayload(rawPayload) : null; // an invitation to join (owner 2026-10-23)
  const loc = d?.locale ?? join?.locale ?? 'ar';
  const invite = d ? shareInviteNote(d.name, d.q, loc) : join ? shareJoinNote(join.name, loc) : null;
  // The invite LINE now travels as the message text (owner 2026-10-22: WhatsApp cut it in the card), so the
  // card's line is the short tagline that fits — never the same sentence twice.
  const c = { site: SHARE_CARD[loc].site, desc: invite ? SHARE_CARD[loc].desc : shareCardFactsLine(facts, loc) };
  const title = invite || (loc === 'ar' ? 'إزهله' : 'Ezhalah');
  const ok = !!rawPayload && (code || !!d || !!join);
  const to = ok ? shareLandingPath(rawPayload!) : '/';
  const url = `${o}${ok ? `/s/${rawPayload}` : '/'}`;
  const image = `${o}${SHARE_CARD_IMAGE_PATH}`;
  return `<!doctype html><html lang="${loc}" dir="${loc === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(title)}</title>`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(c.site)}">`
    + `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(c.desc)}">`
    + `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">`
    + `<meta property="og:image:width" content="192"><meta property="og:image:height" content="192">`
    + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}">`
    + `<meta name="twitter:description" content="${esc(c.desc)}"><meta name="twitter:image" content="${esc(image)}">`
    + `<meta http-equiv="refresh" content="0;url=${esc(to)}">`
    + `</head><body><script>location.replace(${JSON.stringify(to)})</script>`
    + `<a href="${esc(to)}">${esc(title)}</a></body></html>`;
}
