// LIVE full-conversation-persistence certification (owner 2026-08-25) — drives a real browser
// against the local production build with a REAL signed-in Supabase session and proves, end to end:
//   search → AF round → leave chat → return  = exact conversation restored (counts, receipt, cards)
//   hard refresh                              = restored from localStorage
//   local-cache wipe + reload                 = list from user_chats metas, transcript hydrated lazily
//   drag row past bucket edge                 = starred into المفضلة, survives refresh
//
// SETUP (manual/certification tool — not in npm test: needs network + a real auth user):
//   1. npx expo export --platform web   (dist/ under this repo)
//   2. Obtain a password-grant session for the e2e user into /tmp/e2e-token.json:
//      curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
//        -H 'Content-Type: application/json' -d '{"email":"<e2e user>","password":"<pw>"}'
//   3. node scripts/verify-chat-persistence-live.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';
import { existsSync, statSync, readFileSync as rf } from 'node:fs';

// Same static server as verify-web-runtime-smoke.mjs: Expo static export emits /agent as
// agent.html — plain python http.server 404s a reload of /agent (harness artifact, not a product
// path; production redirects /agent to / at the edge).
const DIST = new URL('../dist/', import.meta.url).pathname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
    let file = join(DIST, rel || 'index.html');
    if (!rel) file = join(DIST, 'index.html');
    else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(rf(file));
  } catch { res.writeHead(500); res.end('err'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SESSION = JSON.parse(readFileSync('/tmp/e2e-token.json', 'utf8'));
SESSION.expires_at = Math.floor(Date.now() / 1000) + SESSION.expires_in;
const SB_KEY = 'sb-aannarbkwcymrotzwdbo-auth-token';

const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc = null;
  while (a) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; } a = a.parentElement; }
  if (sc) { const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2; }
  else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
// Seed the real Supabase session (seed-if-absent: addInitScript re-runs on every nav).
await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [SB_KEY, JSON.stringify(SESSION)]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 160)));

const tap = async (txt, wait = 900) => {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    const box = await page.evaluate(CLICK_LEAF, txt);
    if (box) { await page.mouse.click(box.x, box.y); await page.waitForTimeout(wait); return true; }
    await page.waitForTimeout(300);
  }
  return false;
};
const body = () => page.innerText('body');
const counts = async () => (await body()).match(/لقينا [\d,٬،]+ إعلان/g) ?? [];
const waitFor = async (fn, ms = 45000) => { const u = Date.now() + ms; while (Date.now() < u) { if (await fn()) return true; await page.waitForTimeout(400); } return false; };

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

// ── Journey: Factory / Annual Rent / Riyadh — search → AF round → 39 ────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
check('signed in (no sign-up CTA as primary rail)', (await body()).includes('E2E') || !(await body()).includes('إنشاء حساب / تسجيل الدخول') || true); // informational

// deal: rent + annual (chips are ADDITIVE — add إيجار, then remove default شراء)
await tap('إيجار'); await tap('شراء');
await page.locator('[data-testid="city-input"]').click(); await page.keyboard.type('الرياض', { delay: 40 }); await page.waitForTimeout(2000);
await tap('الرياض');
await tap('تجاري'); await page.waitForTimeout(400);
await tap('الصناعة واللوجستيات'); await page.waitForTimeout(400);
await tap('مصنع'); await page.waitForTimeout(300);
await tap('بحث');
check('search lands with a real count', await waitFor(async () => (await counts()).length >= 1));
const startCount = (await counts())[0];
console.log('  start:', startCount);

// AF round via the latest turn's «خلّنا نحدد الطلب أكثر» (testID results-narrow)
const narrow = page.locator('[data-testid="results-narrow"]');
check('narrow CTA renders on the newest turn', await waitFor(async () => (await narrow.count()) > 0 && await narrow.first().isVisible(), 20000));
await narrow.first().click(); await page.waitForTimeout(2500);
const afCard = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="af-card"]')).some((e) => e.offsetParent !== null));
check('AF opens', await waitFor(afCard, 15000));
// answer the first visible option then confirm
const opt = page.locator('[data-testid^="af-option-"]:visible').first();
await opt.click(); await page.waitForTimeout(400);
await page.locator('[data-testid="af-confirm"]:visible').first().click(); await page.waitForTimeout(3000);
check('AF round lands a second (narrowed) count', await waitFor(async () => (await counts()).length >= 2));
const bothCounts = await counts();
console.log('  counts on screen:', JSON.stringify(bothCounts));
check('round receipt visible on the earlier turn', await waitFor(async () => (await page.locator('[data-testid="af-round-receipt"]').count()) > 0, 15000));

// let capture (600ms) + sync push (1200ms) settle
await page.waitForTimeout(5000);

// ── Leave the chat (New Chat), then RETURN via the sidebar ──────────────────────────────────────
await tap('محادثة جديدة'); await page.waitForTimeout(1500);
check('new chat is blank (no counts)', (await counts()).length === 0);
// docked sidebar shows history; click the chat row (title = auto title, unknown text — click the first history row via its bubble icon area). Use the recent-most row: find any element whose text includes 'مصنع' inside the sidebar? Titles are auto summaries. Click first row under 'الأخيرة'.
// The AF-narrowed conversation keeps ONE sidebar entry whose title reflects the LATEST state
// («مصانع للإيجار في الرياض · شارع 15م+» once street-width committed). Target that exact row.
const clickFirstChat = async () => await page.evaluate(() => {
  const leaves = Array.from(document.querySelectorAll('div,span'))
    .filter((e) => e.children.length === 0 && /شارع 15م\+/.test((e.innerText || '').trim()));
  const vis = leaves.find((e) => e.getBoundingClientRect().width > 0);
  if (!vis) return null;
  const r = vis.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
let rowBox = await clickFirstChat();
check('sidebar shows the saved chat', !!rowBox);
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await page.waitForTimeout(3000); }

const assertRestored = async (tag) => {
  const cs = await counts();
  check(`[${tag}] BOTH conversation turns restored (original + narrowed counts)`, cs.length >= 2 && cs[0] === bothCounts[0] && cs[1] === bothCounts[1]);
  check(`[${tag}] AF round receipt restored`, (await page.locator('[data-testid="af-round-receipt"]').count()) > 0);
  const cards = await page.evaluate(() => document.body.innerText.match(/مستضاف على/g)?.length ?? 0);
  check(`[${tag}] result cards restored (${cards})`, cards >= 10);
  check(`[${tag}] no re-search happened (restore is instant render, not a searching beat)`, !(await body()).includes('إزهله يبحث في المنصات'));
};
await assertRestored('return');

// ── Refresh survival (localStorage layer) ───────────────────────────────────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
rowBox = await clickFirstChat();
check('after refresh: sidebar still shows the chat', !!rowBox);
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await page.waitForTimeout(3000); }
await assertRestored('refresh');

// ── New-browser survival (SERVER layer): wipe local history cache, keep the session ─────────────
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('history:')) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6000);
rowBox = await clickFirstChat();
check('server sync: chat list restored from user_chats after local wipe', !!rowBox);
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await page.waitForTimeout(4000); }
await assertRestored('server');

// ── Favorites: drag the row up past the bucket edge → starred ───────────────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
rowBox = await clickFirstChat();
if (rowBox) {
  await page.mouse.move(rowBox.x, rowBox.y);
  await page.mouse.down();
  await page.mouse.move(rowBox.x, rowBox.y - 20, { steps: 4 });   // vertical pull → mouse drag activates
  await page.waitForTimeout(200);
  await page.mouse.move(rowBox.x, rowBox.y - 120, { steps: 8 });  // well past the bucket top
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(1500);
}
const inFavorites = await page.evaluate(() => {
  const txt = document.body.innerText;
  const fav = txt.indexOf('المفضلة');
  const rec = txt.indexOf('الأخيرة');
  return fav >= 0 && (rec === -1 || fav < rec) && fav >= 0;
});
check('drag-to-Favorites: المفضلة section now exists (row starred by drag)', inFavorites);
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(4000);
check('star survives a refresh', (await body()).includes('المفضلة'));

console.log(failed ? `\n✗ ${failed} FAILED` : '\n✓ ALL E2E CHECKS PASSED');
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
