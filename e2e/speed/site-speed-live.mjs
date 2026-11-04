// SITE SPEED WATCH (owner 2026-10-27: «I want a robot to check this, I don't want my website to be slow or freeze or
// anything, I want it fixed immediately if anything goes wrong»). Runs every 30 minutes and after deploys
// (.github/workflows/site-speed-live.yml); a red run reaches the engineers through the alert_event bridge in that
// workflow (they fix; this robot only measures). Read-only. Uses the robot pass, so it is never blocked.
//
// One real visitor journey on a mid-range PHONE (iPhone 13 screen, 4× slower CPU, 4G):
//   1. OPEN   — ezhalah.com from a cold start until the search form answers (the «بحث» button is on screen).
//   2. SEARCH — Riyadh through the real Filter, until the first result card is on screen.
//   3. TAP    — press the first golden card («اضغط هنا»): the longest freeze (long task) in the 3 s after the tap,
//               the moment the owner felt as «not smooth» (measured 2026-10-27: 380 ms on a laptop ≈ 1.5 s here).
//   0. TABS + MAP (owner 2026-11-04: «we need to make sure it's never ever slow … people will run away»), run first:
//      tap «خريطة» until city names are on the map (first visit), back to «تصفية» until the form answers, «خريطة» again
//      (the map is kept between visits), two taps on «+» until the closer view's labels show, and «الوسيط الذكي» until
//      its message box is on screen. Measured the day these were added, on a laptop: map first visit ~4.2 s before the
//      bridge labels (#10554), return 0.85 s, Filter 0.07 s.
// Any step over its budget, or any step that cannot complete, fails the run (never a silent pass).
import '../../scripts/lib/robotPass.mjs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://ezhalah.com';
export const BUDGET = { openMs: 12_000, searchMs: 25_000, tapFreezeMs: 1_000, mapFirstMs: 5_000, filterBackMs: 2_500, mapReturnMs: 3_000, zoomMs: 4_000, brokerMs: 4_000 };

const browser = await chromium.launch();
const results = {};
let failed = 0;
const say = (ok, label, value, budget) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${value} ms (budget ${budget} ms)`); if (!ok) failed++; };
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_500_000, uploadThroughput: 375_000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // 1. OPEN
  let t = Date.now();
  await page.goto(`${BASE}/?speedwatch=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('بحث', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
  results.openMs = Date.now() - t;
  say(results.openMs <= BUDGET.openMs, 'open: cold start until the search form answers', results.openMs, BUDGET.openMs);

  // Cookie banner, if shown: essential only (privacy default).
  await page.getByText('الضروري فقط', { exact: true }).click({ timeout: 3_000 }).catch(() => {});

  // 0. TABS + MAP — what a visitor feels when moving around (labels on the map, a form that answers, a box to type in).
  const tab = (label) => page.locator('[role=tab]', { hasText: label }).first();
  const until = async (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30_000, polling: 25 });
  const labelsOnMap = () => location.pathname === '/map' && [...document.querySelectorAll('[data-testid=map-area]')]
    .some((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < innerHeight; });
  const formBack = () => location.pathname === '/' && [...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && e.textContent === 'بحث' && e.getBoundingClientRect().width > 0);
  await page.waitForTimeout(5_000);   // a reader's pause: the page settles and the quiet map warm-up runs
  t = Date.now(); await tab('خريطة').click(); await until(labelsOnMap); results.mapFirstMs = Date.now() - t;
  say(results.mapFirstMs <= BUDGET.mapFirstMs, 'map: first visit until city names are on the map', results.mapFirstMs, BUDGET.mapFirstMs);
  await page.waitForTimeout(2_000);
  t = Date.now(); await tab('تصفية').click(); await until(formBack); results.filterBackMs = Date.now() - t;
  say(results.filterBackMs <= BUDGET.filterBackMs, 'tabs: back to Filter until the form answers', results.filterBackMs, BUDGET.filterBackMs);
  await page.waitForTimeout(2_000);
  t = Date.now(); await tab('خريطة').click(); await until(labelsOnMap); results.mapReturnMs = Date.now() - t;
  say(results.mapReturnMs <= BUDGET.mapReturnMs, 'map: return visit until city names are on the map', results.mapReturnMs, BUDGET.mapReturnMs);
  await page.waitForTimeout(1_500);
  const before = await page.evaluate(() => [...document.querySelectorAll('[data-testid=map-area]')].map((e) => e.textContent).join('|'));
  const plus = page.getByRole('button', { name: /Zoom in|تكبير/ }).first();
  t = Date.now(); await plus.click(); await page.waitForTimeout(250); await plus.click();
  await until((prev) => { const now = [...document.querySelectorAll('[data-testid=map-area]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join('|'); return now.length > 0 && now !== prev; }, before);
  results.zoomMs = Date.now() - t;
  say(results.zoomMs <= BUDGET.zoomMs, 'map: two zoom-ins until the closer view is labelled', results.zoomMs, BUDGET.zoomMs);
  t = Date.now(); await tab('الوسيط الذكي').click();
  await until(() => location.pathname === '/agent' && [...document.querySelectorAll('textarea')].some((x) => x.getBoundingClientRect().width > 0));
  results.brokerMs = Date.now() - t;
  say(results.brokerMs <= BUDGET.brokerMs, 'tabs: Smart Broker until its message box is on screen', results.brokerMs, BUDGET.brokerMs);
  await tab('تصفية').click(); await until(formBack);

  // 2. SEARCH (Riyadh, the real Filter)
  t = Date.now();
  await page.getByPlaceholder('اختر المدينة', { exact: true }).click({ timeout: 20_000 });
  await page.keyboard.type('الرياض');
  await page.getByText('الرياض', { exact: true }).first().click({ timeout: 20_000 });
  await page.getByText('بحث', { exact: true }).first().click({ timeout: 20_000 });
  await page.getByText('اضغط هنا 👆', { exact: false }).first().waitFor({ state: 'visible', timeout: 90_000 });
  results.searchMs = Date.now() - t;
  say(results.searchMs <= BUDGET.searchMs, 'search: Riyadh until the first card is on screen', results.searchMs, BUDGET.searchMs);

  // 3. TAP the first golden card and measure the longest freeze right after it.
  await page.evaluate(() => {
    window.__ezLong = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ezLong.push([e.startTime, e.duration]); }).observe({ type: 'longtask' });
    window.__ezTap = performance.now();
  });
  await page.getByText('اضغط هنا 👆', { exact: false }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3_000);
  results.tapFreezeMs = Math.round(await page.evaluate(() => Math.max(0, ...window.__ezLong.filter(([s]) => s >= window.__ezTap - 50 && s <= window.__ezTap + 3_000).map(([, d]) => d))));
  say(results.tapFreezeMs <= BUDGET.tapFreezeMs, 'tap: longest freeze after pressing a golden listing', results.tapFreezeMs, BUDGET.tapFreezeMs);
  await ctx.close();
} catch (e) {
  console.error(`FAIL  the journey could not complete: ${e.message}`);
  failed++;
} finally {
  await browser.close();
}
console.log(`\nmeasured: ${JSON.stringify(results)}`);
if (failed) { console.error(`❌ site speed watch: ${failed} problem(s) — the engineers get this as an alert.`); process.exit(1); }
console.log('✅ site speed watch: ezhalah.com opens, moves between tabs, shows the map, searches and answers a tap within budget on a mid-range phone.');
