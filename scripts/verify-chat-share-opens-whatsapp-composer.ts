// A SHARED CHAT LINK MUST ARRIVE IN WHATSAPP WITH ITS CARD (owner, 2026-10-20).
//
// The card page (/s/<code>, api/share-card.ts) answered correctly against production with WhatsApp's
// own user agent — title «عقارات في الرياض من يوسف على إزهله», logo, description — and the owner's
// phone still showed «a normal link». A link handed to WhatsApp by the phone's share menu is sent
// without a preview; a link pre-filled in WhatsApp's OWN composer (wa.me/?text=) gets one. So on a
// touch device the reply row's share icon opens the composer, and a desktop copies the link. (The
// top «مشاركة» pill is the normal homepage share since 2026-10-20.)
//
// EXECUTED, not grepped: src/lib/shareToWhatsApp.ts is import-light and is run here against fake
// navigator/window objects. The two call sites are pinned by source, and every claim is re-broken
// in a temp copy to prove the check can fail.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const LIB = join(root, 'src/lib/shareToWhatsApp.ts');
const ROW = join(root, 'src/components/FeedbackRow.tsx');
const AGENT = join(root, 'src/app/agent.tsx');

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

type Lib = {
  whatsAppComposeUrl: (link: string) => string;
  isTouchDevice: (nav: unknown, win: unknown) => boolean;
  openWhatsAppCompose: (link: string, nav?: unknown, win?: unknown) => boolean;
};
const load = async (src: string): Promise<Lib> => {
  const dir = mkdtempSync(join(tmpdir(), 'share-wa-'));
  const f = join(dir, 'shareToWhatsApp.ts');
  writeFileSync(f, src);
  return (await import(pathToFileURL(f).href)) as Lib;
};
const libSrc = readFileSync(LIB, 'utf8');
const phone = { maxTouchPoints: 5 };
const mac = { maxTouchPoints: 0 };
const fakeWin = () => { const gone: string[] = []; return { gone, location: { assign: (u: string) => { gone.push(u); } } }; };
const LINK = 'https://ezhalah-app.vercel.app/s/HvJnnVKT';

console.log('\nA shared chat link opens WhatsApp\'s composer on a phone — the card is built there\n');
const real = await load(libSrc);

check('the composer link is wa.me/?text=<the chat link, URL-encoded once>',
  real.whatsAppComposeUrl(LINK) === `https://wa.me/?text=${encodeURIComponent(LINK)}`, real.whatsAppComposeUrl(LINK));
check('a link with ?share= survives encoding (the & and = cannot leak into wa.me\'s own query)',
  real.whatsAppComposeUrl('https://x.y/?share=a&b=c').endsWith(encodeURIComponent('https://x.y/?share=a&b=c')));
{
  const w = fakeWin();
  check('PHONE: navigates the same tab to the composer and reports handled',
    real.openWhatsAppCompose(LINK, phone, w) === true && w.gone.length === 1 && w.gone[0] === real.whatsAppComposeUrl(LINK));
}
{
  const w = fakeWin();
  check('DESKTOP (0 touch points): does NOT navigate and reports unhandled, so the caller copies the link',
    real.openWhatsAppCompose(LINK, mac, w) === false && w.gone.length === 0);
}
{
  const w = { ...fakeWin(), matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) };
  check('a browser without maxTouchPoints falls back to the coarse-pointer query (phone → handled)',
    real.openWhatsAppCompose(LINK, {}, w) === true);
}
check('no window at all (SSR / native) → unhandled, never a throw',
  real.openWhatsAppCompose(LINK, phone, null) === false);

// ── the two buttons really use it ───────────────────────────────────────────────────────────────
const rowSrc = readFileSync(ROW, 'utf8');
const agentSrc = readFileSync(AGENT, 'utf8');
// OWNER 2026-10-22 («why direct WhatsApp, that isn't what we agreed»): on a phone the reply row's Share opens
// the PHONE'S SHARE MENU with the LINK ONLY (no text beside it, so the target builds the card); WhatsApp's
// composer is the fallback for a touch browser with no menu, and a desktop copies. The checks below pin that.
const usesIt = (src: string) => /import \{ openWhatsAppCompose, isTouchDevice \} from '@\/lib\/shareToWhatsApp'/.test(src) && /openWhatsAppCompose\(url\)/.test(src);
// Owner 2026-10-22 (WhatsApp screenshot): the card cut its line, so the invite LINE rides as the message text
// beside the link — the menu gets { text: shareText, url } when a text exists, else the bare link.
const menuLinkOnly = (src: string) => { const i = src.indexOf('const onShare = async'); const body = i < 0 ? '' : src.slice(i, i + 2400);
  return /await nav\.share\(shareText \? \{ text: shareText, url \} : \{ url \}\)/.test(body) && body.indexOf('nav.share(') < body.indexOf('openWhatsAppCompose(url)'); };
const agentSendsInviteLine = (src: string) => /shareText: SHARE_INVITE_LINE\[loc\]/.test(src) && !/shareText: shareMessage\(/.test(src);
check('the text beside the link is the invite LINE (never the card title twice)', agentSendsInviteLine(readFileSync(AGENT, 'utf8')));
const sharesChatViaMenu = (src: string, fn: string) => {
  const i = src.indexOf(fn); if (i < 0) return true;
  return /\bnav(?:igator)?\??\.share\(/.test(src.slice(i, i + 1600));
};
check('FeedbackRow keeps WhatsApp\'s composer as the fallback (touch browser without a share menu)', usesIt(rowSrc));
check('FeedbackRow opens the phone\'s share menu FIRST, with the invite line as text beside the link', menuLinkOnly(rowSrc));
void sharesChatViaMenu;
// Owner 2026-10-20: the top «مشاركة» pill is the NORMAL share again (scripts/verify-share-search-link.ts
// pins it); the chat is shared only from the reply row, so agent.tsx must not grow a second chat share.
check('agent.tsx has no chat-share path of its own any more (the reply row is the one place)',
  !/shareThisChat/.test(agentSrc) && !/openWhatsAppCompose/.test(agentSrc));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the real code, deliberately re-broken\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mutant = (from: string, to: string) => {
  if (!libSrc.includes(from)) throw new Error(`mutant anchor missing: ${from}`);
  return load(libSrc.replace(from, to));
};
{
  const m = await mutant('?text=${encodeURIComponent(link)}', '?text=${link}');
  mustCatch('the link pasted into wa.me unencoded', !m.whatsAppComposeUrl('https://x.y/?share=a&b=c').endsWith(encodeURIComponent('https://x.y/?share=a&b=c')));
}
{
  const m = await mutant('if (!isTouchDevice(nav, win)) return false;', '');
  const w = fakeWin();
  mustCatch('a desktop sent to wa.me too (it has no WhatsApp app to open)', !(m.openWhatsAppCompose(LINK, mac, w) === false && w.gone.length === 0));
}
{
  const m = await mutant('win.location.assign(whatsAppComposeUrl(link));\n  return true;', 'return true;');
  const w = fakeWin();
  mustCatch('"handled" reported without ever opening WhatsApp', !(m.openWhatsAppCompose(LINK, phone, w) === true && w.gone.length === 1));
}
mustCatch('FeedbackRow going straight to WhatsApp again (no share menu)',
  !menuLinkOnly(rowSrc.replace('try { await nav.share(shareText ? { text: shareText, url } : { url }); return; }', 'try { /* menu removed */ }')));
mustCatch('the invite line dropped from the message (only the cut-off card line again)',
  !menuLinkOnly(rowSrc.replace('await nav.share(shareText ? { text: shareText, url } : { url })', 'await nav.share({ url })')));
mustCatch('the card title sent as the text (the same sentence twice)',
  !agentSendsInviteLine('return { shareUrl, prepareShare, shareText: shareMessage(name, q, loc) };'));
mustCatch('the import of the helper removed from FeedbackRow', !usesIt(rowSrc.replace("import { openWhatsAppCompose, isTouchDevice } from '@/lib/shareToWhatsApp';", '')));

if (fail || mutFail) { console.error(`\n❌ chat-share-opens-whatsapp-composer: ${fail} check(s), ${mutFail} mutation(s) failed`); process.exit(1); }
console.log('\n✅ chat-share-opens-whatsapp-composer: all checks passed, every mutation caught.');
