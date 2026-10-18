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
  shareLandingPath, shareCardHtml, SHARE_CARD,
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
check('the card title is the approved personal line with the sender\'s name and إزهله',
  meta('og:title') === 'عقارات من يوسف لك على إزهله' && meta('og:description') === SHARE_CARD.ar.desc);
check('every card URL follows the REQUEST\'S domain (a domain change needs no code change)',
  meta('og:image') === 'https://new-domain.example/og-image-v5.png' && meta('og:url') === `https://new-domain.example/s/${fullPayload}`
  && !/vercel\.app/.test(html));
check('the page sends a person to Home + ?share= (never /agent)',
  html.includes(`content="0;url=/?share=${fullPayload}"`) && html.includes(`location.replace("/?share=${fullPayload}")`) && !/\/agent/.test(html));
const enHtml = shareCardHtml('https://x.example', encodeSharePayload(Q, 'Yusuf', 'en')!);
check('an English sender gets the English card, brand kept as "Ezhalah"',
  /<meta property="og:title" content="Properties from Yusuf, just for you on Ezhalah"/.test(enHtml) && /lang="en"/.test(enHtml));
const evil = shareCardHtml('https://x.example', enc({ v: 1, n: '<script>alert(1)</script>', l: 'ar', q: Q }));
check('a hostile name is escaped, never injected into the page', !evil.includes('<script>alert') && evil.includes('&lt;script&gt;'));
mustCatch('a card builder that does not escape the name', (() => {
  const raw = '<meta property="og:title" content="عقارات من <script>alert(1)</script> لك">';
  return raw.includes('<script>alert');
})() && !evil.includes('<script>alert'));
const junk = shareCardHtml('https://x.example', 'not-a-payload');
check('a broken link still gets a clean Ezhalah card and goes Home', /og:title" content="إزهله"/.test(junk) && junk.includes('content="0;url=/"'));

// ── 4. approved wording ─────────────────────────────────────────────────────────────────────────
check('Arabic message is the approved option C', shareMessage('يوسف', 'ar') === 'عقارات من يوسف لك على إزهله. اضغط الرابط وشوف 👇');
check('Arabic landing title + button are the approved option C',
  shareLandingTitle('يوسف', 'ar') === 'عقارات من يوسف لك على إزهله' && SHARE_COPY.ar.button === 'اضغط وشوف العقارات');
check('English keeps "Ezhalah" (brand never translated)',
  shareMessage('Yusuf', 'en') === 'Properties from Yusuf, just for you on Ezhalah. Tap to see 👇'
  && /Ezhalah/.test(SHARE_COPY.en.title));
const allCopy = JSON.stringify(SHARE_COPY);
check('the wording never says "sign in / log in" (owner: «don\'t say log in»)', !/sign ?in|log ?in|سجل|تسجيل|دخولك/i.test(allCopy));
check('the wording never uses the forbidden word «حيك»', !allCopy.includes('حيك'));
check('every Arabic line names إزهله', [SHARE_COPY.ar.message, SHARE_COPY.ar.title].every((s) => s.includes('إزهله')));

// ── 5. no name → nothing ────────────────────────────────────────────────────────────────────────
check('no sender name → no message, no title, no payload (never a blank-name line)',
  shareMessage('  ', 'ar') === null && shareLandingTitle('', 'en') === null && encodeSharePayload(Q, ' ') === null);

console.log(`\nexample link: ${link.slice(0, 90)}…`);
if (failed) { console.error(`\n❌ verify-share-search-link: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-share-search-link: the link carries the search, says the approved words, and never runs by itself.');
