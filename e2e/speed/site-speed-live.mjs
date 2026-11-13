// SITE SPEED WATCH (owner 2026-10-27: «I want a robot to check this, I don't want my website to be slow or freeze or
// anything, I want it fixed immediately if anything goes wrong»). Runs every 30 minutes and after deploys
// (.github/workflows/site-speed-live.yml); a red run reaches the engineers through the alert_event bridge in that
// workflow (they fix; this robot only measures). Read-only. Uses the robot pass, so it is never blocked.
//
// One real visitor journey on a mid-range PHONE (iPhone 13 screen, 4× slower CPU, 4G):
//   1. OPEN   — ezhalah.com from a cold start until the search form answers (the «بحث» button is on screen).
//   2. SEARCH — Riyadh through the real Filter, until the first result card is on screen.
//   3. TAP    — press the first golden card («اضغط هنا»): the time until the source site opens (new tab ≤ 0.5 s, frame
//              ≤ 3 s, through our preview's contact button when one shows), its address in Arabic, and the longest freeze (long task) in the 3 s after the tap,
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
export const BUDGET = { openMs: 12_000, searchMs: 25_000, tapFreezeMs: 1_000, mapFirstMs: 5_000, filterBackMs: 2_500, mapReturnMs: 3_000, zoomMs: 4_000, brokerMs: 4_000, panMs: 3_000, panFreezeMs: 500, mapColdTapMs: 5_000, siteOpenMs: 500, siteFrameMs: 3_000 };

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
  // A timeline of the zoom (printed only when the step is over budget): map movement, label changes, data reads.
  await page.evaluate(() => {
    const mk = window.mapkit; const m = mk?.maps?.[mk.maps.length - 1]; const t0 = performance.now(); window.__zt = [];
    const at = () => Math.round(performance.now() - t0);
    m?.addEventListener('region-change-start', () => window.__zt.push(`move-start@${at()}`));
    m?.addEventListener('region-change-end', () => window.__zt.push(`move-end@${at()} span=${m.region.span.latitudeDelta.toFixed(2)}`));
    let last = ''; const iv = setInterval(() => { const now = [...document.querySelectorAll('[data-testid=map-area]')].filter((e) => e.getBoundingClientRect().width > 0).length + '/' + (m?.annotations?.length ?? 0); if (now !== last) { window.__zt.push(`labels ${now}@${at()}`); last = now; } }, 50);
    setTimeout(() => clearInterval(iv), 30_000);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/rpc|feed|sb\//.test(e.name)) window.__zt.push(`read ${e.name.split('/').pop().split('?')[0]} ${Math.round(e.startTime - t0)}+${Math.round(e.duration)}`); }).observe({ type: 'resource' });
  });
  // Zoomed the way a pinch does — the map itself, to a quarter of the span — so the time is the MAP's answer. A robot tap
  // on «+» measured the wrong thing: on a phone the Google sign-in sheet can sit over that corner (the map did not start
  // moving until 6.8 s after the tap), and a scripted press does not reach the button in touch mode.
  t = Date.now();
  await page.evaluate(() => {
    const mk = window.mapkit; const m = mk.maps[mk.maps.length - 1]; const r = m.region;
    m.setRegionAnimated(new mk.CoordinateRegion(r.center, new mk.CoordinateSpan(r.span.latitudeDelta / 4, r.span.longitudeDelta / 4)), true);
  });
  await until((prev) => { const now = [...document.querySelectorAll('[data-testid=map-area]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join('|'); return now.length > 0 && now !== prev; }, before);
  results.zoomMs = Date.now() - t;
  say(results.zoomMs <= BUDGET.zoomMs, 'map: zoom in (pinch-like, ¼ span) until the closer view is labelled', results.zoomMs, BUDGET.zoomMs);
  if (results.zoomMs > BUDGET.zoomMs) console.log(`      zoom timeline: ${(await page.evaluate(() => window.__zt)).join(' · ')}`);
  // DRAG (owner 2026-11-05: «so slow changing and moving … gets stuck»): move the map half a screen east, the way a
  // finger drag does, until the newly shown area is labelled — and the longest frame gap (stutter) while it moves.
  await page.waitForTimeout(1_500);
  const beforePan = await page.evaluate(() => [...document.querySelectorAll('[data-testid=map-area]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join('|'));
  t = Date.now();
  await page.evaluate(() => {
    window.__fg = []; let last = performance.now(); const stop = last + 3_000;
    const f = (now) => { window.__fg.push(now - last); last = now; if (now < stop) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    const mk = window.mapkit; const m = mk.maps[mk.maps.length - 1]; const r = m.region;
    m.setRegionAnimated(new mk.CoordinateRegion(new mk.Coordinate(r.center.latitude, r.center.longitude + r.span.longitudeDelta / 2), r.span), true);
  });
  await until((prev) => { const now = [...document.querySelectorAll('[data-testid=map-area]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join('|'); return now.length > 0 && now !== prev; }, beforePan);
  results.panMs = Date.now() - t;
  say(results.panMs <= BUDGET.panMs, 'map: drag half a screen until the new area is labelled', results.panMs, BUDGET.panMs);
  await page.waitForTimeout(Math.max(0, 3_100 - results.panMs));
  results.panFreezeMs = Math.round(await page.evaluate(() => Math.max(0, ...window.__fg.slice(1))));
  say(results.panFreezeMs <= BUDGET.panFreezeMs, 'map: longest stutter (frame gap) while dragging', results.panFreezeMs, BUDGET.panFreezeMs);
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
    // THE TAP REACHES THE SITE AT ONCE (owner 2026-11-12: «it takes so long for me to get redirected … we need to keep a
    // robot to check this»). Every way a tap leaves for the source site is timed: a new tab (window.open — stubbed, so the
    // robot never loads the other site), the in-app frame, or our own preview's «اضغط هنا للتواصل». The address must
    // also be the visitor's language: this visitor is Arabic, so never a site's /en/ page.
    window.__ezOpens = [];
    window.open = (u) => { window.__ezOpens.push([performance.now(), String(u)]); return {}; };
    window.__ezFrame = null;
    new MutationObserver(() => { if (window.__ezFrame) return; const f = [...document.querySelectorAll('iframe')].find((x) => x.src && !/google\.com\/maps/.test(x.src)); if (f) window.__ezFrame = [performance.now(), f.src]; })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    window.__ezTap = performance.now();
  });
  await page.getByText('اضغط هنا 👆', { exact: false }).first().click({ timeout: 20_000 });
  await page.waitForTimeout(3_000);
  results.tapFreezeMs = Math.round(await page.evaluate(() => Math.max(0, ...window.__ezLong.filter(([s]) => s >= window.__ezTap - 50 && s <= window.__ezTap + 3_000).map(([, d]) => d))));
  say(results.tapFreezeMs <= BUDGET.tapFreezeMs, 'tap: longest freeze after pressing a golden listing', results.tapFreezeMs, BUDGET.tapFreezeMs);
  let left = await page.evaluate(() => ({ open: window.__ezOpens[0] ?? null, frame: window.__ezFrame, tap: window.__ezTap }));
  if (!left.open && !left.frame) {
    // Our own preview opened (Wasalt, Aqar …): press its contact button the way a visitor does.
    const contact = page.getByTestId('listing-preview-contact').first();
    await contact.waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => { window.__ezTap = performance.now(); });
    await contact.click({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    left = await page.evaluate(() => ({ open: window.__ezOpens[0] ?? null, frame: null, tap: window.__ezTap }));
  }
  const [at, url] = left.open ?? left.frame ?? [NaN, ''];
  if (!url) { console.error('FAIL  tap: the golden listing never reached its site (no new tab, no frame, no contact open)'); failed++; }
  else if (left.open) {
    results.siteOpenMs = Math.round(at - left.tap);
    say(results.siteOpenMs <= BUDGET.siteOpenMs, `tap: until the site opens in a new tab (${new URL(url).hostname})`, results.siteOpenMs, BUDGET.siteOpenMs);
  } else {
    results.siteFrameMs = Math.round(at - left.tap);
    say(results.siteFrameMs <= BUDGET.siteFrameMs, `tap: until the site starts loading inside Ezhalah (${new URL(url).hostname})`, results.siteFrameMs, BUDGET.siteFrameMs);
  }
  if (url) {
    const english = /^\/en(\/|$)/.test(new URL(url).pathname);
    console.log(`${english ? 'FAIL' : 'PASS'}  tap: an Arabic visitor lands on the site's Arabic page (${url.slice(0, 90)})`);
    if (english) failed++;
  }
  await ctx.close();

  // 4. IMPATIENT MAP TAP (owner 2026-11-05): a visitor who taps «خريطة» the moment the page answers — no reader's
  // pause, so the quiet warm-up has not run. Step 0 waits 5 s first and read 1.2 s while a straight tap showed a grey
  // screen for ~8–10 s on a phone (2026-11-05). Fresh phone, same CPU and network.
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
  const p2 = await ctx2.newPage();
  const cdp2 = await ctx2.newCDPSession(p2);
  await cdp2.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_500_000, uploadThroughput: 375_000 });
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p2.goto(`${BASE}/?speedwatch=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await p2.getByText('بحث', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
  await p2.getByText('الضروري فقط', { exact: true }).click({ timeout: 3_000 }).catch(() => {});
  t = Date.now();
  await p2.locator('[role=tab]', { hasText: 'خريطة' }).first().click();
  await p2.waitForFunction(() => location.pathname === '/map' && [...document.querySelectorAll('[data-testid=map-area]')]
    .some((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < innerHeight; }), null, { timeout: 30_000, polling: 25 });
  results.mapColdTapMs = Date.now() - t;
  say(results.mapColdTapMs <= BUDGET.mapColdTapMs, 'map: tapped at once (no pause) until city names are on the map', results.mapColdTapMs, BUDGET.mapColdTapMs);
  await ctx2.close();
} catch (e) {
  console.error(`FAIL  the journey could not complete: ${e.message}`);
  failed++;
} finally {
  await browser.close();
}
console.log(`\nmeasured: ${JSON.stringify(results)}`);
if (failed) { console.error(`❌ site speed watch: ${failed} problem(s) — the engineers get this as an alert.`); process.exit(1); }
console.log('✅ site speed watch: ezhalah.com opens, moves between tabs, shows the map, searches and answers a tap within budget on a mid-range phone.');
