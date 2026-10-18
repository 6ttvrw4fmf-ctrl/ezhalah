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
const back = decodeSharePayload(new URL(link).searchParams.get(SHARE_PARAM));
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

// ── 3. lands on Home ────────────────────────────────────────────────────────────────────────────
const landsHome = (mk: typeof shareLink) => {
  const u = new URL(mk('https://ezhalah-app.vercel.app', 'abc'));
  return u.pathname === '/' && u.searchParams.get(SHARE_PARAM) === 'abc' && !u.searchParams.has('filter');
};
check('the link is Home + ?share= — a pasted link never opens /agent or carries ?filter=', landsHome(shareLink));
mustCatch('a link that deep-links straight into /agent?filter= (it would bypass the appSession gate)',
  !landsHome((o, p) => `${o}/agent?filter=${p}`));

// ── 4. approved wording ─────────────────────────────────────────────────────────────────────────
check('Arabic message is the approved option C', shareMessage('يوسف', 'ar') === 'عقارات من يوسف لك على إزهله 🦅 اضغط الرابط وشوف 👇');
check('Arabic landing title + button are the approved option C',
  shareLandingTitle('يوسف', 'ar') === 'عقارات من يوسف لك على إزهله' && SHARE_COPY.ar.button === 'اضغط وشوف العقارات');
check('English keeps "Ezhalah" (brand never translated)',
  shareMessage('Yusuf', 'en') === 'Properties from Yusuf, just for you on Ezhalah 🦅 Tap to see 👇'
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
