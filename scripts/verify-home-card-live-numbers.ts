// The main link's WhatsApp/iMessage card carries LIVE, TRUE numbers — or none (owner 2026-10-18).
//   «محرك بحث عقاري بالذكاء الاصطناعي: 149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.»
//
// EXECUTED, not grepped: the real builder (src/lib/homeCard.ts) runs against PostgREST-shaped bodies,
// including the failure shapes supabase-js/PostgREST really produce (error objects, null, empty arrays,
// zero counts). A failed read must print the number-free fallback, never «0 موقع» or a partial line.
// The middleware is then executed with a stubbed fetch: people pass through untouched, bots get the card,
// a failing database still gets a card (the fallback), never a thrown error.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  homeCardDescription, homeCardFactsFrom, homeCardHtml, isPreviewBot,
  HOME_CARD_FALLBACK_AR, HOME_CARD_IMAGE_PATH, HOME_CARD_TITLE_AR,
} from '../src/lib/homeCard.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const SITES = Array.from({ length: 149 }, (_, i) => `site${i}`);
const SCALE = [{ city_count: 346, listing_count: 385330, district_count: 5547 }];
const good = homeCardDescription(homeCardFactsFrom(SITES, SCALE));
check('the owner-approved line, exact digits', good === 'محرك بحث عقاري بالذكاء الاصطناعي: 149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.', good);
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
check('card page: small 192px image', html.includes(`og:image" content="https://ezhalah-app.vercel.app${HOME_CARD_IMAGE_PATH}"`) && html.includes('og:image:width" content="192"'));
check('card page escapes markup', !homeCardHtml('https://x', '"><script>').includes('"><script>'));

// Pinned to src/lib/share.ts (homeCard.ts cannot import it — it runs at the edge without react-native).
const share = readFileSync(new URL('../src/lib/share.ts', import.meta.url), 'utf8');
check('image path matches OG_IMAGE in share.ts', share.includes(`export const OG_IMAGE = \`\${SHARE_LINK}${HOME_CARD_IMAGE_PATH}\`;`));
check('title matches SHARE_TITLE_AR', share.includes(`export const SHARE_TITLE_AR = '${HOME_CARD_TITLE_AR}';`));
check('static fallback in share.ts equals the card fallback', share.includes(`export const SHARE_CARD_DESC_AR = '${HOME_CARD_FALLBACK_AR}';`));

// Bots vs people.
for (const ua of ['WhatsApp/2.24.1 A', 'facebookexternalhit/1.1 Facebot Twitterbot/1.0', 'TelegramBot (like TwitterBot)']) check(`preview bot recognised: ${ua.slice(0, 24)}`, isPreviewBot(ua));
for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', '']) check(`not a preview bot: ${ua.slice(0, 24) || '(empty)'}`, !isPreviewBot(ua));

// Execute the middleware itself with a stubbed fetch.
process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-key';
const realFetch = globalThis.fetch;
let dbCalls = 0;
// middleware.ts imports './src/lib/homeCard' WITHOUT '.ts' — Vercel's edge bundler refuses the extension
// (every production deploy failed on it, 2026-10-19). Node needs it, so run a copy with the path made absolute.
const MW_IMPORT = "from './src/lib/homeCard';";
const mwSrc = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
check("middleware imports homeCard with no '.ts' extension (the edge bundler rejects it)", mwSrc.includes(MW_IMPORT) && !/from '[^']+\.ts'/.test(mwSrc));
const mwFile = join(mkdtempSync(join(tmpdir(), 'mw-')), 'middleware.ts');
writeFileSync(mwFile, mwSrc.replace(MW_IMPORT, `from '${new URL('../src/lib/homeCard.ts', import.meta.url).href}';`));
const mwUrl = new URL(`file://${mwFile}`).href;
const mw = (await import(mwUrl)).default as (r: Request) => Promise<Response | undefined>;
const req = (ua: string) => new Request('https://ezhalah-app.vercel.app/', { headers: { 'user-agent': ua } });

globalThis.fetch = (async (url: string) => { dbCalls++; return new Response(JSON.stringify(String(url).includes('platforms') ? SITES : SCALE), { status: 200 }); }) as typeof fetch;
check('a person is passed straight through (no response, no database read)', (await mw(req('Mozilla/5.0 (iPhone) Safari'))) === undefined && dbCalls === 0);
const botRes = await mw(req('WhatsApp/2.24'));
const botHtml = botRes ? await botRes.text() : '';
check('WhatsApp gets the card with live numbers', !!botRes && botHtml.includes(good), botHtml.slice(0, 200));

// A failing database: the card still answers, with the fallback (fresh module so nothing is kept).
const mw2 = (await import(`${mwUrl}?fail`)).default as (r: Request) => Promise<Response | undefined>;
globalThis.fetch = (async () => new Response('{"message":"boom"}', { status: 503 })) as typeof fetch;
const failRes = await mw2(req('WhatsApp/2.24'));
const failHtml = failRes ? await failRes.text() : '';
check('database down → still a card, with the number-free line', !!failRes && failHtml.includes(HOME_CARD_FALLBACK_AR) && !/\d+ موقع/.test(failHtml));
globalThis.fetch = realFetch;

console.log(failed === 0 ? '\n✓ the main link card shows live, true numbers or none' : `\n✗ ${failed} home-card check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
