// THE MAIN LINK'S SHARE MESSAGE IS «ليش تدوّر في 148 موقع؟ إزهله يدوّر عنك» (owner, 2026-10-20).
//
// The owner looked at a WhatsApp share of the home link — the eagle card on top, then the long typed
// sentence («تدور على عقار وتبي تشوف المعروض من مختلف المواقع بمكان واحد؟ إزهله، الطريقة الأذكى …»)
// — and replaced that sentence with the one above. The card itself (title, eagle, «148 موقع · … إعلان
// · … مدينة») is untouched, and the page's SEO description (SHARE_BLURB_AR) keeps the old wording.
//
// The 148 is LIVE, never typed, and it is THE CARD'S number (owner 2026-10-20: «the message says 146
// but when I send it says 148 — confusing»): src/data/siteCount.ts reads loader_active_platforms_ar()
// and folds it to one per platform exactly like middleware.ts homeCardFactsFrom(). While that count is
// unknown the sentence says «كل المواقع»; it never shows a zero or a stale number.
//
// EXECUTED: liveSiteCount / shareLead / shareMessage are lifted out of src/lib/share.ts and run
// against a stubbed catalog + registry (share.ts imports react-native, so it cannot be imported).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { homeCardFactsFrom } from '../middleware.ts';

const root = join(import.meta.dirname, '..');
const SHARE = join(root, 'src/lib/share.ts');
const shareSrc = readFileSync(SHARE, 'utf8');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

const OWNER_AR = 'ليش تدوّر في 148 موقع؟ إزهله يدوّر عنك';
const LINK = 'https://ezhalah-app.vercel.app';
type Lib = {
  liveSiteCount: () => number | null;
  shareLead: (loc: 'ar' | 'en', count: number | null) => string;
  shareMessage: (loc: 'ar' | 'en', count: number | null) => string;
};
const g = globalThis as any;
g.__siteCount = 148;
const load = (src: string) => liftSymbols(
  src === shareSrc ? SHARE : writeTemp(src),
  [
    { header: 'export const SHARE_LINK = ', endsWith: /;$/ },
    { header: 'export const SHARE_LEAD_AR_TEMPLATE = ', endsWith: /;$/ },
    { header: 'export const SHARE_LEAD_AR_NO_COUNT = ', endsWith: /;$/ },
    { header: 'export const SHARE_LEAD_EN_TEMPLATE = ', endsWith: /;$/ },
    { header: 'export const SHARE_LEAD_EN_NO_COUNT = ', endsWith: /;$/ },
    { header: 'export function liveSiteCount(', endsWith: /^\}$/ },
    { header: 'export function shareLead(', endsWith: /^\}$/ },
    { header: 'export function shareMessage(', endsWith: /^\}$/ },
  ],
  ['liveSiteCount', 'shareLead', 'shareMessage'],
  'const siteCountNow = () => (globalThis as any).__siteCount; const loadSiteCount = () => Promise.resolve(null); const Platform = { OS: "web" };',
) as Promise<Lib>;
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const writeTemp = (src: string) => { const f = join(mkdtempSync(join(tmpdir(), 'share-lead-')), 'share.ts'); writeFileSync(f, src); return f; };

console.log('\nThe main link\'s share message says «ليش تدوّر في 148 موقع؟ إزهله يدوّر عنك», with a live 148\n');
const real = await load(shareSrc);

check('liveSiteCount() is the shared site count (148, the card\'s number)', real.liveSiteCount() === 148, String(real.liveSiteCount()));
check('the Arabic sentence is the owner\'s exact words with that live number', real.shareLead('ar', real.liveSiteCount()) === OWNER_AR, real.shareLead('ar', real.liveSiteCount()));
check('the message = that sentence, a newline, the link — nothing else', real.shareMessage('ar', 148) === `${OWNER_AR}\n${LINK}`);
const OWNER_EN = 'Why search 148 sites one by one? Ezhalah, the AI real estate search engine, searches them all for you, in one place.';
check('the English sentence is the owner\'s exact words (2026-10-22) with the same live number', real.shareLead('en', 148) === OWNER_EN, real.shareLead('en', 148));
check('the English unknown-count form keeps the owner\'s shape with no number', real.shareLead('en', null) === 'Why search every site one by one? Ezhalah, the AI real estate search engine, searches them all for you, in one place.');
g.__siteCount = null;
check('count not read yet → unknown (null), never 0', real.liveSiteCount() === null, String(real.liveSiteCount()));
check('unknown count → «كل المواقع», never a zero or a typed number', real.shareLead('ar', null) === 'ليش تدوّر في كل المواقع؟ إزهله يدوّر عنك' && !/\d/.test(real.shareLead('ar', null)) && !/\d/.test(real.shareLead('en', null)));
check('a zero or a bad count is treated as unknown', real.shareLead('ar', 0) === real.shareLead('ar', null) && real.shareLead('ar', 2.5) === real.shareLead('ar', null));
g.__siteCount = 148;
check('the old long sentence is gone from the sent message (it stays only as the page\'s SEO description)',
  !real.shareMessage('ar', 148).includes('الطريقة الأذكى') && /SHARE_BLURB_AR = 'تدور على عقار/.test(shareSrc));

// ── ONE NUMBER: the sentence's count and the card's count are the same fold over the same RPC ───
// siteCount.ts imports the supabase client (an alias Node cannot resolve), so its pure fold is lifted.
const lp = await liftSymbols(join(root, 'src/data/loaderPlatforms.ts'), [
  { header: 'const SOURCE_TOKENS: Array<[string, string]> = [', endsWith: /^\];$/ },
  { header: 'export function normalizeSource(' },
], ['normalizeSource']);
(globalThis as any).__normalizeSource = lp.normalizeSource;
const { sitesFromSlugs } = await liftSymbols(
  join(root, 'src/data/siteCount.ts'),
  [{ header: 'export function sitesFromSlugs(', endsWith: /^\}$/ }],
  ['sitesFromSlugs'],
  'const normalizeSource: (s: string) => string | null = (globalThis as any).__normalizeSource;',
) as { sitesFromSlugs: (slugs: unknown) => number | null };
{
  // The real shape of loader_active_platforms_ar() on 2026-10-20: 149 slugs, aqarmonthly among them.
  const slugs = [...Array.from({ length: 147 }, (_, i) => `site${i}`), 'aqar', 'aqarmonthly'];
  const card = homeCardFactsFrom(slugs, [{ listing_count: 1, city_count: 1 }]).sites;
  check('sitesFromSlugs (the sentence) === homeCardFactsFrom (the card) over the same slugs — 148, aqarmonthly folded into Aqar',
    sitesFromSlugs(slugs) === 148 && card === 148, `sentence=${sitesFromSlugs(slugs)} card=${card}`);
  check('an empty or failed slug list is unknown, never 0', sitesFromSlugs([]) === null && sitesFromSlugs(null) === null && sitesFromSlugs([1, 2]) === null);
}
// ── REMEMBERED ON THE DEVICE (owner 2026-10-23: Arabic share said «كل المواقع» — the count lands ~4 s after load) ──
{
  const { rememberedCount } = await liftSymbols(join(root, 'src/data/siteCount.ts'),
    [{ header: 'export function rememberedCount(', endsWith: /^\}$/ }], ['rememberedCount'],
    'const COUNT_KEEP_MS = 6 * 60 * 60 * 1000;') as { rememberedCount: (raw: string | null, now: number) => number | null };
  const now = Date.UTC(2026, 9, 23, 12);
  const keep = (n: unknown, ageMs: number) => rememberedCount(JSON.stringify({ n, at: now - ageMs }), now);
  check('a count this device read within 6 h is used at once', keep(148, 60_000) === 148 && keep(148, 6 * 3600_000 - 1) === 148);
  check('older than 6 h, from the future, zero, junk or missing → unknown (never a stale or made-up number)',
    keep(148, 6 * 3600_000 + 1) === null && keep(148, -5000) === null && keep(0, 1) === null && keep('148', 1) === null
    && rememberedCount('not json', now) === null && rememberedCount(null, now) === null);
  const src = readFileSync(join(root, 'src/data/siteCount.ts'), 'utf8');
  check('the device keeps the count it READ (written only on a successful read) and seeds from it at start',
    /if \(n !== null\) \{[\s\S]{0,80}setItem\(SITE_COUNT_KEY/.test(src) && /known = rememberedCount\(globalThis\.localStorage\?\.getItem\(SITE_COUNT_KEY\)/.test(src));
  check('(mutation) catches a remembered count kept forever', (() => { const forever = (raw: string) => JSON.parse(raw).n; return forever(JSON.stringify({ n: 148, at: now - 30 * 86400_000 })) === 148 && keep(148, 30 * 86400_000) === null; })());
}
const welcome = readFileSync(join(root, 'src/data/welcomeFacts.ts'), 'utf8');
check('the Filter home\'s welcome line takes the same count (it used to count raw slugs: 149)', /const siteCount = loadSiteCount;/.test(welcome) && !/data\.length : null/.test(welcome));
check('share.ts starts the read at app load so a tap never has to await', /void loadSiteCount\(\);/.test(shareSrc));

// ── wiring: both share surfaces send the built sentence ─────────────────────────────────────────
const sheet = readFileSync(join(root, 'src/components/ShareSheet.tsx'), 'utf8');
check('the in-app sheet\'s preview shows the sentence that is sent ({lead}), not the old SEO description',
  /<Text style=\{s\.pvS\} numberOfLines=\{2\}>\{lead\}<\/Text>/.test(sheet) && !/SHARE_BLURB/.test(sheet));
check('the in-app sheet builds lead/msg from shareLead/shareMessage(locale, liveSiteCount())',
  /const count = liveSiteCount\(\);\s*const lead = shareLead\(locale, count\);\s*const msg = shareMessage\(locale, count\);/.test(sheet));
check('shareNative sends the built sentence to the phone\'s share menu and the native sheet',
  /text: lead, url: SHARE_LINK/.test(shareSrc) && /message, url: SHARE_LINK/.test(shareSrc) && /const count = liveSiteCount\(\);/.test(shareSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the real code, deliberately re-broken\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mutant = (from: string, to: string) => {
  if (!shareSrc.includes(from)) throw new Error(`mutant anchor missing: ${from}`);
  return load(shareSrc.replace(from, to));
};
{
  const m = await mutant("'ليش تدوّر في {count} موقع؟ إزهله يدوّر عنك'", "'ليش تدوّر في {count} موقع؟ إزهله يدوّر لك'");
  mustCatch('the owner\'s wording drifting by one word', m.shareLead('ar', 148) !== OWNER_AR);
}
{
  const m = await mutant("'Why search {count} sites one by one? Ezhalah, the AI real estate search engine, searches them all for you, in one place.'", "'Ezhalah, the AI meta search engine. {count} sites, one search.'");
  mustCatch('the English wording drifting back to the old sentence', m.shareLead('en', 148) !== OWNER_EN);
}
{
  const m = await mutant('{count}', '148');
  mustCatch('the number typed into the sentence instead of the live count', m.shareLead('ar', 150) === OWNER_AR);
}
{
  const m = await mutant('  return siteCountNow();', '  return siteCountNow() ?? 152;');
  g.__siteCount = null;
  mustCatch('an unread count rendered as the catalog size instead of «كل المواقع»', m.liveSiteCount() !== null);
  g.__siteCount = 148;
}
{
  const m = await mutant('  return siteCountNow();', '  return 148;');
  g.__siteCount = 131;
  mustCatch('the number typed into liveSiteCount() instead of read', m.liveSiteCount() !== 131);
  g.__siteCount = 148;
}
{
  const m = await mutant("const live = typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null;", 'const live = count;');
  mustCatch('a bad count rendered into the sentence («ليش تدوّر في -3 موقع» / «2.5 موقع»)', m.shareLead('ar', -3) !== m.shareLead('ar', null) || m.shareLead('ar', 2.5) !== m.shareLead('ar', null));
}
{
  const m = await mutant('return `${shareLead(loc, count)}\\n${SHARE_LINK}`;', 'return `${shareLead(loc, count)} ${SHARE_LINK} ${SHARE_LINK}`;');
  mustCatch('the link sent twice / on the same line', m.shareMessage('ar', 148) !== `${OWNER_AR}\n${LINK}`);
}

if (fail || mutFail) { console.error(`\n❌ main-link-share-says-why-search-sites: ${fail} check(s), ${mutFail} mutation(s) failed`); process.exit(1); }
console.log('\n✅ main-link-share-says-why-search-sites: the owner\'s sentence, a live 148, one link.');
