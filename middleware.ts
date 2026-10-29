// Vercel Routing Middleware — runs ONLY for the home page («/», see config.matcher).
//
// One job (owner 2026-10-18): when a LINK-PREVIEW BOT (WhatsApp, iMessage, Telegram, X…) fetches the
// main link, answer with the preview card carrying the LIVE numbers
//   title «إزهله، محرك بحث عقاري بالذكاء الاصطناعي» + «149 موقع · 385,330 إعلان · 346 مدينة»
// Everyone else — every person, every search engine — falls straight through to the normal static
// page: this function returns nothing for them and touches nothing.
//
// The numbers are read with a hard timeout and kept for 10 minutes in this edge instance, so a burst of
// shares costs the database at most two small reads per instance per 10 minutes. Any failure prints the
// line WITHOUT numbers (src/lib/homeCard.ts) — never a zero, never a guess.
// ── the card builder (was src/lib/homeCard.ts) ─────────────────────────────────────────────────────
// INLINED 2026-10-19: Vercel's edge bundler refused the middleware with «referencing unsupported modules:
// ./src/lib/homeCard.ts» (deploy runs 39185329947 / 39187192201 — every frontend deploy since #7593 failed),
// so the middleware imports nothing local. scripts/verify-home-card-live-numbers.ts imports these from here.
// THE MAIN LINK'S PREVIEW CARD, WITH LIVE NUMBERS (owner 2026-10-18).
//
// When someone shares https://ezhalah-app.vercel.app on WhatsApp / iMessage / Telegram / X, the app
// reads the card below — not the sentence they send (owner: the card repeated the message word for
// word and was cut off). Owner-approved wording, exact digits, refreshed at share time:
//   title «إزهله، محرك بحث عقاري بالذكاء الاصطناعي» + «149 موقع · 385,330 إعلان · 346 مدينة»
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
export const HOME_CARD_IMAGE_PATH = '/og-image-v9.png';
export const HOME_CARD_TITLE_AR = 'إزهله';
// The card's BOLD title (owner 2026-10-18: «the message doesn't show fully»). WhatsApp's small card shows
// ~2 lines under the title, so the approved sentence is split: what Ezhalah is goes in the title, the
// live numbers go underneath — same words, both short enough to show in full (length pinned by the verify script).
export const HOME_CARD_HEADLINE_AR = 'إزهله، محرك بحث عقاري بالذكاء الاصطناعي';

// THE ENGLISH CARD (owner 2026-10-29: «the language in the card itself … can I change it»): a card has one language
// per link, so an English share sends ezhalah.com/?lang=en (src/lib/share.ts SHARE_LINK_EN) and gets these words —
// the Arabic card translated. Same live numbers, same fallback rule.
export const HOME_CARD_TITLE_EN = 'Ezhalah';
export const HOME_CARD_HEADLINE_EN = 'Ezhalah, the AI real estate search engine';
export const HOME_CARD_FALLBACK_EN = 'Every real estate site in Saudi Arabia in one place.';
export type CardLang = 'ar' | 'en';
/** ?lang=en on the home link → the English card; anything else → Arabic. */
export const cardLangOf = (url: string): CardLang => { try { return new URL(url).searchParams.get('lang') === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } };

export type HomeCardFacts = { sites?: number | null; listings?: number | null; cities?: number | null };

/** The card line without numbers — used whenever any live number is missing. */
export const HOME_CARD_FALLBACK_AR = 'كل مواقع العقار في السعودية في مكان واحد.';

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
// «٬» (U+066C, the Arabic thousands mark) instead of «,»: a narrow WhatsApp card broke «421,077» after the comma and
// showed only «421,» (owner's two phones, 2026-10-29). Phones never break a line inside «421٬077».
const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, '\u066C');

/** The owner-approved line with live numbers, or the fallback when any number is not a real count. */
export function homeCardDescription(f: HomeCardFacts | null | undefined, lang: CardLang = 'ar'): string {
  if (!f || !ok(f.sites) || !ok(f.listings) || !ok(f.cities)) return lang === 'en' ? HOME_CARD_FALLBACK_EN : HOME_CARD_FALLBACK_AR;
  // English: «421,440 listings · 362 cities in Saudi Arabia». A word joiner after each comma keeps a narrow card from
  // breaking the number at the comma (the «421,» bug the Arabic line fixed with «٬»).
  if (lang === 'en') return `${f.listings.toLocaleString('en-US').replace(/,/g, ',⁠')} listings · ${f.cities.toLocaleString('en-US')} cities in Saudi Arabia`;
  // Owner 2026-10-19: no «و», no «في», no tail sentence — WhatsApp cut the line at «353 مدي…», so the
  // city count never showed. Three counts, middle dots, nothing after the last one.
  // Owner 2026-10-25: the share MESSAGE already says «ليش تدوّر في 148 موقع؟», so the card does not say 148 again,
  // and it names the Kingdom. The site count is still read (a complete set or the fallback), just not printed.
  return `${fmt(f.listings)} إعلان · ${fmt(f.cities)} مدينة بالمملكة`;
}

/** Read the counts out of the two RPC bodies as PostgREST returns them; null when a body is unusable. */
export function homeCardFactsFrom(platformsBody: unknown, scaleBody: unknown): HomeCardFacts {
  // COUNT SITES THE WAY THE APP DOES (owner 2026-10-19: «148»). loader_active_platforms_ar lists 149
  // source slugs, but the app shows one tile per PLATFORM and folds `aqarmonthly` (Aqar's DailyRenting
  // vertical) into Aqar — src/data/loaderPlatforms.ts SOURCE_TOKENS ['aqarmonthly', 'Aqar']. This file
  // imports nothing local (Vercel's edge bundler), so the one fold is restated here; the barrier
  // (scripts/verify-home-card-live-numbers.ts) executes the app's real normalizeSource() against the
  // same slugs and fails if the two counts ever disagree.
  const sites = Array.isArray(platformsBody) && platformsBody.every((x) => typeof x === 'string')
    ? new Set(platformsBody.map((x) => (x === 'aqarmonthly' ? 'aqar' : x))).size : null;
  const row = Array.isArray(scaleBody) ? scaleBody[0] : scaleBody;
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
  const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
  return { sites, listings: num(r.listing_count), cities: num(r.city_count) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A tiny page for link-preview bots only: the card tags. People never get this page (middleware.ts). */
export function homeCardHtml(origin: string, description: string, lang: CardLang = 'ar'): string {
  const o = origin.replace(/\/+$/, '');
  const en = lang === 'en';
  const url = en ? `${o}/?lang=en` : `${o}/`;
  const image = `${o}${HOME_CARD_IMAGE_PATH}`;
  const headline = en ? HOME_CARD_HEADLINE_EN : HOME_CARD_HEADLINE_AR;
  const name = en ? HOME_CARD_TITLE_EN : HOME_CARD_TITLE_AR;
  return `<!doctype html><html lang="${en ? 'en' : 'ar'}" dir="${en ? 'ltr' : 'rtl'}"><head><meta charset="utf-8">`
    + `<title>${esc(headline)}</title>`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(name)}">`
    + `<meta property="og:title" content="${esc(headline)}"><meta property="og:description" content="${esc(description)}">`
    + `<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">`
    + `<meta property="og:image:width" content="192"><meta property="og:image:height" content="192">`
    + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(headline)}">`
    + `<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">`
    + `</head><body><a href="${esc(url)}">${esc(name)}</a></body></html>`;
}

/** Link-preview fetchers (WhatsApp, iMessage = facebookexternalhit/Twitterbot, Telegram, Slack, …).
 *  Search engines are deliberately NOT here: they keep getting the real page.
 *  ONLY BOT TOKENS — never an app name (owner 2026-10-23: a shared link «didn't open» inside Snapchat). An
 *  in-app browser carries its app's name in its user agent («… Snapchat/13.12 …», «… Viber/…»), so the old
 *  bare `snapchat|viber` sent PEOPLE the preview page instead of the site. Snapchat's preview fetcher is
 *  «Snap URL Preview Service». verify-home-card-live-numbers.ts runs real in-app user agents against this. */
export const PREVIEW_BOT_UA = /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|skypeuripreview|snap url preview|pinterestbot|redditbot/i;
export const isPreviewBot = (ua: string | null | undefined) => !!ua && PREVIEW_BOT_UA.test(ua);
// ── end of the card builder ─────────────────────────────────────────────────────────────────────────

export const config = { matcher: '/' };

// Read at call time, not at load: the module now also carries the card builder, so a test (or any importer)
// loads it before setting the environment.
const supabaseUrl = () => process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const supabaseKey = () => process.env.EXPO_PUBLIC_SUPABASE_KEY || '';
const READ_MS = 4000;
const KEEP_MS = 10 * 60 * 1000;
let kept: { at: number; facts: HomeCardFacts } | null = null;

async function rpc(name: string): Promise<unknown> {
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    // Secret handshake (docs/ops/SCRAPE_GUARD.md): our own server's database reads carry it once the back door closes.
    headers: { apikey: supabaseKey(), 'Content-Type': 'application/json', ...(process.env.EZ_GATE_SECRET ? { 'x-ezhalah-gate': process.env.EZ_GATE_SECRET } : {}) },
    body: '{}',
    signal: AbortSignal.timeout(READ_MS),
  });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.json();
}

async function liveFacts(): Promise<HomeCardFacts | null> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.facts;
  if (!supabaseKey()) return null;
  try {
    const [platforms, scale] = await Promise.all([rpc('loader_active_platforms_ar'), rpc('loader_scale_stats_ar')]);
    const facts = homeCardFactsFrom(platforms, scale);
    // Only a complete, real set is kept; a partial one is used once (it renders the fallback) and retried next time.
    if (homeCardDescription(facts) !== homeCardDescription(null)) kept = { at: Date.now(), facts };
    return facts;
  } catch { return null; }
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!isPreviewBot(request.headers.get('user-agent'))) return undefined; // people + search engines: untouched
  try {
    const origin = new URL(request.url).origin;
    const lang = cardLangOf(request.url);
    const html = homeCardHtml(origin, homeCardDescription(await liveFacts(), lang), lang);
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    return undefined; // never break the page over a card: the static page has its own card tags
  }
}
