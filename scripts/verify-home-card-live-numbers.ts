// The main link's WhatsApp/iMessage card carries LIVE, TRUE numbers — or none (owner 2026-10-18).
//   «محرك بحث عقاري بالذكاء الاصطناعي: 149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.»
//
// EXECUTED, not grepped: the real builder (inlined in middleware.ts since 2026-10-19) runs against PostgREST-shaped bodies,
// including the failure shapes supabase-js/PostgREST really produce (error objects, null, empty arrays,
// zero counts). A failed read must print the number-free fallback, never «0 موقع» or a partial line.
// The middleware is then executed with a stubbed fetch: people pass through untouched, bots get the card,
// a failing database still gets a card (the fallback), never a thrown error.
import { readFileSync } from 'node:fs';
import {
  homeCardDescription, homeCardFactsFrom, homeCardHtml, isPreviewBot,
  HOME_CARD_FALLBACK_AR, HOME_CARD_IMAGE_PATH, HOME_CARD_TITLE_AR, HOME_CARD_HEADLINE_AR,
} from '../middleware.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const SITES = Array.from({ length: 149 }, (_, i) => `site${i}`);
const SCALE = [{ city_count: 346, listing_count: 385330, district_count: 5547 }];
const good = homeCardDescription(homeCardFactsFrom(SITES, SCALE));
check('the owner-approved numbers line, exact digits', good === '149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.', good);
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
