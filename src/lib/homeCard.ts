// THE MAIN LINK'S PREVIEW CARD, WITH LIVE NUMBERS (owner 2026-10-18).
//
// When someone shares https://ezhalah-app.vercel.app on WhatsApp / iMessage / Telegram / X, the app
// reads the card below — not the sentence they send (owner: the card repeated the message word for
// word and was cut off). Owner-approved wording, exact digits, refreshed at share time:
//   «محرك بحث عقاري بالذكاء الاصطناعي: 149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.»
//
// THE NUMBERS MUST BE TRUE. They come from the same reads the app uses (loader_active_platforms_ar =
// websites with searchable listings, loader_scale_stats_ar = listings and cities). A missing, failed
// or non-positive number never prints: the card falls back to the same line WITHOUT numbers
// (A FAILED FETCH IS NOT AN EMPTY ANSWER — never «0 موقع», never a stale guess).
//
// Pure: no React, no network. middleware.ts does the reads; scripts/verify-home-card-live-numbers.ts
// executes everything here.
// NO imports: middleware.ts runs this at Vercel's edge, and ./share pulls in react-native. The two values
// below are pinned to src/lib/share.ts (OG_IMAGE's file, SHARE_TITLE_AR) by the verify script.
export const HOME_CARD_IMAGE_PATH = '/og-image-v6.png';
export const HOME_CARD_TITLE_AR = 'إزهله';

export type HomeCardFacts = { sites?: number | null; listings?: number | null; cities?: number | null };

/** The card line without numbers — used whenever any live number is missing. */
export const HOME_CARD_FALLBACK_AR = 'محرك بحث عقاري بالذكاء الاصطناعي، كل مواقع العقار في السعودية في مكان واحد.';

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const fmt = (n: number) => n.toLocaleString('en-US');

/** The owner-approved line with live numbers, or the fallback when any number is not a real count. */
export function homeCardDescription(f: HomeCardFacts | null | undefined): string {
  if (!f || !ok(f.sites) || !ok(f.listings) || !ok(f.cities)) return HOME_CARD_FALLBACK_AR;
  return `محرك بحث عقاري بالذكاء الاصطناعي: ${fmt(f.sites)} موقع و${fmt(f.listings)} إعلان في ${fmt(f.cities)} مدينة، كلها في مكان واحد.`;
}

/** Read the counts out of the two RPC bodies as PostgREST returns them; null when a body is unusable. */
export function homeCardFactsFrom(platformsBody: unknown, scaleBody: unknown): HomeCardFacts {
  const sites = Array.isArray(platformsBody) && platformsBody.every((x) => typeof x === 'string') ? platformsBody.length : null;
  const row = Array.isArray(scaleBody) ? scaleBody[0] : scaleBody;
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
  const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  return { sites, listings: num(r.listing_count), cities: num(r.city_count) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A tiny page for link-preview bots only: the card tags. People never get this page (middleware.ts). */
export function homeCardHtml(origin: string, description: string): string {
  const o = origin.replace(/\/+$/, '');
  const url = `${o}/`;
  const image = `${o}${HOME_CARD_IMAGE_PATH}`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">`
    + `<title>${esc(HOME_CARD_TITLE_AR)}</title>`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(HOME_CARD_TITLE_AR)}">`
    + `<meta property="og:title" content="${esc(HOME_CARD_TITLE_AR)}"><meta property="og:description" content="${esc(description)}">`
    + `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">`
    + `<meta property="og:image:width" content="192"><meta property="og:image:height" content="192">`
    + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(HOME_CARD_TITLE_AR)}">`
    + `<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">`
    + `</head><body><a href="${esc(url)}">${esc(HOME_CARD_TITLE_AR)}</a></body></html>`;
}

/** Link-preview fetchers (WhatsApp, iMessage = facebookexternalhit/Twitterbot, Telegram, Slack, …).
 *  Search engines are deliberately NOT here: they keep getting the real page. */
export const PREVIEW_BOT_UA = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|skypeuripreview|snapchat|pinterestbot|redditbot|viber/i;
export const isPreviewBot = (ua: string | null | undefined) => !!ua && PREVIEW_BOT_UA.test(ua);
