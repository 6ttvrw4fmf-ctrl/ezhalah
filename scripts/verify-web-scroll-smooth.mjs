// THE SCROLL ROBOT — drives the BUILT app like a laptop user and fails the build if scrolling gets slow again.
//
// Owner 2026-10-24: «on a laptop it feels slow when I scroll … on the phone it's perfect … let's make a robot that
// checks this so it doesn't do any issue». The cause, measured (src/lib/scrollCalm.ts has the numbers): never-ending
// decorative animations — 1,509 live ones on a 500-card list — each holding a composited layer, so a scroll competed
// with decoration for the graphics compositor. Nothing in `npm test` can see that: it is a property of the RENDERED
// page, and it only shows with real cards on a real laptop-size screen. So this robot renders them.
//
// It checks two kinds of thing, because each catches what the other cannot:
//   STRUCTURE (deterministic — does not depend on how fast the runner is):
//     · at rest, the number of live never-ending animations stays small at ANY list length (page one, then 500 cards);
//     · while scrolling, none of the decoration runs (gold glints removed, sky drift paused);
//     · once scrolling stops the glints are back (the owner wants the gold button shining — a fix that deletes the
//       shine would otherwise be «fast» and wrong).
//   SPEED (relative — the same page, the same scroll, with and without its animations; so a slow CI runner moves both
//   numbers and the ratio stays honest): scrolling the page as it ships must be about as smooth as scrolling the same
//   page with every animation switched off. Before the fix: 2–4× slower. After: ~1×.
//
// Run:  node scripts/verify-web-scroll-smooth.mjs         (after `npx expo export --platform web`)
//       SCROLL_ROBOT_DIST=/path/to/dist node scripts/verify-web-scroll-smooth.mjs   (any build — also how it is proven)
// Needs production data for ONE search + two «عرض المزيد» taps (no extra network: the rows are already buffered).
// Kept out of `npm test` (a real browser, live data): it runs in .github/workflows/web-runtime-smoke.yml on every PR.
import './lib/robotPass.mjs'; // robot pass for our own browser robots (docs/ops/SCRAPE_GUARD.md)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const DIST = process.env.SCROLL_ROBOT_DIST || new URL('../dist/', import.meta.url).pathname;
// The budget. Before the fix the live counts were 45–200 on page one and 1,509 after two taps.
const MAX_LIVE_AT_REST = 90;        // never-ending animations running while the page is still
const MAX_LIVE_WHILE_SCROLLING = 5; // running (not paused) mid-scroll
const MIN_LIVE_AFTER_STOP = 3;      // the glints must come back — the shine is a product feature
const MAX_P50_RATIO = 1.6, MAX_P50_FLOOR_MS = 24;   // as-shipped median frame vs the animations-off median
const MAX_P95_RATIO = 2.2, MAX_P95_FLOOR_MS = 60;   // …and the 95th percentile
const ATTEMPTS = 3;                 // the speed check passes if any attempt does; a real regression fails all three

let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `\n        ${detail}` : ''}`); };

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
const done = async (code) => { await browser.close().catch(() => {}); server.close(); process.exit(code); };

// ── one real search, like a user ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const consent = page.getByText('الضروري فقط', { exact: true });
if (await consent.isVisible().catch(() => false)) await consent.click();
const input = page.getByTestId('city-input');
await input.click(); await input.fill('الرياض'); await page.waitForTimeout(3000);
const suggestions = page.getByText('الرياض', { exact: true });
await suggestions.nth((await suggestions.count()) - 1).click(); await page.waitForTimeout(800);
await page.getByTestId('home-search-button').click();
try {
  await page.waitForFunction(() => /\d[\d,]* نتيجة/.test(document.body.innerText), null, { timeout: 90000 });
} catch {
  check('the Riyadh search landed (without cards there is nothing to measure — unknown is never a pass)', false, 'no result count after 90 s');
  await done(1);
}
await page.waitForTimeout(9000);

const gridCount = () => page.evaluate(() => { const g = document.querySelectorAll('[data-testid="result-card-grid"]'); return g.length ? g[g.length - 1].children.length : 0; });
const scroller = `(() => [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 500 && /(auto|scroll)/.test(getComputedStyle(d).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0])()`;
const live = () => page.evaluate(() => {
  const inf = document.getAnimations().filter((a) => a.effect?.getComputedTiming?.().iterations === Infinity);
  return { running: inf.filter((a) => a.playState === 'running').length, paused: inf.filter((a) => a.playState === 'paused').length };
});
async function tapMore() {
  const more = page.getByTestId('results-load-more').last();
  for (let k = 0, prev = -1; k < 25; k++) { // the page grows as it scrolls; follow the button until it stops moving
    if (!(await more.isVisible().catch(() => false))) break;
    await more.scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
    const c = await gridCount(); if (c === prev) break; prev = c;
  }
  if (!(await more.isVisible().catch(() => false))) return false;
  await more.click(); await page.waitForTimeout(6000); return true;
}
async function toTop() { await page.evaluate(`(() => { const s = ${scroller}; if (s) s.scrollTop = 0; })()`); await page.waitForTimeout(1200); }

// One wheel-scroll like a trackpad (~12,600 px) with a frame recorder; returns frame stats.
async function measureScroll() {
  await toTop();
  await page.evaluate(() => {
    const m = (window.__m = { d: [], stop: false });
    let prev = performance.now(); const f = (now) => { m.d.push(now - prev); prev = now; if (!m.stop) requestAnimationFrame(f); }; requestAnimationFrame(f);
  });
  await page.mouse.move(720, 450);
  for (let i = 0; i < 140; i++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(14); }
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    window.__m.stop = true; const d = window.__m.d.slice(1).sort((a, b) => a - b); const q = (p) => Math.round(d[Math.min(d.length - 1, Math.floor(d.length * p))]);
    return { frames: d.length, p50: q(0.5), p95: q(0.95), over50: d.filter((x) => x > 50).length, over100: d.filter((x) => x > 100).length };
  });
}

// ── STRUCTURE ───────────────────────────────────────────────────────────────────────────────────
async function structureAt(stage, cards) {
  await page.evaluate(`(() => { const s = ${scroller}; if (s) s.scrollTop = Math.min(2000, s.scrollHeight / 3); })()`);
  await page.waitForTimeout(1500);
  const rest = await live();
  check(`${stage}: at rest, no more than ${MAX_LIVE_AT_REST} never-ending animations are running (${cards} cards)`, rest.running <= MAX_LIVE_AT_REST, `running ${rest.running}`);
  await page.mouse.move(720, 450);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(14); }
  const during = await live();
  check(`${stage}: while scrolling, the decoration does not run (≤ ${MAX_LIVE_WHILE_SCROLLING} running, the rest paused or removed)`, during.running <= MAX_LIVE_WHILE_SCROLLING, `running ${during.running}, paused ${during.paused}`);
  await page.waitForTimeout(900);
  const after = await live();
  check(`${stage}: once scrolling stops the glints are back (≥ ${MIN_LIVE_AFTER_STOP} running — the shine is a feature)`, after.running >= MIN_LIVE_AFTER_STOP, `running ${after.running}`);
  console.log(`      ${stage}: at rest ${rest.running} · scrolling ${during.running} (+${during.paused} paused) · after stop ${after.running}`);
}
const page1 = await gridCount();
check('the first page has cards to scroll', page1 >= 6, `${page1} cards`);
await structureAt('page one', page1);

let cards = page1;
for (let i = 0; i < 2; i++) { if (!(await tapMore())) break; cards = await gridCount(); }
check('«عرض المزيد» grew the list (the long-list case is the one that was worst)', cards > page1, `${page1} → ${cards}`);
await structureAt('long list', cards);

// ── SPEED: as shipped vs the same page with every animation off ─────────────────────────────────
const style = await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
await style.evaluate((el) => { el.disabled = true; }); // loaded but OFF; toggled per measurement below
const setFloor = (on) => style.evaluate((el, v) => { el.disabled = !v; }, on);
let verdict = null;
for (let attempt = 1; attempt <= ATTEMPTS && !(verdict && verdict.ok); attempt++) {
  await setFloor(false); const shipped = await measureScroll();
  await setFloor(true); const floor = await measureScroll();
  await setFloor(false);
  const ok50 = shipped.p50 <= Math.max(MAX_P50_FLOOR_MS, MAX_P50_RATIO * floor.p50);
  const ok95 = shipped.p95 <= Math.max(MAX_P95_FLOOR_MS, MAX_P95_RATIO * floor.p95);
  verdict = { ok: ok50 && ok95, shipped, floor, ok50, ok95 };
  console.log(`      attempt ${attempt} (${cards} cards): as shipped p50 ${shipped.p50} ms · p95 ${shipped.p95} ms · >100 ms frames ${shipped.over100}   |   animations off p50 ${floor.p50} ms · p95 ${floor.p95} ms · >100 ms frames ${floor.over100}`);
}
check(`scrolling as shipped is as smooth as with animations off — median within ×${MAX_P50_RATIO} (or ${MAX_P50_FLOOR_MS} ms)`, verdict.ok50,
  `as shipped ${verdict.shipped.p50} ms vs ${verdict.floor.p50} ms with animations off, on every one of ${ATTEMPTS} attempts`);
check(`…and the 95th percentile within ×${MAX_P95_RATIO} (or ${MAX_P95_FLOOR_MS} ms)`, verdict.ok95,
  `as shipped ${verdict.shipped.p95} ms vs ${verdict.floor.p95} ms with animations off, on every one of ${ATTEMPTS} attempts`);

console.log(failed ? `\n✗ ${failed} check(s) failed — scrolling is slow again: look for a new never-ending animation or a layer-forcing style on the cards` : '\n✓ laptop scrolling is smooth and the decoration stays inside its budget');
await done(failed ? 1 : 0);
