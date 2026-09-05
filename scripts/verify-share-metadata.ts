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
 *   3. the image file EXISTS, is 1200x630, and is small enough that a crawler will actually fetch it;
 *   4. the description is the OWNER'S wording, including «في المملكة» — the words that say WHERE;
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
const OG_FILE = 'public/og-image-v2.jpg';
const REQUIRED_AR = 'مكان واحد لاستكشاف كل إعلانات العقارات في المملكة في ثواني. جرّبها الآن.';

// JSX comments are stripped: this file's own prose quotes the tags it is checking for.
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every way a shared link can arrive without a preview. Pure, so the proofs below can break it. */
export function auditShareMeta(layout: string, share: string, exists: (p: string) => boolean): string[] {
  const l = code(layout), s = code(share);
  const bad: string[] = [];

  if (!/<Head>/.test(l)) bad.push('no <Head> — nothing reaches the document head');
  if (!/<title>\{SHARE_TITLE_AR\}<\/title>/.test(l))
    bad.push('the title is not set through <Head>; helmet emits its own empty <title> FIRST and wins');
  for (const [name, re] of [
    ['og:title', /property="og:title"[^/]*content=\{SHARE_TITLE_AR\}/],
    ['og:description', /property="og:description"[^/]*content=\{SHARE_BLURB_AR\}/],
    ['og:image', /property="og:image"[^/]*content=\{OG_IMAGE\}/],
    ['og:url', /property="og:url"/],
    ['twitter:card', /name="twitter:card"[^/]*content="summary_large_image"/],
    ['twitter:image', /name="twitter:image"[^/]*content=\{OG_IMAGE\}/],
    ['description', /name="description"[^/]*content=\{SHARE_BLURB_AR\}/],
  ] as const) {
    if (!re.test(l)) bad.push(`${name} is missing or no longer bound to the shared constant`);
  }

  if (!/export const OG_IMAGE = `\$\{SHARE_LINK\}\/og-image-v\d+\.jpg`;/.test(s))
    bad.push('OG_IMAGE is not an absolute, VERSION-NAMED url — crawlers cache previews by URL, so the file must be renamed when the art changes, never overwritten');
  const blurb = s.match(/export const SHARE_BLURB_AR = '([^']+)'/)?.[1];
  if (blurb !== REQUIRED_AR) bad.push(`the Arabic description is not the owner's wording: ${blurb ?? '(missing)'}`);
  if (!/في المملكة/.test(blurb ?? '')) bad.push('«في المملكة» is gone — the line no longer says WHERE');
  // The OS share text and the in-app sheet must read from the same constant, not their own copy.
  if (!/blurb: SHARE_BLURB_AR/.test(s)) bad.push('the Arabic share text no longer reuses SHARE_BLURB_AR');

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
  auditShareMeta(L.replace('<title>{SHARE_TITLE_AR}</title>', ''), S, yes));
mustCatch('og:image made relative (crawler cannot resolve it)',
  auditShareMeta(L, S.replace(/export const OG_IMAGE = `\$\{SHARE_LINK\}\/og-image-v\d+\.jpg`;/, "export const OG_IMAGE = '/og-image.jpg';"), yes));
mustCatch('the share image loses its version suffix (new art, stale cached previews everywhere)',
  auditShareMeta(L, S.replace(/og-image-v\d+\.jpg/, 'og-image.jpg'), yes));
mustCatch('«في المملكة» removed from the description',
  auditShareMeta(L, S.replace(REQUIRED_AR, 'مكان واحد لاستكشاف كل إعلانات العقارات في ثواني. جرّبها الآن.'), yes));
mustCatch('the share image file is deleted', auditShareMeta(L, S, () => false));
mustCatch('twitter:card downgraded to the small variant',
  auditShareMeta(L.replace('content="summary_large_image"', 'content="summary"'), S, yes));
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
  let w = 0, h = 0;
  for (let i = 2; i + 9 < buf.length; ) {           // walk JPEG segments to the SOF frame header
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  check('the share image is 1200x630 (the ratio every platform crops to)', w === 1200 && h === 630, `${w}x${h}`);
  const kb = Math.round(buf.length / 1024);
  check(`the share image is under 300KB so crawlers fetch it (${kb}KB)`, kb <= 300);
}

if (failed) {
  console.error(`\n${failed} check(s) FAILED — a shared Ezhalah link would arrive without its preview`);
  process.exit(1);
}
console.log('\nOK — title, og:title, og:description, og:image and twitter tags all declared; 8 mutations caught.');
