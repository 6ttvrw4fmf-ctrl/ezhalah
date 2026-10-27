#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-share-metadata — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * WHY (owner, 2026-09-05: "make sure the actual shared link preview is tested, not just our internal
 * share modal. Add a regression check so the share title/image/description cannot silently disappear
 * later.")
 *
 * The app's own ShareSheet has always drawn a handsome preview card — eagle, name, tagline. That card
 * is painted BY US and never leaves the device. WhatsApp, iMessage, X, Telegram and LinkedIn build
 * their own card by fetching the page and reading its <head>. That head carried NO og: tags at all
 * and an EMPTY <title>, so a shared Ezhalah link arrived as a bare grey URL. The sender saw a polished
 * preview; the recipient got nothing. Nothing in the repo noticed, because nothing had ever looked at
 * the head — every test read our components instead.
 *
 * WHAT THIS PINS
 *   1. title / og:title / og:description / og:image / twitter:card are all DECLARED and non-empty;
 *   2. og:image is ABSOLUTE — a crawler has no origin to resolve "/og-image.jpg" against, so a
 *      relative path silently yields a preview with no picture;
 *   3. the image file EXISTS, is 512x512, and is small enough that a crawler will actually fetch it;
 *   4. the description is the OWNER'S wording, and it NAMES THE COUNTRY. The literal was «في المملكة»
 *      when this was written, «في السعودية» after the 2026-09-05 rewrite, and dropped the «في» after
 *      the 2026-09-25 rewrite («عقارات السعودية», not «في السعودية») — the rule was never about one
 *      phrase or one preposition, it is that the line must say WHERE. A property search that could be
 *      anywhere is a slogan; one that says Saudi Arabia is a product. The literal moves when the
 *      owner rewrites it; the country requirement does not.
 *   5. the title goes through expo-router's <Head> (helmet). A <title> anywhere else in +html.tsx is
 *      dead markup: helmet emits its own FIRST in <head> and the first title is the one a browser
 *      honours. That is precisely why the tab was blank while a <title> sat lower in the document;
 *   6. one source of truth — the same constants feed the OS share text, the in-app sheet and the meta
 *      tags, so the three cannot drift into saying different things again.
 */
import { existsSync, readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const LAYOUT = 'src/app/_layout.tsx';
const SHARE = 'src/lib/share.ts';
const OG_FILE = 'public/og-image-v9.png';
// The page description = the sentence under the title in a Google result (owner 2026-10-27): a free AI
// property search engine for Saudi Arabia only — all sites, market trends, Ministry of Justice prices — «جربه الآن».
const REQUIRED_AR = 'محرك بحث عقاري مجاني بالذكاء الاصطناعي في السعودية: من المنصات الكبيرة لمكاتب الوساطة، من الرياض لحقل، من الفلل للأراضي الخام. بيع وإيجار وإقامات قصيرة. إزهله. خله يدور عنك.';
const REQUIRED_EN = 'Free AI property search in Saudi Arabia: big platforms to small offices, Riyadh to Haql, villas to raw land. Buy, rent or short stays. Ezhalah. Let it search for you.';
// Either word, anywhere in the line, names the country — «في» is not required: the 2026-09-25
// wording says «عقارات السعودية», not «في السعودية».
const NAMES_COUNTRY = /المملكة|السعودية/;
const PAGE_TITLE_AR_OWNER = 'إزهله | ابحث في كل عقارات المملكة بمكان واحد';
const PAGE_TITLE_EN_OWNER = 'Ezhalah | All Saudi properties in one place';
const TITLE_FITS = 44;

// JSX comments are stripped: this file's own prose quotes the tags it is checking for.
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every way a shared link can arrive without a preview. Pure, so the proofs below can break it. */
export function auditShareMeta(layout: string, share: string, exists: (p: string) => boolean): string[] {
  const l = code(layout), s = code(share);
  const bad: string[] = [];

  if (!/<Head>/.test(l)) bad.push('no <Head> — nothing reaches the document head');
  if (!/<title>\{locale === 'en' \? PAGE_TITLE_EN : PAGE_TITLE_AR\}<\/title>/.test(l))
    bad.push('the title is not set through <Head> (per UI language); helmet emits its own empty <title> FIRST and wins');
  // The tab / history / suggestion title (owner 2026-10-27, picked from a phone-width preview): the owner's exact
  // words, the name first, and short enough to show UNCUT in a phone's suggestion row — measured at 430 px, the
  // 48–49-character candidates were cut and the 40–43-character ones fit, so the ceiling is 44.
  const titleAr = s.match(/export const PAGE_TITLE_AR = '([^']+)'/)?.[1];
  const titleEn = s.match(/export const PAGE_TITLE_EN = '([^']+)'/)?.[1];
  if (titleAr !== PAGE_TITLE_AR_OWNER) bad.push(`the Arabic tab title is not the owner's choice: ${titleAr ?? '(missing)'}`);
  if (titleEn !== PAGE_TITLE_EN_OWNER) bad.push(`the English tab title is not the owner's choice: ${titleEn ?? '(missing)'}`);
  for (const [lang, t] of [['Arabic', titleAr], ['English', titleEn]] as const) {
    if (t && [...t].length > TITLE_FITS) bad.push(`the ${lang} tab title is ${[...t].length} characters — a phone cuts it off past ${TITLE_FITS}`);
  }
  for (const [name, re] of [
    ['og:title', /property="og:title"[^/]*content=\{SHARE_TITLE_AR\}/],
    ['og:description', /property="og:description"[^/]*content=\{SHARE_CARD_DESC_AR\}/],
    ['og:image', /property="og:image"[^/]*content=\{OG_IMAGE\}/],
    ['og:url', /property="og:url"/],
    ['twitter:card', /name="twitter:card"[^/]*content="summary"/],
    ['twitter:image', /name="twitter:image"[^/]*content=\{OG_IMAGE\}/],
    ['description', /name="description"[^/]*content=\{SHARE_BLURB_AR\}/],
  ] as const) {
    if (!re.test(l)) bad.push(`${name} is missing or no longer bound to the shared constant`);
  }

  if (!/export const OG_IMAGE = `\$\{SHARE_LINK\}\/og-image-v\d+\.png`;/.test(s))
    bad.push('OG_IMAGE is not an absolute, VERSION-NAMED url — crawlers cache previews by URL, so the file must be renamed when the art changes, never overwritten');
  const blurb = s.match(/export const SHARE_BLURB_AR = '([^']+)'/)?.[1];
  if (blurb !== REQUIRED_AR) bad.push(`the Arabic description is not the owner's wording: ${blurb ?? '(missing)'}`);
  const english = s.match(/export const SHARE_BLURB_EN = '([^']+)'/)?.[1];
  if (english !== REQUIRED_EN) bad.push('the English description is not the owner-approved translation');
  if (!NAMES_COUNTRY.test(blurb ?? '')) bad.push('the description no longer names the country — it must say «في السعودية» (or «في المملكة»)');
  // The OS share text is BUILT by shareLead()/shareMessage() (owner 2026-10-20 wording, live count) —
  // scripts/verify-main-link-share-says-why-search-sites.ts executes them; here: still wired.
  if (!/text: lead, url: SHARE_LINK/.test(s) || !/message, url: SHARE_LINK/.test(s)) bad.push('shareNative no longer sends shareLead()/shareMessage()');

  if (!exists(OG_FILE)) bad.push(`${OG_FILE} does not exist — og:image would 404 and the preview would be blank`);
  return bad;
}

// ── MUTATION PROOF (executable) ──────────────────────────────────────────────────────────────────
const L = readFileSync(LAYOUT, 'utf8'), S = readFileSync(SHARE, 'utf8');
const yes = () => true;
const mustCatch = (label: string, broken: string[]) =>
  check(`mutation caught: ${label}`, broken.length > 0, 'the audit passed deliberately broken input');

mustCatch('og:image tag deleted (preview loses the eagle)',
  auditShareMeta(L.replace(/<meta property="og:image" content=\{OG_IMAGE\} \/>/, ''), S, yes));
mustCatch('og:title deleted', auditShareMeta(L.replace(/<meta property="og:title"[^\n]*\n/, ''), S, yes));
mustCatch('og:description deleted', auditShareMeta(L.replace(/<meta property="og:description"[^\n]*\n/, ''), S, yes));
mustCatch('the title stops going through <Head> (empty tab returns)',
  auditShareMeta(L.replace("<title>{locale === 'en' ? PAGE_TITLE_EN : PAGE_TITLE_AR}</title>", ''), S, yes));
mustCatch('the title stuck on one language (English UI shows the Arabic title)',
  auditShareMeta(L.replace("<title>{locale === 'en' ? PAGE_TITLE_EN : PAGE_TITLE_AR}</title>", '<title>{PAGE_TITLE_AR}</title>'), S, yes));
mustCatch('the tab title reworded away from the owner\'s choice',
  auditShareMeta(L, S.replace(PAGE_TITLE_AR_OWNER, 'إزهله'), yes));
mustCatch('a title too long for a phone (the cut-off "A" candidate)',
  auditShareMeta(L, S.replace(PAGE_TITLE_EN_OWNER, 'Ezhalah | Search every property site in one place'), yes).filter((p) => /cuts it off/.test(p)));
mustCatch('og:image made relative (crawler cannot resolve it)',
  auditShareMeta(L, S.replace(/export const OG_IMAGE = `\$\{SHARE_LINK\}\/og-image-v\d+\.png`;/, "export const OG_IMAGE = '/og-image.jpg';"), yes));
mustCatch('the share image loses its version suffix (new art, stale cached previews everywhere)',
  auditShareMeta(L, S.replace(/og-image-v\d+\.png/, 'og-image.jpg'), yes));
mustCatch('the country is removed from the description',
  auditShareMeta(L, S.replace(REQUIRED_AR, 'مكان واحد لاستكشاف كل إعلانات العقارات في ثواني. جرّبها الآن.'), yes));
mustCatch('the share image file is deleted', auditShareMeta(L, S, () => false));
mustCatch('twitter:card changed to a landscape crop',
  auditShareMeta(L.replace('content="summary"', 'content="summary_large_image"'), S, yes));
// …and it must PASS on the real files, or every proof above is vacuous.
check('the audit passes on the real, unmodified files', auditShareMeta(L, S, existsSync).length === 0,
  auditShareMeta(L, S, existsSync).join('; '));

// ── live rules ───────────────────────────────────────────────────────────────────────────────────
for (const problem of auditShareMeta(L, S, existsSync)) check(problem, false);

// A <title> in +html.tsx is dead markup — helmet's comes first. Ban it so nobody "fixes" the tab there.
const html = code(readFileSync('src/app/+html.tsx', 'utf8'));
check('+html.tsx does NOT declare its own <title> (helmet\'s comes first and would win)', !/<title/.test(html));

// The picture must be the right shape, and small enough that a crawler bothers to fetch it.
if (existsSync(OG_FILE)) {
  const buf = readFileSync(OG_FILE);
  const png = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const w = png ? buf.readUInt32BE(16) : 0, h = png ? buf.readUInt32BE(20) : 0;
  // Owner 2026-10-18 («look how big … keep it small»): WhatsApp draws a BIG banner for an og:image
  // ≥ ~300px wide, a small side thumbnail below it. 192×192 = the same small card /s/ links get.
  const smallCard = (iw: number, ih: number) => iw === ih && iw > 0 && iw < 300;
  check('the share image is a small square PNG (<300px → WhatsApp small thumbnail, not a big banner)', png && smallCard(w, h), `${w}x${h}`);
  check('(mutation) a 512×512 image (the big WhatsApp banner) is refused', !smallCard(512, 512));
  // Owner 2026-10-24: the cloud-eagle logo is the final logo; the preview is the same art as the 192 app icon.
  check('the share artwork matches the owner-selected icon exactly', buf.equals(readFileSync('public/icon-192.png')));
  check('metadata dimensions match the actual image', L.includes('property="og:image:width" content="192"') && L.includes('property="og:image:height" content="192"'));
  const sheet = readFileSync('src/components/ShareSheet.tsx', 'utf8');
  check('the in-app preview uses the same approved artwork', sheet.includes("require('../../public/og-image-v9.png')"));
  const kb = Math.round(buf.length / 1024);
  check(`the share image is under 300KB so crawlers fetch it (${kb}KB)`, kb <= 300);
}

if (failed) {
  console.error(`\n${failed} check(s) FAILED — a shared Ezhalah link would arrive without its preview`);
  process.exit(1);
}
console.log('\nOK — title, og:title, og:description, og:image and twitter tags all declared; 12 mutations caught.');
