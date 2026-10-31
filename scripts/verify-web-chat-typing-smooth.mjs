// THE TYPING ROBOT — types in a big SAVED chat, as a signed-in person, and fails the build if it lags or glitches.
//
// Owner 2026-10-25: «when I type, logged in, in a saved chat, sometimes it takes time and shows a glitch — let's build a
// check for that, on the side». What was wrong, measured (production build, Chromium 1440×900, a saved 500-card chat):
// the composer's text lives in the chat screen, so every key press re-rendered the WHOLE screen — ~1,500 wrapper
// components for the cards and the 500-card read-aloud script rebuilt each time. Best of 4, page CPU while typing 49
// keys: 2.9 s in the big chat against 0.37 s in an empty one (8×), the page's own code 1,313 ms against 130 ms (10×) —
// and far worse whenever the laptop was busy, which is exactly «sometimes». Fixed by ResultCardRow (a memoized card
// row), a remembered read-aloud script and a feedback row that does not recompute it: the page's own code fell to
// 170–410 ms (1.3–2.9× the empty chat).
//
// Only a signed-in person has saved chats, and no robot can sign in for real (Google / Apple only) — so this robot gets a
// fake signed-in session (scripts/lib/fakeSignedInSession.mjs: no real account, no real chat, a fake in-memory
// `user_chats` table), makes a REAL big chat the normal way (a real Riyadh search + two taps of «عرض المزيد» = 500
// cards, which the app itself saves and syncs), reloads, opens it from the sidebar like a user, and types.
//
// What it checks:
//   · the saved chat REOPENS whole (all its cards back, none blank) — a saved chat that comes back thin is the glitch;
//   · the reopened page KNOWS ITS OWN HEIGHT: cards the browser has not drawn yet are placeholders, and a placeholder far
//     from a card's real size makes the page believe a 500-card chat is a third of its height and JUMP as you scroll up
//     (found 2026-10-25: 140 px placeholders for ~400 px laptop cards). Judged by scrolling up through the whole chat and
//     comparing the page's height before and after — deterministic, it does not depend on how fast the machine is;
//   · TYPING COST, relative: the page's own code time (ScriptDuration) for typing the same sentence in the big chat vs
//     an empty new chat in the same session, best of N (the minimum rejects a busy machine; the ratio cancels a slow
//     runner). Judged on SCRIPT time because total CPU swings 4× with machine load while script time stays honest;
//   · NOTHING DROPPED OR REORDERED: the box holds exactly what was typed;
//   · NO LAYOUT JUMP while typing.
// It reports (does not judge) how long the reopen froze the page — that number swings with machine load.
//
// Run:  node scripts/verify-web-chat-typing-smooth.mjs         (after `npx expo export --platform web`)
//       TYPING_ROBOT_DIST=/path/to/dist node scripts/verify-web-chat-typing-smooth.mjs   (any build — also how it is proven)
// Needs production data for ONE search + two taps of «عرض المزيد» (no extra network: the rows are already buffered).
// Kept out of `npm test` (a real browser, live data): it runs in .github/workflows/web-runtime-smoke.yml on every PR.
import './lib/robotPass.mjs'; // robot pass for our own browser robots (docs/ops/SCRAPE_GUARD.md)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { installFakeSignedIn, fakeHistoryKey } from './lib/fakeSignedInSession.mjs';

const DIST = process.env.TYPING_ROBOT_DIST || new URL('../dist/', import.meta.url).pathname;
const TEXT = 'ابغى شقة في حي الملقا قريبة من المدارس وفيها مصعد'; // 49 keys
const REPS = 4;                  // best of N, in the big chat and in the empty one
const MAX_SCRIPT_RATIO = 4.0;    // big chat's page-code time ≤ this × the empty chat's (before the fix 6–10×; after 1.3–2.9×)
const SCRIPT_FLOOR_MS = 60;      // an empty chat this cheap is noise — never divide by less
const MAX_LAYOUT_SHIFT = 0.05;   // summed layout-shift score while typing (a visible jump is ≥ 0.1)
const MIN_REOPENED_CARDS = 400;  // a 500-card chat must come back with nearly all of them
const MAX_HEIGHT_ERROR = 0.15;   // the reopened page's height may differ ≤ 15 % from its true height (before: ~65 % too short)

let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`); };

// ── the verdicts, pure — so the robot can PROVE it would fail before it opens a browser ───────────
const typingOk = (heavyScriptMs, floorScriptMs) => heavyScriptMs <= MAX_SCRIPT_RATIO * Math.max(SCRIPT_FLOOR_MS, floorScriptMs);
const textIntact = (typed, inBox) => inBox === typed;
const shiftsOk = (sum) => sum <= MAX_LAYOUT_SHIFT;
const reopenedWhole = (cards, blank) => cards >= MIN_REOPENED_CARDS && blank === 0;
const heightHonest = (before, after) => after > 0 && Math.abs(after - before) / after <= MAX_HEIGHT_ERROR;
// SELF-PROOF. A robot nobody has watched fail is a comment that runs. These are the numbers the code of 2026-10-25
// morning produced (production build, best of 4, saved 500-card chat vs an empty chat): each predicate must reject them.
const mustCatch = (label, caught) => check(`MUTATION — ${label}`, caught);
mustCatch('typing 49 keys in the big chat costing 1,313 ms of page code against 130 ms in an empty chat (10×) is rejected', !typingOk(1313, 130));
mustCatch('…and 843 ms against 134 ms (6.3×) is rejected', !typingOk(843, 134));
mustCatch('a character dropped while typing (the box holds less than what was typed) is rejected', !textIntact(TEXT, TEXT.slice(0, 20) + TEXT.slice(21)));
mustCatch('characters reordered while typing is rejected', !textIntact(TEXT, TEXT.slice(1) + TEXT[0]));
mustCatch('a layout jump of 0.3 while typing is rejected', !shiftsOk(0.3));
mustCatch('a reopened chat that came back with 60 of its 500 cards is rejected', !reopenedWhole(60, 0));
mustCatch('a reopened chat with a blank card is rejected', !reopenedWhole(500, 1));
mustCatch('a reopened page that believed it was 23,000 px tall and turned out to be 70,000 px (140 px placeholders for ~400 px cards) is rejected', !heightHonest(23400, 70500));
check('…and a page whose estimate was within a few percent of the truth is accepted (400 px placeholders, 396–418 px cards)', heightHonest(67000, 69500));
check('…and the fixed code\'s numbers are accepted (174 and 409 ms against 130 and 139 ms; a full, intact chat; no jump)',
  typingOk(174, 130) && typingOk(409, 139) && textIntact(TEXT, TEXT) && shiftsOk(0.013) && reopenedWhole(500, 0));
check('…and a slow runner is accepted when BOTH chats slow down together (the ratio is what is judged)', typingOk(900, 260) && typingOk(60, 20));

if (!existsSync(join(DIST, 'index.html'))) { console.error(`FAIL  ${DIST}index.html missing — build first: npx expo export --platform web`); process.exit(1); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
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
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport: { width: 1440, height: 900 } }); // a laptop
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const done = async (code) => { await browser.close().catch(() => {}); server.close(); process.exit(code); };
const { log } = await installFakeSignedIn(ctx, page);
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const consent = page.getByText('الضروري فقط', { exact: true });
const dismissConsent = async () => { if (await consent.isVisible().catch(() => false)) await consent.click(); };
const gridCount = () => page.evaluate(() => { const g = document.querySelectorAll('[data-testid="result-card-grid"]'); return g.length ? g[g.length - 1].children.length : 0; });
const waitCards = (n, ms) => page.waitForFunction((min) => { const g = document.querySelectorAll('[data-testid="result-card-grid"]'); return g.length > 0 && g[g.length - 1].children.length >= min; }, n, { timeout: ms });

// ── make a REAL big saved chat, as a signed-in person ───────────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000); await dismissConsent();
const signedIn = await page.evaluate(() => /robot@example\.test|روبوت/.test(document.body.innerText));
check('the robot is signed in (the fake session was accepted — otherwise there are no saved chats to test)', signedIn);
const input = page.getByTestId('city-input');
await input.click(); await input.fill('الرياض'); await page.waitForTimeout(3000);
const suggestions = page.getByText('الرياض', { exact: true });
await suggestions.nth((await suggestions.count()) - 1).click(); await page.waitForTimeout(800);
await page.getByTestId('home-search-button').click();
try { await waitCards(6, 120000); } catch { check('the Riyadh search landed with cards', false, 'fewer than 6 cards after 120 s'); await done(1); }
await page.waitForTimeout(3000);
for (let tap = 0; tap < 2; tap++) {
  const more = page.getByTestId('results-load-more').last();
  for (let k = 0, prev = -1; k < 25; k++) { // the page grows as it scrolls; follow the button until it stops moving
    if (!(await more.isVisible().catch(() => false))) break;
    await more.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
    const c = await gridCount(); if (c === prev) break; prev = c;
  }
  if (!(await more.isVisible().catch(() => false))) break;
  await more.click(); await page.waitForTimeout(6000);
}
const built = await gridCount();
check('«عرض المزيد» built a big chat (the case that was worst)', built >= MIN_REOPENED_CARDS, `${built} cards`);
await page.waitForTimeout(4000); // the app saves a moment after the chat settles
const saved = await page.evaluate((k) => { const raw = localStorage.getItem(k); const arr = raw ? JSON.parse(raw) : []; const it = arr[0]; return it ? { title: String(it.title || ''), bytes: it.transcript ? JSON.stringify(it.transcript).length : 0 } : null; }, fakeHistoryKey());
check('the app saved the chat on this device (a transcript, with its cards)', !!saved && saved.title.length > 0 && saved.bytes > 200000, JSON.stringify(saved));
if (!saved || !saved.title) await done(1);

// ── a new visit: reload, open the saved chat from the sidebar ───────────────────────────────────
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000); await dismissConsent();
await page.evaluate(() => {
  window.__open = { shifts: 0, long: [] };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__open.shifts += e.value; })).observe({ type: 'layout-shift' });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__open.long.push(Math.round(e.duration)))).observe({ type: 'longtask' });
});
const tOpen = Date.now();
await page.getByText(saved.title, { exact: true }).first().click();
let reopened = 0;
try { await waitCards(MIN_REOPENED_CARDS, 60000); reopened = await gridCount(); } catch { reopened = await gridCount(); }
const openMs = Date.now() - tOpen;
await page.waitForTimeout(3500);
const open = await page.evaluate(() => {
  const g = [...document.querySelectorAll('[data-testid="result-card-grid"]')].pop();
  const blank = g ? [...g.children].filter((c) => !(c.textContent || '').trim()).length : -1; // textContent: a card the browser is not drawing yet still holds its text
  return { blank, shifts: +window.__open.shifts.toFixed(3), long: window.__open.long };
});
check(`the saved chat reopens whole: ${reopened} of ${built} cards back, none blank`, reopenedWhole(reopened, open.blank), `${reopened} cards, ${open.blank} blank`);
const SCROLLER = `(() => [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 500 && /(auto|scroll)/.test(getComputedStyle(d).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0])()`;
const heightBefore = await page.evaluate(`${SCROLLER}.scrollHeight`);
const walk = await page.evaluate(async (sel) => { // scroll up through the whole chat, a screen at a time, so every card is drawn once
  const s = eval(sel); let shifts = 0;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) shifts += e.value; })).observe({ type: 'layout-shift' });
  for (let y = s.scrollTop; y > 0; y -= Math.max(300, s.clientHeight * 0.9)) { s.scrollTop = y; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  s.scrollTop = 0; await new Promise((r) => setTimeout(r, 600));
  return { after: s.scrollHeight, shifts: +shifts.toFixed(3) };
}, SCROLLER);
check(`the reopened page knew its height: ${heightBefore} px at first, ${walk.after} px once every card was drawn (${(Math.abs(walk.after - heightBefore) / walk.after * 100).toFixed(0)} % off, limit ${MAX_HEIGHT_ERROR * 100} %)`, heightHonest(heightBefore, walk.after), `${heightBefore} → ${walk.after}`);
console.log(`      scrolling up through the reopened chat: layout shift ${walk.shifts} (reported)`);
console.log(`      reopen (reported, not judged — it swings with machine load): cards ready after ${openMs} ms · page froze ${open.long.length}× (worst ${Math.max(0, ...open.long)} ms) · layout shift ${open.shifts}`);

// ── typing: the big chat, then an empty one ─────────────────────────────────────────────────────
async function typeOnce(box) {
  await box.click();
  await page.evaluate(() => { window.__shift = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__shift += e.value; })).observe({ type: 'layout-shift' }); });
  const m0 = await metrics();
  await page.keyboard.type(TEXT, { delay: 30 }); await page.waitForTimeout(400);
  const m1 = await metrics();
  const inBox = await box.inputValue();
  const shift = await page.evaluate(() => window.__shift);
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await page.waitForTimeout(500);
  if ((await box.inputValue()) !== '') { await box.fill(''); await page.waitForTimeout(300); }
  return { script: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), task: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000), inBox, shift };
}
const bestOf = (runs) => Math.min(...runs.map((r) => r.script));

const heavyBox = page.locator('[data-testid="agent-footer"] textarea').first();
check('the saved chat has its typing box (a finished chat keeps the box)', (await heavyBox.count()) > 0);
if ((await heavyBox.count()) === 0) await done(1);
const heavy = []; for (let i = 0; i < REPS; i++) heavy.push(await typeOnce(heavyBox));
check('nothing is dropped or reordered while typing in the saved chat', heavy.every((r) => textIntact(TEXT, r.inBox)), JSON.stringify(heavy.map((r) => r.inBox.length)));
const worstShift = Math.max(...heavy.map((r) => r.shift));
check(`no layout jump while typing in the saved chat (worst ${worstShift.toFixed(3)}, limit ${MAX_LAYOUT_SHIFT})`, shiftsOk(worstShift), String(worstShift));

await page.getByText('محادثة جديدة', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(2500);
await page.getByText('الوسيط الذكي', { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(3000);
const floorBox = page.locator('[data-testid="agent-footer"] textarea').first();
check('an empty new chat has its typing box (the comparison floor)', (await floorBox.count()) > 0);
if ((await floorBox.count()) === 0) await done(1);
const floor = []; for (let i = 0; i < REPS; i++) floor.push(await typeOnce(floorBox));

const H = bestOf(heavy), F = bestOf(floor);
console.log(`      typing ${TEXT.length} keys, page code time, best of ${REPS}: saved ${built}-card chat ${H} ms (runs ${heavy.map((r) => r.script).join('/')}) · empty chat ${F} ms (runs ${floor.map((r) => r.script).join('/')}) · ratio ${(H / Math.max(SCRIPT_FLOOR_MS, F)).toFixed(1)}× (limit ${MAX_SCRIPT_RATIO}×)`);
check(`typing in a saved ${built}-card chat costs the page's own code no more than ×${MAX_SCRIPT_RATIO} of an empty chat`, typingOk(H, F), `${H} ms vs ${F} ms`);
check('no page error while all of this happened', log.errors.length === 0, log.errors.join(' | '));

console.log(failed ? `\n✗ ${failed} check(s) failed — typing or reopening a big saved chat is slow or glitchy again: look for work that re-runs for every card on every key press` : '\n✓ typing in a big saved chat is as light as in an empty one, and the chat reopens whole');
await done(failed ? 1 : 0);
