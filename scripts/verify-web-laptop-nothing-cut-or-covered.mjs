// THE LAPTOP ROBOT — opens the BUILT app as a visitor on a laptop and fails the change if anything is CUT or COVERED.
//
// Owner 2026-11-10, after the launch audit: «I need u sit and fix it all please make sure never ever get this mistake
// ever. Ever again». The audit found two things a visitor on a laptop-size screen really met:
//   1. COVERED — the floating «تسجيل الدخول» card and the cookie card sat ON TOP of the search form. A tap meant for the
//      form landed on the card (it opened Apple sign-in). Both cards used "the side menu is docked" (900 px) as "there is
//      a free column beside the form"; that free column only exists on much wider screens.
//   2. CUT — with an ad open beside the results, the card's price «ر.س 2,700,000» was drawn as «…00,000». The price was
//      a one-line box, so a narrow column cut it and put «…» in place of digits. A cut price is a wrong price.
//
// What this robot does on every PR (.github/workflows/web-runtime-smoke.yml), in a real Chromium on the built app:
//   PART A — COVERED. For each laptop size below, a FRESH signed-out visitor opens the Filter page, in Arabic and then in
//     English. The two cards are measured against every control on the page (inputs, buttons, links, pressables):
//       • a card may not sit over any control (checked with the browser's own hit-test at the overlap),
//       • the cookie card must be on screen for every signed-out visitor (owner 2026-09-13) — hiding it is not a fix,
//       • the sign-in card must be on screen from SIGNIN_CARD_FROM wide (owner 2026-08-29: «put it in the side») — so
//         "remove the card everywhere" is not a fix either. ONE exception, and the robot works it out itself from what
//         it measures: a window too SHORT to hold the card above the cookie card with their margins. There the card
//         waits off-screen — and the robot then answers the cookie card and requires the sign-in card to appear,
//       • the two cards may not sit on each other, and neither may hang off the screen.
//     It then makes a wide window narrow without reloading and measures again.
//   PART B — CUT. It runs one real search (الرياض), then checks every line that carries money — every element marked
//     `data-money` (src/lib/moneyLine.ts) — on the roomy cards, on the narrow cards with an ad open beside them, and at a
//     phone width, first with the real prices and then with the LONGEST prices we can serve written in:
//       • a money line is never a one-line box (numberOfLines) — it must be free to wrap,
//       • every number stays whole on ONE line (no «3,450,» on one line and «000» on the next),
//       • nothing clips it (not its own box, not its row, not the card) and it does not spill out of its line,
//       • a price printed on a line that is NOT marked is a failure too, so a new price line cannot dodge the robot,
//       • finding no money line at all is a failure, never a skip.
//     It then opens the Ministry of Justice past-sales table inside the open ad (five columns: the tightest money
//     lines in the app) with the LONGEST amounts in its rows, on a laptop and on 390 and 320 px phones. The robot
//     answers the three reads behind that table itself, so the table is there on every run whatever ad the search
//     opened; a table that does not open, or does not show the long amount, is a failure, never a skip.
//
// Run:  node scripts/verify-web-laptop-nothing-cut-or-covered.mjs        (after `npx expo export --platform web`)
//       LAPTOP_ROBOT_DIST=/path/to/dist node scripts/verify-web-laptop-nothing-cut-or-covered.mjs
//       LAPTOP_ROBOT_ONLY=cover|money   one part only (local use)      LAPTOP_ROBOT_SHOTS=/dir   save a picture per state
// Kept out of `npm test` (a real browser): it runs in .github/workflows/web-runtime-smoke.yml on every PR.
import { robotPassHeaders } from './lib/robotPass.mjs'; // robot pass for our own browser robots (docs/ops/SCRAPE_GUARD.md)
import { gateHeaders } from './lib/gateFetch.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
// The cookie card's name and the one way a robot answers it are SHARED (scripts/lib/liveConsent.ts) — never a private copy.
import { dismissCookieConsent, CONSENT_CARD } from './lib/liveConsent.ts';

const DIST = process.env.LAPTOP_ROBOT_DIST || new URL('../dist/', import.meta.url).pathname;
const ONLY = process.env.LAPTOP_ROBOT_ONLY || '';
const SHOTS = process.env.LAPTOP_ROBOT_SHOTS || '';
// Laptop windows people really have: small and short ones first (that is where the cards had no room).
const SIZES = [[900, 620], [1024, 640], [1100, 700], [1280, 620], [1280, 720], [1366, 650], [1366, 768], [1440, 900], [1536, 730], [1920, 950]];
/** From this width up a fresh signed-out visitor must SEE the floating sign-in card. The robot's own number, on purpose:
 *  raising the app's breakpoint until the card is gone from every laptop would otherwise read as "nothing is covered". */
export const SIGNIN_CARD_FROM = 1366;
const OVERLAP_PX = 2;            // sub-pixel edges touching is not "covering"
const CARD_MARGIN = 16;          // the robot's own number: the air the sign-in card keeps above, below and between
// Short windows where the sign-in card has NO room above the cookie corner card. The robot answers the cookie card there
// and the waiting sign-in card must take its place.
const WAITS = [[1536, 730, 'English'], [1440, 620, 'Arabic']];
const ATTEMPTS = 3;              // the search talks to the live database; a real cut fails every attempt
// The longest prices the app can serve: a ten-digit sale (one is in the index today) and a seven-digit yearly rent.
const WORST_PRICES = ['ر.س 2,183,845,500', 'ر.س 9,999,999/سنوياً', 'ر.س 999,999,999'];
const WORST_MONTHLY = 'السعر المعلن 999,999 شهرياً';
// The Ministry of Justice past-sales table. LONG_AMOUNT is the longest sale price we hold (ten digits); the table must
// show it whole. The rows below are the robot's own answer to the app's reads of moj_district_sales / moj_district_deals.
const LONG_AMOUNT = '2,183,845,500';
const MOJ_SUMMARY = { moj_region: 'الرياض', moj_area: 'الرياض/الملقا', fetched_at: '2026-11-08T03:00:00+00:00', deals: 12, avg_deal: 2183845500, avg_ppm: 9999999,
  p10_deal: 999999999, p90_deal: 2183845500, window_from: '2025-11-01', window_to: '2026-10-31', source_refreshed_at: '2026-11-07T00:00:00+00:00' };
const MOJ_DEAL_SHAPES = [[123456.78, 2183845500, 9999999], [99999.99, 999999999, 1234567], [612.5, 1250000, 2041]];
const MOJ_DEALS = Array.from({ length: 12 }, (_, i) => {
  const [area_m2, price, ppm] = MOJ_DEAL_SHAPES[i % MOJ_DEAL_SHAPES.length];
  return { deal_ref: String(1234567890123 + i), deal_date: `2026-10-${String(28 - i).padStart(2, '0')}`, area_m2, price, ppm };
});
const DEALS_SHEET = '[data-testid="listing-preview-moj-deals-sheet"]';

let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`); };

// ── the verdicts, pure — so the robot proves it would fail before it opens a browser ─────────────────────────────────
// One measured screen: { vw, vh, signIn: rect|null, signInH: px|null, cookie: rect|null, covered: [{ card, control, px }] },
// rect = {l,t,r,b}. signIn is the card the visitor can SEE; signInH is the card's real height whether or not it is shown
// (null = the card is not on the page at all).
const overlap = (p, q) => Math.min(p.r, q.r) - Math.max(p.l, q.l) > OVERLAP_PX && Math.min(p.b, q.b) - Math.max(p.t, q.t) > OVERLAP_PX;
/** Is there room for a sign-in card `h` tall above the cookie card (or above the window's bottom edge)? */
export const signInHasRoom = (m) => (m.cookie ? m.cookie.t : m.vh) - CARD_MARGIN - m.signInH >= CARD_MARGIN;
/** One painted frame of the sign-in card { l, o }: is it SEEN somewhere it does not live? It lives in the right-hand
 *  column and the robot never drags it — so a visible frame in the left half is the card flashing before it is placed. */
export const isStrayFrame = (f, vw) => f.o > 0.05 && f.l < vw / 2;
export function coverProblems(m, { cookieAnswered = false } = {}) {
  const out = [];
  if (!m.cookie && !cookieAnswered) out.push('the cookie card is not on screen — it shows for EVERY signed-out visitor (owner 2026-09-13)');
  if (m.cookie && cookieAnswered) out.push('the cookie card is still on screen after the visitor answered it');
  if (!m.signIn && m.vw >= SIGNIN_CARD_FROM) {
    if (m.signInH == null) out.push(`the sign-in card is not on the page at ${m.vw} px — from ${SIGNIN_CARD_FROM} px it floats in the side (owner 2026-08-29)`);
    else if (signInHasRoom(m)) out.push(`the sign-in card is hidden at ${m.vw}×${m.vh} although there is room for it (${m.signInH} px tall, the space above ${m.cookie ? 'the cookie card' : 'the bottom edge'} ends at ${m.cookie ? m.cookie.t : m.vh})`);
  }
  for (const c of m.covered) out.push(`the ${c.card} sits on «${c.control}» (${c.px[0]}×${c.px[1]} px of it)`);
  if (m.signIn && m.cookie && overlap(m.signIn, m.cookie)) out.push('the sign-in card and the cookie card sit on each other');
  for (const [name, r] of [['sign-in card', m.signIn], ['cookie card', m.cookie]]) {
    if (r && (r.l < -1 || r.t < -1 || r.r > m.vw + 1 || r.b > m.vh + 1)) out.push(`the ${name} hangs off the screen`);
  }
  return out;
}
// One money line: { text, oneLine, splitNumbers, clippedBy, spills }. A screen: { lines: [...], unmarked: [text] }.
export function moneyProblems(s) {
  const out = [];
  if (!s.lines.length) out.push('no money line was found on the screen (a failure, never a skip)');
  for (const x of s.lines) {
    if (x.oneLine) out.push(`«${x.text}» is a one-line box (numberOfLines came back) — a narrow column cuts it`);
    if (x.splitNumbers) out.push(`«${x.text}» has a number broken over two lines`);
    if (x.clippedBy) out.push(`«${x.text}» is cut by ${x.clippedBy}`);
    if (x.spills) out.push(`«${x.text}» spills out of its line`);
  }
  for (const t of s.unmarked) out.push(`«${t}» is a price on a line that is not marked data-money (src/lib/moneyLine.ts) — the robot cannot watch it`);
  return out;
}
/** Lines that MUST be among the measured money lines (so "the table showed nothing long" can never read as a pass). */
export const missingLines = (s, mustShow) => mustShow.filter((t) => !s.lines.some((x) => x.text === t)).map((t) => `the line «${t}» is not on the screen`);
const mustCatch = (label, caught) => check(`MUTATION — ${label}`, caught);
const R = (l, t, r, b) => ({ l, t, r, b });
const clearScreen = { vw: 1366, vh: 768, signIn: R(1142, 132, 1350, 429), signInH: 297, cookie: R(0, 668, 1366, 768), covered: [] };
// A short, wide window in English: the cookie corner card is 348 tall, the sign-in card 350 — they cannot both fit.
const noRoom = { vw: 1536, vh: 730, signIn: null, signInH: 350, cookie: R(1236, 362, 1516, 710), covered: [] };
mustCatch('a card over the search button is rejected (the audit bug)',
  coverProblems({ ...clearScreen, covered: [{ card: 'cookie card', control: 'بحث', px: [34, 48] }] }).length > 0);
mustCatch('hiding the cookie card is not a fix', coverProblems({ ...clearScreen, cookie: null }).length > 0);
mustCatch('removing the sign-in card from a 1366 laptop is not a fix', coverProblems({ ...clearScreen, signIn: null, signInH: null }).length > 0);
mustCatch('hiding the sign-in card where there IS room for it is not a fix', coverProblems({ ...clearScreen, signIn: null }).length > 0);
mustCatch('a sign-in card painted solid at the top-left corner before it is placed is caught', isStrayFrame({ l: 0, o: 1 }, 1440));
check('…an invisible first frame, and the card in its own column, are not flagged', !isStrayFrame({ l: 0, o: 0 }, 1440) && !isStrayFrame({ l: 1216, o: 1 }, 1440));
mustCatch('a sign-in card that never comes back after the cookie card is answered is rejected',
  coverProblems({ ...noRoom, cookie: null }, { cookieAnswered: true }).length > 0);
mustCatch('a cookie card that stays up after it was answered is rejected',
  coverProblems({ ...noRoom, signIn: R(1312, 336, 1520, 686) }, { cookieAnswered: true }).length > 0);
check('…a sign-in card waiting off-screen is accepted ONLY where the two cards cannot both fit',
  coverProblems(noRoom).length === 0 && !signInHasRoom(noRoom) && signInHasRoom({ ...noRoom, vh: 900, cookie: R(1236, 532, 1516, 880) }));
mustCatch('the two cards on top of each other are rejected', coverProblems({ ...clearScreen, cookie: R(1066, 400, 1346, 748) }).length > 0);
mustCatch('a card hanging off the screen is rejected', coverProblems({ ...clearScreen, signIn: R(1200, 132, 1408, 429) }).length > 0);
check('…and a clear screen is accepted, with or without the sign-in card on a small laptop (not simply always-false)',
  coverProblems(clearScreen).length === 0 && coverProblems({ ...clearScreen, vw: 1024, vh: 640, signIn: null, signInH: null, cookie: R(0, 540, 1024, 640) }).length === 0);
const whole = { text: 'ر.س 3,450,000', oneLine: false, splitNumbers: 0, clippedBy: null, spills: false };
mustCatch('a one-line price box is rejected (the audit bug: numberOfLines on the price)', moneyProblems({ lines: [{ ...whole, oneLine: true }], unmarked: [] }).length > 0);
mustCatch('a price cut by its own row is rejected', moneyProblems({ lines: [{ ...whole, clippedBy: 'its own box' }], unmarked: [] }).length > 0);
mustCatch('a number broken over two lines is rejected', moneyProblems({ lines: [{ ...whole, splitNumbers: 1 }], unmarked: [] }).length > 0);
mustCatch('a price spilling over what is beside it is rejected', moneyProblems({ lines: [{ ...whole, spills: true }], unmarked: [] }).length > 0);
mustCatch('a price on an unmarked line is rejected', moneyProblems({ lines: [whole], unmarked: ['ر.س 2,700,000'] }).length > 0);
mustCatch('no money line at all is a failure, never a skip', moneyProblems({ lines: [], unmarked: [] }).length > 0);
check('…and a whole price is accepted (not simply always-false)', moneyProblems({ lines: [whole], unmarked: [] }).length === 0);
mustCatch('a past-sales table that does not show the long amount is not a pass', missingLines({ lines: [{ ...whole, text: '1,250,000' }] }, [LONG_AMOUNT]).length > 0);
check('…and a table that shows it is accepted', missingLines({ lines: [{ ...whole, text: LONG_AMOUNT }] }, [LONG_AMOUNT]).length === 0);

if (!existsSync(join(DIST, 'index.html'))) { console.error(`FAIL  ${DIST}index.html missing — build first: npx expo export --platform web`); process.exit(1); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PROBE_PATH = '__robot-pass-probe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
    if (rel === PROBE_PATH) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(req.headers['x-probe-pass'] === '1' ? 'pass-kept' : 'pass-lost'); }
    let file = join(DIST, rel || 'index.html');
    if (rel && existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
    else if (rel && !existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const launchOpts = { args: ['--no-sandbox', '--ignore-certificate-errors', '--disable-quic'] };
if (process.env.PW_CHROMIUM) launchOpts.executablePath = process.env.PW_CHROMIUM;
if (process.env.PW_PROXY) { launchOpts.args.push('--ssl-version-max=tls1.2'); launchOpts.proxy = { server: process.env.PW_PROXY, bypass: '127.0.0.1,localhost' }; }
const browser = await chromium.launch(launchOpts);
const done = async (code) => { await browser.close().catch(() => {}); server.close(); process.exit(code); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {}); };

// A fresh signed-out visitor. Third-party frames (Google's own sign-in prompt) are kept out: their geometry is Google's
// and has its own guards (src/lib/bottomPromptInset.ts); this robot measures OUR two cards.
async function visitor(width, height) {
  const ctx = await browser.newContext({ locale: 'ar-SA', ignoreHTTPSErrors: true, viewport: { width, height } });
  await ctx.addInitScript(() => { window.open = () => null; });
  // Every frame the sign-in card is painted in, from the very first one (kept short: only frames that differ).
  await ctx.addInitScript(() => {
    window.__cardFrames = [];
    let last = '';
    const tick = () => {
      const c = document.querySelector('[data-testid="signin-card"]');
      if (c && window.__cardFrames.length < 400) {
        const cs = getComputedStyle(c);
        const f = { l: Math.round(c.getBoundingClientRect().left), o: cs.visibility === 'hidden' ? 0 : +(+cs.opacity).toFixed(2) };
        const key = `${f.l}|${f.o}`;
        if (key !== last) { last = key; window.__cardFrames.push(f); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await ctx.route('**/*', keepOutFrames());
  return { ctx, page: await ctx.newPage() };
}
// The visitor's request filter: a third-party frame's requests are dropped, everything else is PASSED ON (fallback),
// never sent out (continue). Playwright runs the newest route first, and scripts/lib/robotPass.mjs has already put the
// robot pass on this context: a filter that continues sends the request out before the pass is added, and from CI's
// network every database call is then refused — the search shows no cards (CI run 42915775169, 2026-11-10).
function keepOutFrames(how = 'fallback') {
  return (route) => (route.request().frame().parentFrame() ? route.abort() : route[how]());
}
// Proven on every run, with a stand-in pass and this robot's own server (no secret needed): a header added by a route
// registered BEFORE the filter must still reach the server.
async function passSurvives(how) {
  const ctx = await browser.newContext();
  try {
    await ctx.route(`**/${PROBE_PATH}`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-probe-pass': '1' } }));
    await ctx.route('**/*', keepOutFrames(how));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${PROBE_PATH}`, { timeout: 20000 });
    return (await page.evaluate(() => document.body.innerText)).trim();
  } catch (e) { return `error: ${String(e?.message ?? e).split('\n')[0]}`; } finally { await ctx.close().catch(() => {}); }
}
{
  const kept = await passSurvives('fallback');
  check("the robot's own request filter keeps the robot pass that was put on the browser before it", kept === 'pass-kept', kept);
  const lost = await passSurvives('continue');
  mustCatch('a request filter that sends requests out itself (continue) loses the robot pass', lost === 'pass-lost');
}

// ── PART A: nothing covered ───────────────────────────────────────────────────────────────────────────────────────────
const measureCover = (cookieSel) => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const box = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const cards = [];
  for (const [name, sel] of [['sign-in card', '[data-testid="signin-card"]'], ['cookie card', cookieSel]]) {
    const el = document.querySelector(sel);
    if (el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden') cards.push({ name, el, rect: box(el) });
  }
  const label = (c) => (c.getAttribute('data-testid') || c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.getAttribute('title')
    || (c.textContent || '').trim().slice(0, 28) || c.closest('[data-testid]')?.getAttribute('data-testid')
    || `${c.tagName.toLowerCase()} at ${Math.round(c.getBoundingClientRect().left)},${Math.round(c.getBoundingClientRect().top)}`);
  const CONTROLS = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="combobox"], [role="radio"], [role="menuitem"], [tabindex="0"]';
  const covered = [];
  const seen = new Set();
  for (const c of document.querySelectorAll(CONTROLS)) {
    if (cards.some((k) => k.el.contains(c) || c.contains(k.el))) continue;
    const cs = getComputedStyle(c);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
    const b = c.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    for (const k of cards) {
      const ix = Math.min(b.right, k.rect.r) - Math.max(b.left, k.rect.l);
      const iy = Math.min(b.bottom, k.rect.b) - Math.max(b.top, k.rect.t);
      if (ix <= 2 || iy <= 2) continue;
      const cx = Math.max(b.left, k.rect.l) + ix / 2, cy = Math.max(b.top, k.rect.t) + iy / 2;
      if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) continue;
      // The browser's own hit-test: the control must really be painted at that point, UNDER the card.
      const stack = document.elementsFromPoint(cx, cy);
      const iCard = stack.findIndex((e) => k.el.contains(e));
      const iCtl = stack.findIndex((e) => e === c || c.contains(e));
      if (iCard === -1 || iCtl === -1 || iCard > iCtl) continue;
      const key = `${k.name}|${label(c)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      covered.push({ card: k.name, control: label(c), px: [Math.round(ix), Math.round(iy)] });
    }
  }
  const rect = (name) => cards.find((k) => k.name === name)?.rect ?? null;
  const signInNode = document.querySelector('[data-testid="signin-card"]');
  return { vw, vh, signIn: rect('sign-in card'), signInH: signInNode ? signInNode.offsetHeight : null, cookie: rect('cookie card'), covered };
};
const rectsNow = (page) => page.evaluate((cookieSel) => ['[data-testid="signin-card"]', cookieSel].map((sel) => { const e = document.querySelector(sel); if (!e) return 'none'; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round).join(','); }).join('|'), CONSENT_CARD);
// The cookie card rises with a short animation; measure only once both cards have stopped moving.
async function settle(page) {
  let last = '', same = 0;
  for (let i = 0; i < 24 && same < 2; i++) {
    await page.waitForTimeout(250);
    const now = await rectsNow(page);
    same = now === last ? same + 1 : 0;
    last = now;
  }
}
const fmt = (r) => (r ? `[${r.l},${r.t},${r.r},${r.b}]` : 'none');
async function coverAt(page, where, opts = {}) {
  await settle(page);
  const m = await page.evaluate(measureCover, CONSENT_CARD);
  const problems = coverProblems(m, opts);
  const signIn = m.signIn ? fmt(m.signIn) : m.signInH == null ? 'none' : `waiting (${m.signInH} px tall, no room)`;
  check(`nothing covered — ${where}: sign-in ${signIn} cookie ${fmt(m.cookie)}`, problems.length === 0, problems.join('\n        '));
  await shot(page, `cover-${where.replace(/[^a-z0-9]+/gi, '-')}`);
  return m;
}

if (ONLY !== 'money') {
  for (const [w, h] of SIZES) {
    const { ctx, page } = await visitor(w, h);
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-testid="city-input"]', { timeout: 30000 });
      await page.waitForSelector(CONSENT_CARD, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(600);
      await coverAt(page, `${w}x${h} Arabic`);
      const stray = (await page.evaluate(() => window.__cardFrames || [])).filter((f) => isStrayFrame(f, w));
      check(`the sign-in card is never seen before it is placed — ${w}x${h}`, stray.length === 0, `painted at left ${stray[0]?.l} px, opacity ${stray[0]?.o}`);
      // The language switch is not agreement to cookies (it carries data-consent-keep), so both cards stay up.
      const toggle = page.locator('[data-testid="sidebar-language-toggle"]:visible, [data-testid="topbar-language-toggle"]:visible').first();
      if (await toggle.count()) {
        await toggle.click({ timeout: 5000 });
        await page.waitForTimeout(900);
        await coverAt(page, `${w}x${h} English`);
      } else check(`the language switch is on screen at ${w}x${h}`, false);
    } catch (e) { check(`the Filter page opens at ${w}x${h}`, false, String(e?.message ?? e).split('\n')[0]); }
    await ctx.close().catch(() => {});
  }
  // A window too short for both cards: the sign-in card waits, the visitor answers the cookie card, the sign-in card
  // takes its place. (Without this step "hide the sign-in card for good" would pass on every short window.)
  for (const [w, h, lang] of WAITS) {
    const { ctx, page } = await visitor(w, h);
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('[data-testid="city-input"]', { timeout: 30000 });
      await page.waitForSelector(CONSENT_CARD, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (lang === 'English') {
        await page.locator('[data-testid="sidebar-language-toggle"]:visible, [data-testid="topbar-language-toggle"]:visible').first().click({ timeout: 5000 });
        await page.waitForTimeout(900);
      }
      const before = await coverAt(page, `${w}x${h} ${lang} short window`);
      check(`the robot's short window really is too short for both cards (${w}x${h} ${lang})`, !before.signIn && before.signInH != null && !signInHasRoom(before),
        `sign-in ${fmt(before.signIn)} height ${before.signInH} cookie ${fmt(before.cookie)}`);
      await dismissCookieConsent(page, { appearMs: 3000, log: () => {} });   // throws if the card will not go away
      await page.waitForTimeout(700);
      const after = await coverAt(page, `${w}x${h} ${lang} cookie card answered`, { cookieAnswered: true });
      check(`the waiting sign-in card takes the cookie card's place (${w}x${h} ${lang})`, !!after.signIn, `sign-in ${fmt(after.signIn)}`);
    } catch (e) { check(`the short-window journey runs at ${w}x${h} ${lang}`, false, String(e?.message ?? e).split('\n')[0]); }
    await ctx.close().catch(() => {});
  }
  // A wide window made narrow WITHOUT a reload: the cards must give way then too, not only on a fresh open.
  const { ctx, page } = await visitor(1920, 950);
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-testid="city-input"]', { timeout: 30000 });
    await page.waitForSelector(CONSENT_CARD, { timeout: 12000 }).catch(() => {});
    for (const [w, h] of [[1366, 700], [1100, 700], [1440, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(700);
      await coverAt(page, `${w}x${h} resized from 1920`);
    }
  } catch (e) { check('the Filter page opens at 1920x950 for the resize check', false, String(e?.message ?? e).split('\n')[0]); }
  await ctx.close().catch(() => {});
}

// ── PART B: no money line cut ─────────────────────────────────────────────────────────────────────────────────────────
const measureMoney = () => {
  const lines = [];
  const rectsOf = (range) => [...range.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5);
  for (const e of document.querySelectorAll('[data-money]')) {
    const text = (e.textContent || '').trim();
    if (!text) continue;
    const all = document.createRange();
    all.selectNodeContents(e);
    const rs = rectsOf(all);
    if (!rs.length) continue;                                   // not drawn (a hidden tab)
    const ink = { l: Math.min(...rs.map((q) => q.left)), t: Math.min(...rs.map((q) => q.top)), r: Math.max(...rs.map((q) => q.right)), b: Math.max(...rs.map((q) => q.bottom)) };
    const cs = getComputedStyle(e);
    const oneLine = cs.whiteSpace === 'nowrap' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
    let splitNumbers = 0;
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const re = /[0-9٠-٩][0-9٠-٩,.٫٬]*/g;
      for (let m = re.exec(n.nodeValue); m; m = re.exec(n.nodeValue)) {
        const g = document.createRange();
        g.setStart(n, m.index);
        g.setEnd(n, m.index + m[0].length);
        const tops = rectsOf(g).map((q) => q.top);
        if (tops.length && Math.max(...tops) - Math.min(...tops) > 4) splitNumbers++;
      }
    }
    // Walk up: a box that hides its overflow on an axis must hold the whole line on that axis. A box the visitor can
    // scroll ends the walk for that axis (a card further down the list is not "cut").
    let clippedBy = null, xOpen = true, yOpen = true;
    for (let a = e; a && a !== document.documentElement && (xOpen || yOpen) && !clippedBy; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === 'inline') continue;
      const b = a.getBoundingClientRect();
      const name = a === e ? 'its own box' : `a box around it (${a.getAttribute('data-testid') || a.tagName.toLowerCase()})`;
      if (xOpen) {
        if (/auto|scroll/.test(s.overflowX)) xOpen = false;
        else if (/hidden|clip/.test(s.overflowX) && (ink.l < b.left - 1 || ink.r > b.right + 1)) clippedBy = `${name}, sideways`;
      }
      if (yOpen && !clippedBy) {
        if (/auto|scroll/.test(s.overflowY)) yOpen = false;
        else if (/hidden|clip/.test(s.overflowY) && (ink.t < b.top - 1 || ink.b > b.bottom + 1)) clippedBy = `${name}, top or bottom`;
      }
    }
    const eb = e.getBoundingClientRect();
    const spills = cs.display !== 'inline' && (ink.l < eb.left - 1.5 || ink.r > eb.right + 1.5);
    lines.push({ text, oneLine: !!oneLine, splitNumbers, clippedBy, spills });
  }
  // A price drawn on a line nobody marked: the robot would never watch it.
  const unmarked = [];
  const PRICE = /^(?:ر\.س|SAR)\s?[0-9][0-9,]*(?:\s*\/\s*\S+)?$/;
  for (const e of document.querySelectorAll('body *')) {
    if (e.children.length || e.closest('[data-money]')) continue;
    const text = (e.textContent || '').trim();
    if (!PRICE.test(text) || !e.getClientRects().length) continue;
    unmarked.push(text);
  }
  return { lines, unmarked, cardPrices: document.querySelectorAll('[data-testid="card-price"]').length };
};
// Write the longest prices into the price lines (the text node itself, so React keeps its own node).
const writeWorst = ({ prices, monthly }) => {
  let i = 0;
  const put = (e, v) => { const tn = [...e.childNodes].find((n) => n.nodeType === 3); if (tn) tn.nodeValue = v; };
  for (const e of document.querySelectorAll('[data-testid="card-price"], [data-testid="listing-preview-price"]')) put(e, prices[i++ % prices.length]);
  for (const e of document.querySelectorAll('[data-testid="card-monthly-line"], [data-testid="listing-preview-monthly-line"]')) put(e, monthly);
};
async function moneyAt(page, where, { worst = false, needCards = true, mustShow = [] } = {}) {
  await page.waitForTimeout(900);
  if (worst) { await page.evaluate(writeWorst, { prices: WORST_PRICES, monthly: WORST_MONTHLY }); await page.waitForTimeout(300); }
  const s = await page.evaluate(measureMoney);
  const problems = [...new Set([...moneyProblems(s), ...missingLines(s, mustShow)])];
  if (needCards && !s.cardPrices) problems.push('no card price is on the screen');
  check(`no money line cut — ${where}${worst ? ', longest prices written in' : ''}: ${s.lines.length} lines`, problems.length === 0, problems.slice(0, 12).join('\n        '));
  await shot(page, `money-${where.replace(/[^a-z0-9]+/gi, '-')}${worst ? '-worst' : ''}`);
}
// The three reads behind the Ministry's past-sales table, answered by the robot so the table is on every run:
//   • the opened ad's own index row is answered as an ad the «الأسعار» block is drawn for (src/data/adPageData.ts
//     pricesBlockEligible), under the ad's own table and id. Answered, not re-fetched: a re-fetch from inside a route
//     skips every other route on the browser, the robot pass included,
//   • the district's ministry summary and its deals are the robot's rows above, with the longest amounts.
// Must be set BEFORE the first ad is opened: the ad page reads each of these once and remembers the answer.
// What the ministry step saw, printed when the table does not open (so a red run says WHY, not only that).
const ministryLog = [];
async function answerMinistryReads(ctx) {
  const table = (name) => (url) => url.pathname.endsWith(`/rest/v1/${name}`);
  ctx.on('page', (pg) => pg.on('pageerror', (e) => ministryLog.push(`page error: ${String(e.message || e).slice(0, 160)}`)));
  ctx.on('requestfailed', (r) => { if (/\/rest\/v1\//.test(r.url())) ministryLog.push(`failed: ${r.url().split('/rest/v1/')[1]?.slice(0, 90)} — ${r.failure()?.errorText}`); });
  const answer = (route, rows) => (ministryLog.push(`answered ${new URL(route.request().url()).pathname.split('/rest/v1/')[1]} (${rows.length} row(s))`), route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': route.request().headers().origin || '*' }, body: JSON.stringify(rows) }));
  await ctx.route(table('moj_district_sales'), (route) => answer(route, [MOJ_SUMMARY]));
  await ctx.route(table('moj_district_deals'), (route) => answer(route, MOJ_DEALS));
  await ctx.route(table('search_listings_ar'), async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const eq = (k) => (q.get(k) || '').replace(/^eq\./, '');
    if (route.request().method() !== 'GET') return route.fallback();
    // The ad page's neighbourhood reads for the robot's made-up district (the asking-price stats page through every
    // sale listing in الملقا; the similar-listings read): answered empty. Read for real they paged thousands of rows of
    // production on every run, and through CI's front door took longer than the 20 s the table is given (PR #11723's
    // first CI run: the table never opened at any size). The ministry half — the table — needs none of them.
    if (eq('district_ar') === 'الملقا' && eq('deal_ar') === 'بيع' && !eq('listing_id')) return answer(route, []);
    if (!(q.get('select') || '').includes('latitude') || !eq('listing_id') || !eq('source_table')) return route.fallback();
    return answer(route, [{ latitude: null, longitude: null, type_ar: 'فيلا', deal_ar: 'بيع', city_ar: 'الرياض', district_ar: 'الملقا', price_total: 2183845500,
      area_m2: 612.5, license_number: null, platform: 'aqar', source_table: eq('source_table'), listing_id: Number(eq('listing_id')), bedrooms: null }]);
  });
}
// Open the past-sales table inside the open ad. Crossing the side-by-side width re-mounts the ad page, which closes the
// table — so every size asks again, and re-opens an ad first if none is up.
// Only some sites open as Ezhalah's own ad page in the viewer (src/lib/inAppViewer.ts IN_APP_PREVIEW_HOSTS); the rest
// show the site itself, with no ministry table. The results rotate, so the FIRST card is a different site every run:
// PR #11751's CI clicked twelve cards of framed sites and never saw an ad page («reads seen: none»). Read the list from
// the app's own source and click a card whose site label is on it.
const PREVIEW_HOSTS_EXACT = (() => {
  const m = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'inAppViewer.ts'), 'utf8').match(/IN_APP_PREVIEW_HOSTS = \[([\s\S]*?)\]/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();
export const PREVIEW_HOSTS = PREVIEW_HOSTS_EXACT.map((h) => h.replace(/^sa\./, ''));
// A card's own link, learned from the rows the app downloads to build the cards (id + listing_url, src/data/remote.ts
// LIST_SELECT) — the card's painted site label is not always there (PR #11754's CI: «no result card from a site that
// opens as Ezhalah's own ad page» while the live site shows nofodh.sa / sa.sakan.co in the top four).
const cardLink = new Map();
function learnCardLinks(page) {
  page.on('response', async (res) => {
    if (!/\/rest\/v1\//.test(res.url()) || res.request().method() !== 'GET') return;
    try {
      const rows = await res.json();
      if (Array.isArray(rows)) for (const r of rows) if (r && r.id != null && typeof r.listing_url === 'string') cardLink.set(String(r.id), r.listing_url);
    } catch { /* not JSON, or the body is gone: nothing learned */ }
  });
}
const opensOwnPage = (url) => { try { return PREVIEW_HOSTS_EXACT.includes(new URL(url).hostname.toLowerCase().replace(/^www\./, '')); } catch { return false; } };
check("the robot knows which sites open as Ezhalah's own ad page (read from src/lib/inAppViewer.ts)", PREVIEW_HOSTS.includes('aqar.fm') && PREVIEW_HOSTS.length >= 10, `read ${PREVIEW_HOSTS.length}`);
async function openDealsSheet(page) {
  const up = (sel) => page.locator(sel).first().isVisible().catch(() => false);
  if (await up(DEALS_SHEET)) return true;
  if (!(await up('[data-testid="listing-preview"]'))) {
    let tried = 0;
    for (const card of (await page.$$('[data-testid^="card-listing-"]')).slice(0, 60)) {
      const id = ((await card.getAttribute('data-testid').catch(() => '')) || '').replace('card-listing-', '');
      const link = cardLink.get(id);
      const label = (await card.innerText().catch(() => '')).toLowerCase();
      if (!(link ? opensOwnPage(link) : PREVIEW_HOSTS.some((h) => label.includes(h)))) continue;
      const gold = await card.$('[data-testid="card-open-gold"]');
      if (!gold) continue;
      tried++;
      await gold.scrollIntoViewIfNeeded().catch(() => {});
      await gold.click({ timeout: 4000 }).catch(() => {});
      if (await page.waitForSelector('[data-testid="listing-preview"]', { state: 'visible', timeout: 3000 }).catch(() => null)) break;
      if (tried >= 6) break;
    }
    if (!tried) ministryLog.push(`no result card from a site that opens as Ezhalah's own ad page (marked card: ${ownPageCard ?? 'none'}) (links known for ${cardLink.size} card(s): ${[...new Set([...cardLink.values()].map((u) => { try { return new URL(u).hostname; } catch { return '?'; } }))].slice(0, 10).join(', ')})`);
  }
  const button = page.locator('[data-testid="listing-preview-moj-deals"]').first();
  if (!(await button.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false))) return false;
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click({ timeout: 5000 }).catch(() => {});
  return !!(await page.waitForSelector(DEALS_SHEET, { state: 'visible', timeout: 6000 }).catch(() => null));
}
// One real search, the way a visitor does it: type the city, pick it, press «بحث».
// ONE CARD THAT OPENS AS EZHALAH'S OWN AD PAGE, EVERY RUN. Which sites the first result cards come from rotates, so a
// robot that waits for one by chance is flaky (PRs #11751/#11753/#11754, 2026-11-11: «no result card from a site that
// opens as Ezhalah's own ad page» on some CI runs, a pass on others). The first row of the first card read keeps its
// real data and only its link is pointed at sa.aqar.fm — an IN_APP_PREVIEW_HOSTS site — the same kind of stand-in as
// the ad row relabelled above. The read itself is sent with the robot pass (route.fetch skips the pass's own route).
let ownPageCard = null;
async function markOneOwnPageCard(ctx) {
  await ctx.route((url) => /\/rest\/v1\/[a-z0-9_]+_listings$/.test(url.pathname), async (route) => {
    const req = route.request();
    const sel = new URL(req.url()).searchParams.get('select') || '';
    if (ownPageCard || req.method() !== 'GET' || !sel.startsWith('id,ad_number,listing_url')) return route.fallback();
    try {
      const secret = process.env.EZ_GATE_SECRET || '';
      const headers = robotPassHeaders(req.url(), req.headers(), secret) ?? { ...req.headers(), ...(gateHeaders(req.url(), secret) || {}) };
      const response = await route.fetch({ headers });
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length && rows[0]?.id != null) {
        ownPageCard = String(rows[0].id);
        rows[0] = { ...rows[0], listing_url: `https://sa.aqar.fm/robot-own-page-${rows[0].id}` };
      }
      await route.fulfill({ response, json: rows });
    } catch { await route.fallback().catch(() => {}); }
  });
}
async function searchRiyadh() {
  const { ctx, page } = await visitor(1366, 700);
  learnCardLinks(page);
  await markOneOwnPageCard(ctx);
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-testid="city-input"]', { timeout: 30000 });
    await dismissCookieConsent(page, { log: () => {} });
    await page.locator('[data-testid="auth-popup-close"]').first().click({ timeout: 1500 }).catch(() => {});
    for (let i = 0; i < 3; i++) {
      await page.click('[data-testid="city-input"]');
      await page.fill('[data-testid="city-input"]', '');
      await page.type('[data-testid="city-input"]', 'الرياض', { delay: 60 });
      await page.waitForTimeout(1500);
      await page.getByText('الرياض', { exact: true }).last().click({ timeout: 5000 }).catch(() => {});
      if (await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 4000 }).catch(() => null)) break;
    }
    await page.getByText('بحث', { exact: true }).first().click({ timeout: 8000 });
    await page.waitForSelector('[data-testid^="card-listing-"]', { timeout: 60000 });
    await page.waitForTimeout(4000);
    return { ctx, page };
  } catch (e) {
    console.log(`      search attempt failed: ${String(e?.message ?? e).split('\n')[0]}`);
    await ctx.close().catch(() => {});
    return null;
  }
}

if (ONLY !== 'cover') {
  let s = null;
  for (let attempt = 1; attempt <= ATTEMPTS && !s; attempt++) s = await searchRiyadh();
  check(`a real search (الرياض) shows result cards (${ATTEMPTS} attempts)`, !!s);
  if (s) {
    const { ctx, page } = s;
    try {
      await answerMinistryReads(ctx);   // before any ad is opened
      // Roomy cards: nothing open beside the results.
      await moneyAt(page, 'cards 1366x700');
      for (const [w, h] of [[1920, 950], [1024, 640]]) { await page.setViewportSize({ width: w, height: h }); await moneyAt(page, `cards ${w}x${h}`); }
      await moneyAt(page, 'cards 1024x640', { worst: true });
      // An ad open beside the results: the narrow cards, where the price was cut.
      await page.setViewportSize({ width: 1366, height: 700 });
      await page.waitForTimeout(900);
      let beside = false;
      for (const gold of (await page.$$('[data-testid="card-open-gold"]')).slice(0, 12)) {
        await gold.scrollIntoViewIfNeeded().catch(() => {});
        await gold.click({ timeout: 4000 }).catch(() => {});
        if (await page.waitForSelector('[data-testid="ad-viewer"]', { timeout: 2500 }).catch(() => null)) { beside = true; break; }
      }
      check('an ad opens beside the results on a laptop', beside);
      if (beside) {
        for (const [w, h] of [[1024, 640], [1100, 700], [1280, 720], [1366, 700]]) { await page.setViewportSize({ width: w, height: h }); await moneyAt(page, `ad beside ${w}x${h}`); }
        for (const [w, h] of [[1024, 640], [1280, 720]]) { await page.setViewportSize({ width: w, height: h }); await moneyAt(page, `ad beside ${w}x${h}`, { worst: true }); }
        // The Ministry's past-sales table inside the ad: five columns, the longest amounts, laptop and phone widths.
        for (const [w, h] of [[1366, 700], [1024, 640], [390, 844], [320, 640]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(700);
          const open = await openDealsSheet(page);
          check(`the Ministry's past-sales table opens inside the ad — ${w}x${h}`, open, open ? '' : `reads seen: ${ministryLog.slice(-8).join(' | ') || 'none'}`);
          if (open) await moneyAt(page, `past-sales table ${w}x${h}`, { needCards: false, mustShow: [LONG_AMOUNT] });
        }
        await page.locator('[data-testid="listing-preview-moj-deals-close"]:visible').first().click({ timeout: 3000 }).catch(() => {});
        await page.setViewportSize({ width: 1366, height: 700 });
        await page.waitForTimeout(700);
        await page.locator('[data-testid="ad-viewer-hide"]:visible, [data-testid="ad-viewer-close"]:visible').first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      // A phone width (the same page made narrow): the phone card.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await page.locator('[data-testid="ad-viewer-close"]:visible, [data-testid="ad-viewer-hide"]:visible').first().click({ timeout: 1500 }).catch(() => {});
      await moneyAt(page, 'cards 390x844');
      await moneyAt(page, 'cards 390x844', { worst: true });
    } catch (e) { check('the money check ran to the end', false, String(e?.message ?? e).split('\n')[0]); }
    await ctx.close().catch(() => {});
  }
}

if (failed) { console.error(`\n❌ verify-web-laptop-nothing-cut-or-covered: ${failed} check(s) failed — something on a laptop screen is cut or covered.`); await done(1); }
console.log('\nverify-web-laptop-nothing-cut-or-covered: no card covers a control, no money line is cut');
await done(0);
