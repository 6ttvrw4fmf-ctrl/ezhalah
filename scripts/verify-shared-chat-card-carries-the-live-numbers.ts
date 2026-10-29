// THE SHARED-CHAT CARD'S BOTTOM LINE IS THE HOME LINK'S MARKETING LINE (owner, 2026-10-20).
//
// «No message should be different … the down text should be like [the home card's] — marketing
// without exposing everything.» The /s/<code> card keeps its title («عقارات في الرياض من يوسف على
// إزهله») and the link stays the whole message; its description becomes the same three live counts
// the home link shows — «148 موقع · 390,592 إعلان · 353 مدينة» — in the card's language, and never a
// word about the search itself. Any missing count → the plain tagline, never a zero.
//
// SUPERSEDED IN PART (owner 2026-10-22, approved mockup, after being told the numbers line would leave this
// card): a card whose sender is known says the popup's own invite — «يوسف شاركك: عقارات في الرياض» — with
// «افتحها على إزهله، محرك البحث العقاري بالذكاء الاصطناعي في السعودية» under it. The live numbers line stays
// for a shared link whose card cannot be read (title «إزهله»), so the visitor still sees a real, true card.
//
// EXECUTED: the real api/share-card.ts handler runs here against a stubbed global fetch that answers
// the two RPCs the way PostgREST does, plus the shared_chat_card lookup; the HTML it writes is read
// back. Mutations re-break the line builder in a temp copy and prove the check fails.
import './lib/gateFetch.mjs'; // secret handshake for our own database calls (docs/ops/SCRAPE_GUARD.md)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shareCardHtml, shareCardFactsLine, SHARE_CARD, SHARE_INVITE_LINE, shareInviteNote } from '../src/lib/shareSearch.ts';

const root = join(import.meta.dirname, '..');
let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  fail++;
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const ogDesc = (html: string) => html.match(/property="og:description" content="([^"]*)"/)?.[1] ?? null;
const ogTitle = (html: string) => html.match(/property="og:title" content="([^"]*)"/)?.[1] ?? null;
const FACTS = { sites: 148, listings: 390592, cities: 353 };
const LINE_AR = '390\u066C592 إعلان · 353 مدينة بالمملكة';
const LINE_EN = '390,\u2060592 listings · 353 cities in Saudi Arabia';
const CARD = { q: { deal: 'Buy', category: 'Residential', location: 'الرياض' } as any, name: 'يوسف', locale: 'ar' as const };
const INVITE = shareInviteNote(CARD.name, CARD.q, 'ar')!;

console.log('\nThe shared-chat card carries the home link\'s live numbers line\n');

// ── 1. the pure builder ─────────────────────────────────────────────────────────────────────────
check('AR line is the home card\'s exact shape — listings · cities «بالمملكة», no site count (owner 2026-10-25)', shareCardFactsLine(FACTS, 'ar') === LINE_AR, shareCardFactsLine(FACTS, 'ar'));
check('EN line is the same three counts in English', shareCardFactsLine(FACTS, 'en') === LINE_EN, shareCardFactsLine(FACTS, 'en'));
// A narrow WhatsApp card broke «421,077» after the comma and showed «421,» (owner, 2026-10-29). Every app's preview
// (WhatsApp, Telegram, iMessage, X) reads this same og/twitter description, so the number must not be breakable.
const breakableNumber = (line: string) => /\d,\d/.test(line);
check('no breakable «,» inside a number in either language (Telegram, WhatsApp, iMessage and X all read this line)',
  !breakableNumber(shareCardFactsLine(FACTS, 'ar')) && !breakableNumber(shareCardFactsLine(FACTS, 'en')));
check('a missing count → the plain tagline, never a zero', shareCardFactsLine({ sites: 148, listings: null, cities: 353 }, 'ar') === SHARE_CARD.ar.desc && !/0/.test(shareCardFactsLine({ sites: 148, listings: 0, cities: 353 }, 'ar')));
check('no facts at all → the plain tagline', shareCardFactsLine(null, 'ar') === SHARE_CARD.ar.desc && shareCardFactsLine(undefined, 'en') === SHARE_CARD.en.desc);
{
  const html = shareCardHtml('https://ezhalah-app.vercel.app', 'HvJnnVKT', CARD, FACTS);
  check('the card HTML: title is the popup\'s invite «يوسف شاركك: …» …', ogTitle(html) === INVITE && INVITE.startsWith('يوسف شاركك'), String(ogTitle(html)));
  check('… and og:description is the short tagline (the invite line travels as the message text)', ogDesc(html) === SHARE_CARD.ar.desc && ogDesc(html) !== SHARE_INVITE_LINE.ar, String(ogDesc(html)));
  const unreadHtml = shareCardHtml('https://ezhalah-app.vercel.app', 'HvJnnVKT', null, FACTS);
  check('a link whose card could not be read keeps the live numbers line under «إزهله»', ogTitle(unreadHtml) === 'إزهله' && ogDesc(unreadHtml) === LINE_AR, String(ogDesc(unreadHtml)));
  check('the line names nothing about the search (no deal, no district, no price)', !/شراء|للبيع|إيجار|الرياض|ر\.س/.test(ogDesc(html) ?? ''));
  const noFacts = shareCardHtml('https://ezhalah-app.vercel.app', 'HvJnnVKT', null, null);
  check('without facts the card still renders, with the plain tagline', ogDesc(noFacts) === SHARE_CARD.ar.desc);
}

// ── 2. the real handler, executed against stubbed RPCs ──────────────────────────────────────────
type Res = { setHeader: (k: string, v: string) => void; statusCode: number; end: (b: string) => void; body: string };
const res = (): Res => { const r: any = { headers: {}, statusCode: 0, body: '' }; r.setHeader = (k: string, v: string) => { r.headers[k] = v; }; r.end = (b: string) => { r.body = b; }; return r; };
const req = (p: string) => ({ headers: { host: 'ezhalah-app.vercel.app', 'x-forwarded-proto': 'https' }, query: { p } });
process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-key';
const g = globalThis as any;
let answers: Record<string, () => Promise<Response>> = {};
g.fetch = async (url: string) => { const name = String(url).split('/rpc/')[1]; const a = answers[name]; if (!a) throw new Error(`unexpected fetch ${url}`); return a(); };
const json = (b: unknown) => async () => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const failing = async () => new Response('nope', { status: 500 });
const platforms = [...Array.from({ length: 147 }, (_, i) => `site${i}`), 'aqar', 'aqarmonthly'];
// The handler's imports are extension-less (Vercel's bundler resolves them); Node's loader needs the
// .ts, so the REAL source is copied once with its two local imports pointed at the real files.
const loadHandler = async () => {
  const src = readFileSync(join(root, 'api/share-card.ts'), 'utf8')
    .replace("'../src/lib/shareSearch'", JSON.stringify(pathToFileURL(join(root, 'src/lib/shareSearch.ts')).href))
    .replace("'../middleware'", JSON.stringify(pathToFileURL(join(root, 'middleware.ts')).href));
  if (!/shareSearch\.ts|middleware\.ts/.test(src)) throw new Error('share-card.ts imports moved — update loadHandler');
  const dir = mkdtempSync(join(tmpdir(), 'share-card-')); const f = join(dir, 'share-card.ts');
  writeFileSync(f, src);
  return (await import(pathToFileURL(f).href)).default as (req: unknown, res: unknown) => Promise<void>;
};
const handler = await loadHandler();

answers = {
  shared_chat_card: json([{ sender_name: 'يوسف', locale: 'ar', query: CARD.q }]),
  loader_active_platforms_ar: json(platforms),
  loader_scale_stats_ar: json([{ listing_count: 390592, city_count: 353 }]),
};
{
  const r = res(); await handler(req('HvJnnVKT'), r);
  check('HANDLER: a saved chat renders the popup\'s invite …', ogTitle(r.body) === INVITE, String(ogTitle(r.body)));
  check('… and the short tagline', ogDesc(r.body) === SHARE_CARD.ar.desc, String(ogDesc(r.body)));
}
answers = { ...answers, shared_chat_card: json([]) };
{
  const r = res(); await handler(req('HvJnnVKT'), r);
  check('HANDLER: an unreadable chat → «إزهله» + the live numbers, aqarmonthly folded into Aqar (148, the app\'s count)', ogTitle(r.body) === 'إزهله' && ogDesc(r.body) === LINE_AR, String(ogDesc(r.body)));
}
answers = { ...answers, loader_scale_stats_ar: failing, loader_active_platforms_ar: failing };
{
  // The complete set from the previous call is kept for 10 minutes — the module keeps it.
  const r = res(); await handler(req('HvJnnVKT'), r);
  check('HANDLER: a later failed read reuses the complete set it kept (WhatsApp never waits on a busy database twice)', ogDesc(r.body) === LINE_AR, String(ogDesc(r.body)));
}
{
  // A fresh module with failing RPCs: the plain tagline, the card still answers.
  const fresh = await loadHandler();
  const r = res(); await fresh(req('HvJnnVKT'), r);
  check('HANDLER: both RPCs failing → the card still answers with the plain tagline, never a zero', r.statusCode === 200 && ogDesc(r.body) === SHARE_CARD.ar.desc && !/\b0 /.test(r.body), String(ogDesc(r.body)));
}

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the real code, deliberately re-broken\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const libSrc = readFileSync(join(root, 'src/lib/shareSearch.ts'), 'utf8');
const mutant = async (from: string, to: string) => {
  if (!libSrc.includes(from)) throw new Error(`mutant anchor missing: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), 'share-facts-')); const f = join(dir, 'shareSearch.ts');
  writeFileSync(f, libSrc.replace(from, to).replace("from '@/data/search'", "from '../../../../home/user/ezhalah/src/data/search'"));
  return import(pathToFileURL(f).href) as Promise<typeof import('../src/lib/shareSearch.ts')>;
};
{
  const m = await mutant("if (!f || !factOk(f.sites) || !factOk(f.listings) || !factOk(f.cities)) return SHARE_CARD[loc].desc;", 'if (!f) return SHARE_CARD[loc].desc;');
  let out: string | null = null; let threw = false;
  try { out = m.shareCardFactsLine({ sites: 148, listings: null, cities: 353 }, 'ar'); } catch { threw = true; }
  mustCatch('a missing count rendered as a number (a zero / «null» on the card, or a crash on it)', threw || out !== SHARE_CARD.ar.desc);
}
{
  const m = await mutant("const a = (v: number) => n(v).replace(/,/g, '\\u066C');", 'const a = (v: number) => n(v);');
  mustCatch('the Arabic line back to a plain «421,077» (WhatsApp cut it at «421,»)', breakableNumber(m.shareCardFactsLine(FACTS, 'ar')));
}
{
  const m = await mutant("const e = (v: number) => n(v).replace(/,/g, ',\\u2060');", 'const e = (v: number) => n(v);');
  mustCatch('the English line back to a plain «421,077»', breakableNumber(m.shareCardFactsLine(FACTS, 'en')));
}
{
  const m = await mutant("? `${a(f.listings)} إعلان · ${a(f.cities)} مدينة بالمملكة`", "? `${n(f.sites)} موقع · ${n(f.listings)} إعلان · ${n(f.cities)} مدينة`");
  mustCatch('the line drifting from the home card\'s approved shape (the «و» / «في» WhatsApp truncated)', m.shareCardFactsLine(FACTS, 'ar') !== LINE_AR);
}
{
  const m = await mutant("const c = { site: SHARE_CARD[loc].site, desc: invite ? SHARE_CARD[loc].desc : shareCardFactsLine(facts, loc) };", 'const c = SHARE_CARD[loc];');
  mustCatch('an unreadable link\'s card ignoring the facts it was handed', ogDesc(m.shareCardHtml('https://e.app', 'HvJnnVKT', null, FACTS)) !== LINE_AR);
}
{
  const m = await mutant("desc: invite ? SHARE_CARD[loc].desc : shareCardFactsLine(facts, loc)", 'desc: invite ? SHARE_INVITE_LINE[loc] : shareCardFactsLine(facts, loc)');
  mustCatch('the long invite line back in the card (WhatsApp cut it — it belongs in the message text)', ogDesc(m.shareCardHtml('https://e.app', 'HvJnnVKT', CARD, FACTS)) !== SHARE_CARD.ar.desc);
}
{
  const handlerSrc = readFileSync(join(root, 'api/share-card.ts'), 'utf8');
  mustCatch('the handler no longer passing the facts into the card', !/shareCardHtml\([^)]*,\s*card,\s*facts\)/.test(handlerSrc.replace(', card, facts)', ', card)')) && /shareCardHtml\([^)]*,\s*card,\s*facts\)/.test(handlerSrc));
}

if (fail || mutFail) { console.error(`\n❌ shared-chat-card-carries-the-live-numbers: ${fail} check(s), ${mutFail} mutation(s) failed`); process.exit(1); }
console.log('\n✅ shared-chat-card-carries-the-live-numbers: the card keeps its title and carries the home link\'s live line.');
