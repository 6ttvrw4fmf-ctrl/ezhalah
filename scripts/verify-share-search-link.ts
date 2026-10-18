// verify-share-search-link — a shared search link carries the SEARCH, says the approved words, and
// never runs a search by itself (owner 2026-10-17; appSession gate, owner 2026-08-16).
//
// EXECUTES src/lib/shareSearch.ts (pure) and proves, with mutation proofs:
//   1. round trip: the exact search and the sender's first name survive encode → link → decode,
//      Arabic included, and the payload is URL-safe;
//   2. a malformed / foreign / wrong-version payload decodes to null — never a guessed search;
//   3. the link lands on HOME with ?share= (never /agent: a pasted link must not execute anything);
//   4. the owner-approved wording (option C) is exactly what ships, says Ezhalah, never says
//      "sign in", and never uses the forbidden word «حيك»;
//   5. no name → no message (never a line with a blank name).
import {
  encodeSharePayload, decodeSharePayload, shareLink, shareMessage, shareLandingTitle, SHARE_COPY, SHARE_PARAM,
  shareLandingPath, shareCardHtml, SHARE_CARD, shareTitle, isShareCode, sharedChatCardFrom,
} from '../src/lib/shareSearch.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`);
  if (!caught) failed++;
};

const Q = {
  deal: 'Rent', location: 'الرياض', category: 'Residential', type: 'Apartment',
  districtLabel: 'حي النرجس', districts: ['حي النرجس'], price: '60000',
} as any;

// ── 1. round trip ───────────────────────────────────────────────────────────────────────────────
const payload = encodeSharePayload(Q, 'يوسف الأحمد');
const link = payload ? shareLink('https://ezhalah-app.vercel.app/', payload) : '';
const back = decodeSharePayload(new URL(link).pathname.split('/').pop() ?? null);
check('the exact search and the sender\'s first name survive encode → link → decode (Arabic included)',
  !!back && back.name === 'يوسف' && JSON.stringify(back.q) === JSON.stringify(Q));
check('the payload is URL-safe (no +, /, = or spaces)', !!payload && /^[A-Za-z0-9_-]+$/.test(payload));

// ── 2. garbage is null ──────────────────────────────────────────────────────────────────────────
const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rejects = (decode: typeof decodeSharePayload) =>
  decode(null) === null && decode('') === null && decode('%%%not-base64%%%') === null
  && decode(enc({ v: 2, n: 'يوسف', q: Q })) === null            // another version
  && decode(enc({ v: 1, n: '', q: Q })) === null                 // no name
  && decode(enc({ v: 1, n: 'يوسف', q: { deal: 'Rent' } })) === null   // no location
  && decode(enc({ v: 1, n: 'يوسف', q: { ...Q, deal: 'Steal' } })) === null // foreign deal
  && decode(enc({ v: 1, n: 'يوسف', q: { ...Q, deal: 'Both' } })) === null  // not a Deal value
  && decode('A'.repeat(9000)) === null;                          // oversized
check('malformed, foreign, wrong-version and oversized payloads all decode to null', rejects(decodeSharePayload));
mustCatch('a decoder that trusts any JSON it is handed', !rejects((raw) => {
  try { const p = JSON.parse(decodeURIComponent(escape(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/'))))); return { q: p.q, name: p.n }; } catch { return null; }
}));

// ── 3. the preview page, then Home ─────────────────────────────────────────────────────────────
// The link is the WhatsApp preview page /s/<payload>; that page sends a person to Home + ?share=.
// Neither ever opens /agent or carries ?filter= (a pasted link must not run a search by itself).
const landsHome = (mk: typeof shareLink, landing: typeof shareLandingPath) => {
  const u = new URL(mk('https://ezhalah-app.vercel.app', 'abc'));
  const to = new URL(landing('abc'), 'https://x.example');
  return u.pathname === '/s/abc' && !u.search && to.pathname === '/' && to.searchParams.get(SHARE_PARAM) === 'abc' && !to.searchParams.has('filter');
};
check('the link is the /s/ preview page, which lands on Home + ?share= — never /agent, never ?filter=', landsHome(shareLink, shareLandingPath));
mustCatch('a link that deep-links straight into /agent?filter= (it would bypass the appSession gate)',
  !landsHome((o, p) => `${o}/agent?filter=${p}`, shareLandingPath));

// ── 3b. the WhatsApp card (owner 2026-10-17: a bold title with the name, one short line, the site) ──
const fullPayload = encodeSharePayload(Q, 'يوسف', 'ar')!;
const html = shareCardHtml('https://new-domain.example', fullPayload);
const meta = (prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(html)?.[1] ?? null;
check('the card title names the type, the place, the sender and إزهله; the line is Ezhalah\'s promise',
  meta('og:title') === 'شقق للإيجار في حي النرجس من يوسف على إزهله' && meta('og:description') === 'كل مواقع العقار في مكان واحد · اضغط وشوف');
check('every card URL follows the REQUEST\'S domain (a domain change needs no code change)',
  meta('og:image') === 'https://new-domain.example/og-image-v5.png' && meta('og:url') === `https://new-domain.example/s/${fullPayload}`
  && !/vercel\.app/.test(html));
check('the page sends a person to Home + ?share= (never /agent)',
  html.includes(`content="0;url=/?share=${fullPayload}"`) && html.includes(`location.replace("/?share=${fullPayload}")`) && !/\/agent/.test(html));
const enHtml = shareCardHtml('https://x.example', encodeSharePayload(Q, 'Yusuf', 'en')!);
check('an English sender gets the English card, brand kept as "Ezhalah"',
  /<meta property="og:title" content="Apartments for rent from Yusuf on Ezhalah"/.test(enHtml) && /lang="en"/.test(enHtml));
const evil = shareCardHtml('https://x.example', enc({ v: 1, n: '<script>alert(1)</script>', l: 'ar', q: Q }));
check('a hostile name is escaped, never injected into the page', !evil.includes('<script>alert') && evil.includes('&lt;script&gt;'));
mustCatch('a card builder that does not escape the name', (() => {
  const raw = '<meta property="og:title" content="عقارات من <script>alert(1)</script> لك">';
  return raw.includes('<script>alert');
})() && !evil.includes('<script>alert'));
const junk = shareCardHtml('https://x.example', 'not-a-payload');
check('a broken link still gets a clean Ezhalah card and goes Home', /og:title" content="إزهله"/.test(junk) && junk.includes('content="0;url=/"'));

// ── 3c. a SHARED CHAT link: /s/<8-char code> (owner 2026-10-17: «sharing it means I share the chat history») ──
check('an 8-character code is a share code; a search payload and junk are not',
  isShareCode('a7Kx2bQ9') && !isShareCode(fullPayload) && !isShareCode('a7Kx2b') && !isShareCode('a7Kx-bQ9') && !isShareCode(null));
const row = { sender_name: 'يوسف الأحمد', locale: 'en', query: Q };
const card = sharedChatCardFrom(row);
const cardOk = (from: typeof sharedChatCardFrom) => {
  const c = from(row);
  return !!c && c.name === 'يوسف' && c.locale === 'en' && from(null) === null && from({ sender_name: '', locale: 'ar', query: Q }) === null
    && from({ sender_name: 'x', locale: 'ar', query: { deal: 'Steal', location: 'x' } }) === null && from({ sender_name: 'x', query: 'nope' }) === null;
};
check('a database card row is validated (first name, sender\'s language) — anything off is null', cardOk(sharedChatCardFrom));
mustCatch('a card reader that trusts whatever row comes back', !cardOk((r: any) => (r ? { q: r.query, name: r.sender_name, locale: r.locale } : null) as any));
const chatHtml = shareCardHtml('https://x.example', 'a7Kx2bQ9', sharedChatCardFrom({ sender_name: 'يوسف', locale: 'ar', query: Q }));
check('a shared chat\'s card says the approved title and sends the person to Home + ?share=<code>',
  /og:title" content="شقق للإيجار في حي النرجس من يوسف على إزهله"/.test(chatHtml) && chatHtml.includes('location.replace("/?share=a7Kx2bQ9")') && !/\/agent/.test(chatHtml));
const unread = shareCardHtml('https://x.example', 'a7Kx2bQ9', null);
check('a code whose card could not be read still goes to Home + ?share=<code> (the app reads the chat) — never a dead link',
  /og:title" content="إزهله"/.test(unread) && unread.includes('location.replace("/?share=a7Kx2bQ9")'));
void card;

// ── 4. the approved title: «{type} {deal} في {place} من {name} على إزهله» (owner 2026-10-17) ─────────
const T = (q: any, loc: 'ar' | 'en' = 'ar') => shareTitle(loc === 'ar' ? 'يوسف' : 'Yusuf', q, loc);
check('district: «شقق للإيجار في حي النرجس من يوسف على إزهله»', T(Q) === 'شقق للإيجار في حي النرجس من يوسف على إزهله');
check('two districts read «النرجس والياسمين»',
  T({ ...Q, districtLabel: undefined, districts: ['حي النرجس', 'حي الياسمين'] }) === 'شقق للإيجار في النرجس والياسمين من يوسف على إزهله');
check('three districts are all named',
  T({ ...Q, districtLabel: undefined, districts: ['النرجس', 'الياسمين', 'الملقا'] }) === 'شقق للإيجار في النرجس والياسمين والملقا من يوسف على إزهله');
check('four or more stay short: «النرجس و3 أحياء ثانية»',
  T({ ...Q, districtLabel: undefined, districts: ['النرجس', 'الياسمين', 'الملقا', 'حطين'] }) === 'شقق للإيجار في النرجس و3 أحياء ثانية من يوسف على إزهله');
check('city only: «فلل للبيع في جدة …»',
  T({ deal: 'Buy', location: 'جدة', type: 'Villa' }) === 'فلل للبيع في جدة من يوسف على إزهله');
check('no type, no place: «عقارات من يوسف على إزهله»', T({ deal: 'Rent', location: '' }) === 'عقارات من يوسف على إزهله');
check('a place in the other script is left out, never mixed into the sentence',
  T({ deal: 'Rent', location: 'Riyadh', type: 'Apartment' }) === 'شقق للإيجار من يوسف على إزهله'
  && T({ deal: 'Rent', location: 'Riyadh', type: 'Apartment' }, 'en') === 'Apartments for rent in Riyadh from Yusuf on Ezhalah');
check('the message is the title + 👇 (short — the card holds the rest)', shareMessage('يوسف', Q, 'ar') === 'شقق للإيجار في حي النرجس من يوسف على إزهله 👇');
check('the landing title is the same title; the button is «اضغط وشوف العقارات»',
  shareLandingTitle('يوسف', Q, 'ar') === T(Q) && SHARE_COPY.ar.button === 'اضغط وشوف العقارات');
mustCatch('a title that forgets the place', (() => {
  const noPlace = (q: any) => shareTitle('يوسف', { ...q, districtLabel: undefined, districts: [], location: '' }, 'ar');
  return noPlace(Q) !== T(Q);
})());
const allCopy = JSON.stringify(SHARE_COPY) + JSON.stringify(SHARE_CARD) + T(Q) + T(Q, 'en');
check('the wording never says "sign in / log in" (owner: «don\'t say log in»)', !/sign ?in|log ?in|سجل|تسجيل|دخولك/i.test(allCopy));
check('the wording never uses the forbidden word «حيك»', !allCopy.includes('حيك'));
check('no eagle emoji anywhere — the Ezhalah logo is enough (owner 2026-10-17)', !allCopy.includes('🦅'));
check('the Arabic title names إزهله and the English keeps "Ezhalah"', T(Q).includes('إزهله') && /Ezhalah/.test(T(Q, 'en') ?? ''));

// ── 5. no name → nothing ────────────────────────────────────────────────────────────────────────
check('no sender name → no message, no title, no payload (never a blank-name line)',
  shareMessage('  ', Q, 'ar') === null && shareLandingTitle('', Q, 'en') === null && encodeSharePayload(Q, ' ') === null);

console.log(`\nexample link: ${link.slice(0, 90)}…`);
if (failed) { console.error(`\n❌ verify-share-search-link: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-share-search-link: the link carries the search, says the approved words, and never runs by itself.');
