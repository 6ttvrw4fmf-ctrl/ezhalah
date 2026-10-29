// The main link's WhatsApp/iMessage card carries LIVE, TRUE numbers — or none (owner 2026-10-18).
//   «149 موقع · 385,330 إعلان · 346 مدينة» (2026-10-19; the sentence form was cut at the city count)
//
// EXECUTED, not grepped: the real builder (inlined in middleware.ts since 2026-10-19) runs against PostgREST-shaped bodies,
// including the failure shapes supabase-js/PostgREST really produce (error objects, null, empty arrays,
// zero counts). A failed read must print the number-free fallback, never «0 موقع» or a partial line.
// The middleware is then executed with a stubbed fetch: people pass through untouched, bots get the card,
// a failing database still gets a card (the fallback), never a thrown error.
import './lib/gateFetch.mjs'; // secret handshake for our own database calls (docs/ops/SCRAPE_GUARD.md)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import {
  homeCardDescription, homeCardFactsFrom, homeCardHtml, isPreviewBot, PREVIEW_BOT_UA,
  HOME_CARD_FALLBACK_AR, HOME_CARD_IMAGE_PATH, HOME_CARD_TITLE_AR, HOME_CARD_HEADLINE_AR,
} from '../middleware.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const SITES = Array.from({ length: 149 }, (_, i) => `site${i}`);
const SCALE = [{ city_count: 346, listing_count: 385330, district_count: 5547 }];
const good = homeCardDescription(homeCardFactsFrom(SITES, SCALE));

// SITES ARE COUNTED LIKE THE APP (owner 2026-10-19: the app says 148, the RPC lists 149 slugs because
// `aqarmonthly` is a source but not a platform). EXECUTED: the app's real normalizeSource() is lifted
// from loaderPlatforms.ts and run over a realistic slug list; the card's count must equal the number of
// distinct platforms the app would show. If SOURCE_TOKENS ever folds another pair, this goes red.
{
  const lp = await liftSymbols(join(root, 'src/data/loaderPlatforms.ts'), [
    { header: 'const SOURCE_TOKENS: Array<[string, string]> = [', endsWith: /^\];$/ },
    { header: 'export function normalizeSource(' },
  ], ['normalizeSource']);
  const normalizeSource = lp.normalizeSource as (raw: string) => string | null;
  const REAL_SLUGS = ['aqar', 'aqaralriyadh', 'aqaralsaudia', 'aqaratikom', 'aqarcity', 'aqargate', 'aqarmonthly', 'aqarnajran',
    'dealapp', 'eaqartabuk', 'goldendeal', 'ksaaqar', 'wasalt', 'gathern', 'haraj', 'abeea', 'sakan', 'remal'];
  const appCount = new Set(REAL_SLUGS.map((x) => normalizeSource(x) ?? x)).size;
  const cardCount = homeCardFactsFrom(REAL_SLUGS, SCALE).sites;
  check(`the card counts sites exactly as the app does over the real slugs (app ${appCount}, card ${cardCount})`, cardCount === appCount);
  check('aqarmonthly folds into aqar: 150 raw slugs with both → 149 sites', homeCardFactsFrom([...SITES, 'aqar', 'aqarmonthly'].slice(1), SCALE).sites === 149);
  mustCatch('a card that counts raw slugs (149 where the app shows 148)', REAL_SLUGS.length !== cardCount);
}
check('the owner-approved numbers line, exact digits (2026-10-25: no site count — the message says it — and «بالمملكة»)', good === '385\u066C330 إعلان · 346 مدينة بالمملكة', good);
check('no «,» inside a number: a narrow WhatsApp card broke «421,077» after the comma and showed «421,» (2026-10-29)', !good.includes(','));
mustCatch('the site count printed twice (message + card, owner 2026-10-25)', good !== '149 موقع · 385,330 إعلان · 346 مدينة');
mustCatch('the «و…في…، كلها في مكان واحد.» line WhatsApp cut at the city count', good !== '149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.');
check('the owner-approved title', HOME_CARD_HEADLINE_AR === 'إزهله، محرك بحث عقاري بالذكاء الاصطناعي');
// IT ALL SHOWS (owner 2026-10-18: «the message doesn't show fully»). WhatsApp's small card shows ~2 lines
// of title and ~2 lines of description before cutting. Measured against the BIGGEST numbers we could reach.
const TITLE_MAX = 45, DESC_MAX = 70;
const fits = (t: string, d: string) => t.length <= TITLE_MAX && d.length <= DESC_MAX;
const biggest = homeCardDescription({ sites: 999, listings: 9_999_999, cities: 9_999 });
check(`title fits (${HOME_CARD_HEADLINE_AR.length} ≤ ${TITLE_MAX} chars)`, HOME_CARD_HEADLINE_AR.length <= TITLE_MAX);
check(`numbers line fits even at 999 sites / 9,999,999 listings (${biggest.length} ≤ ${DESC_MAX})`, fits(HOME_CARD_HEADLINE_AR, biggest), biggest);
check('fallback line fits', fits(HOME_CARD_HEADLINE_AR, HOME_CARD_FALLBACK_AR));
mustCatch('the old one-line card (cut off in WhatsApp)', !fits(HOME_CARD_TITLE_AR, 'محرك بحث عقاري بالذكاء الاصطناعي: 149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.'));
check('string counts from PostgREST are read too', homeCardDescription(homeCardFactsFrom(SITES, [{ city_count: '346', listing_count: '385330' }])) === good);

// Every failure shape → the fallback, never a number that is not a real count.
const failures: Array<[string, unknown, unknown]> = [
  ['platforms read failed (error object)', { code: 'PGRST', message: 'x' }, SCALE],
  ['scale read failed (null)', SITES, null],
  ['scale empty', SITES, []],
  ['zero listings', SITES, [{ city_count: 346, listing_count: 0 }]],
  ['zero sites', [], SCALE],
  ['missing cities', SITES, [{ listing_count: 385330 }]],
];
for (const [label, p, s] of failures) check(`${label} → fallback line, no numbers`, homeCardDescription(homeCardFactsFrom(p, s)) === HOME_CARD_FALLBACK_AR);
check('no facts at all → fallback', homeCardDescription(null) === HOME_CARD_FALLBACK_AR);
check('the fallback has no digits', !/\d/.test(HOME_CARD_FALLBACK_AR));
mustCatch('a builder that prints a zero count', /\b0 موقع/.test(`محرك: ${0} موقع`) && homeCardDescription({ sites: 0, listings: 1, cities: 1 }) === HOME_CARD_FALLBACK_AR);

// The card page carries the line in og:description and the small 192px image.
const html = homeCardHtml('https://ezhalah-app.vercel.app', good);
check('card page: og:description is the live line', html.includes(`<meta property="og:description" content="${good}">`));
check('card page: og:title is the bold headline', html.includes(`<meta property="og:title" content="${HOME_CARD_HEADLINE_AR}">`));
check('card page: small 192px image', html.includes(`og:image" content="https://ezhalah-app.vercel.app${HOME_CARD_IMAGE_PATH}"`) && html.includes('og:image:width" content="192"'));
check('card page escapes markup', !homeCardHtml('https://x', '"><script>').includes('"><script>'));

// Pinned to src/lib/share.ts (homeCard.ts cannot import it — it runs at the edge without react-native).
const share = readFileSync(new URL('../src/lib/share.ts', import.meta.url), 'utf8');
check('image path matches OG_IMAGE in share.ts', share.includes(`export const OG_IMAGE = \`\${SHARE_LINK}${HOME_CARD_IMAGE_PATH}\`;`));
check('title matches SHARE_TITLE_AR', share.includes(`export const SHARE_TITLE_AR = '${HOME_CARD_TITLE_AR}';`));
check('static fallback in share.ts equals the card fallback', share.includes(`export const SHARE_CARD_DESC_AR = '${HOME_CARD_FALLBACK_AR}';`));

// THE MIDDLEWARE IMPORTS NOTHING LOCAL (2026-10-19: Vercel's edge bundler refused «./src/lib/homeCard.ts»
// and EVERY frontend deploy failed until it was inlined). A relative import or an @/ alias is RED here.
const mwSrc = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
const localImports = (src: string) => [...src.matchAll(/^\s*(?:import|export)\b[^;\n]*\bfrom\s+['"]((?:\.|@\/)[^'"]*)['"]/gm)].map((m) => m[1]);
check('middleware.ts has no local imports (Vercel edge bundler refuses them)', localImports(mwSrc).length === 0, localImports(mwSrc).join(', '));
mustCatch('the import that blocked every deploy', localImports("import { x } from './src/lib/homeCard.ts';").length === 1);

// Bots vs people.
for (const ua of ['WhatsApp/2.24.1 A', 'facebookexternalhit/1.1 Facebot Twitterbot/1.0', 'TelegramBot (like TwitterBot)']) check(`preview bot recognised: ${ua.slice(0, 24)}`, isPreviewBot(ua));
for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', '']) check(`not a preview bot: ${ua.slice(0, 24) || '(empty)'}`, !isPreviewBot(ua));
// IN-APP BROWSERS ARE PEOPLE (owner 2026-10-23: a shared link «didn't open» inside Snapchat). Each carries its
// app's name; none may be served the preview page instead of the site.
const IN_APP = {
  Snapchat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.12.0.36 (like Safari/8614.2.9.1.15, panda)',
  Instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.25.112 (iPhone15,3; iOS 18_0; ar_SA)',
  Facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.39.106;FBBV/650000000]',
  TikTok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 BytedanceWebview/d8a21c6',
  X: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.70',
  Viber: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Viber/24.1.0.2',
  LinkedIn: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.320',
};
for (const [app, ua] of Object.entries(IN_APP)) check(`a person in ${app}'s in-app browser gets the site, not the preview page`, !isPreviewBot(ua));
check('Snapchat\'s own preview fetcher still gets the card', isPreviewBot('Mozilla/5.0 (compatible; Snap URL Preview Service; bot; snapchat; https://developers.snap.com/robots)'));
mustCatch('an app name back in the bot list (the Snapchat «didn\'t open»)', new RegExp(`${PREVIEW_BOT_UA.source}|snapchat`, 'i').test(IN_APP.Snapchat));

// Execute the middleware itself with a stubbed fetch.
process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-key';
const realFetch = globalThis.fetch;
let dbCalls = 0;
const mw = (await import('../middleware.ts')).default as (r: Request) => Promise<Response | undefined>;
const req = (ua: string) => new Request('https://ezhalah-app.vercel.app/', { headers: { 'user-agent': ua } });

globalThis.fetch = (async (url: string) => { dbCalls++; return new Response(JSON.stringify(String(url).includes('platforms') ? SITES : SCALE), { status: 200 }); }) as typeof fetch;
check('a person is passed straight through (no response, no database read)', (await mw(req('Mozilla/5.0 (iPhone) Safari'))) === undefined && dbCalls === 0);
const botRes = await mw(req('WhatsApp/2.24'));
const botHtml = botRes ? await botRes.text() : '';
check('WhatsApp gets the card with live numbers', !!botRes && botHtml.includes(good), botHtml.slice(0, 200));

// A failing database: the card still answers, with the fallback (fresh module so nothing is kept).
const mw2 = (await import('../middleware.ts?fail')).default as (r: Request) => Promise<Response | undefined>;
globalThis.fetch = (async () => new Response('{"message":"boom"}', { status: 503 })) as typeof fetch;
const failRes = await mw2(req('WhatsApp/2.24'));
const failHtml = failRes ? await failRes.text() : '';
check('database down → still a card, with the number-free line', !!failRes && failHtml.includes(HOME_CARD_FALLBACK_AR) && !/\d+ موقع/.test(failHtml));
globalThis.fetch = realFetch;

console.log(failed === 0 ? '\n✓ the main link card shows live, true numbers or none' : `\n✗ ${failed} home-card check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
