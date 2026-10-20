// THE MAIN LINK'S SHARE MESSAGE IS «ليش تدوّر في 148 موقع؟ إزهله يدوّر عنك» (owner, 2026-10-20).
//
// The owner looked at a WhatsApp share of the home link — the eagle card on top, then the long typed
// sentence («تدور على عقار وتبي تشوف المعروض من مختلف المواقع بمكان واحد؟ إزهله، الطريقة الأذكى …»)
// — and replaced that sentence with the one above. The card itself (title, eagle, «148 موقع · … إعلان
// · … مدينة») is untouched, and the page's SEO description (SHARE_BLURB_AR) keeps the old wording.
//
// The 148 is LIVE, never typed: the platform catalog minus the registry's dormant sites — the same
// count the app shows. While that count is unknown the sentence says «كل المواقع»; it never shows a
// zero or a stale number.
//
// EXECUTED: liveSiteCount / shareLead / shareMessage are lifted out of src/lib/share.ts and run
// against a stubbed catalog + registry (share.ts imports react-native, so it cannot be imported).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

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
// 152 catalog entries, 4 dormant → 148, the number the app shows (and the owner's).
g.__meta = Array.from({ length: 152 }, (_, i) => ({ name: `site${i}` }));
g.__hidden = new Set(['site1', 'site2', 'site3', 'site4']);
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
  'const PLATFORM_META: any[] = (globalThis as any).__meta; const hiddenPlatformNames = () => (globalThis as any).__hidden;',
) as Promise<Lib>;
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const writeTemp = (src: string) => { const f = join(mkdtempSync(join(tmpdir(), 'share-lead-')), 'share.ts'); writeFileSync(f, src); return f; };

console.log('\nThe main link\'s share message says «ليش تدوّر في 148 موقع؟ إزهله يدوّر عنك», with a live 148\n');
const real = await load(shareSrc);

check('liveSiteCount() = catalog minus dormant = 148 (the number the app shows)', real.liveSiteCount() === 148, String(real.liveSiteCount()));
check('the Arabic sentence is the owner\'s exact words with that live number', real.shareLead('ar', real.liveSiteCount()) === OWNER_AR, real.shareLead('ar', real.liveSiteCount()));
check('the message = that sentence, a newline, the link — nothing else', real.shareMessage('ar', 148) === `${OWNER_AR}\n${LINK}`);
check('the English sentence carries the same live number', real.shareLead('en', 148) === 'Why search 148 sites? Ezhalah searches for you.');
g.__hidden = null;
check('registry not answered yet → count unknown (null), never 152 and never 0', real.liveSiteCount() === null, String(real.liveSiteCount()));
check('unknown count → «كل المواقع», never a zero or a typed number', real.shareLead('ar', null) === 'ليش تدوّر في كل المواقع؟ إزهله يدوّر عنك' && !/\d/.test(real.shareLead('ar', null)) && !/\d/.test(real.shareLead('en', null)));
check('a zero or a bad count is treated as unknown', real.shareLead('ar', 0) === real.shareLead('ar', null) && real.shareLead('ar', 2.5) === real.shareLead('ar', null));
g.__hidden = new Set(['site1', 'site2', 'site3', 'site4']);
check('the old long sentence is gone from the sent message (it stays only as the page\'s SEO description)',
  !real.shareMessage('ar', 148).includes('الطريقة الأذكى') && /SHARE_BLURB_AR = 'تدور على عقار/.test(shareSrc));

// ── wiring: both share surfaces send the built sentence ─────────────────────────────────────────
const sheet = readFileSync(join(root, 'src/components/ShareSheet.tsx'), 'utf8');
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
  const m = await mutant('{count}', '148');
  mustCatch('the number typed into the sentence instead of the live count', m.shareLead('ar', 150) === OWNER_AR);
}
{
  const m = await mutant('  if (!hidden) return null;\n', '');
  g.__hidden = null;
  let v: number | null = -1; try { v = m.liveSiteCount(); } catch { v = -2; }
  g.__hidden = new Set(['site1', 'site2', 'site3', 'site4']);
  mustCatch('an unanswered registry counted as «every site is up» (152) or crashing', v !== null);
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
