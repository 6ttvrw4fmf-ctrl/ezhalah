// 🔧 QA 10-17 owner job 3: the card that changed 10-12, as a real user on the LIVE site.
// laptop 1440×900 = photo-first cards 3 across with the gold «اضغط هنا»; a Deal App / Gathern click
// opens the in-app pane and the cards go back to compact rows; other sites open a new tab;
// phone 390×844 = the original card (no gold button). Read-only against production.
import '../../scripts/lib/robotPass.mjs'; // robot pass: our own robot is never blocked by the network guard or bot checks (docs/ops/SCRAPE_GUARD.md)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import fs from 'node:fs';
const BASE = 'https://ezhalah-app.vercel.app';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-ezhalah/b30c4d8b-5c91-5fc1-848d-f8b92f4cae08/scratchpad';
const IN_APP = new Set(['dealapp', 'gathern']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function run(label, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'ar-SA',
    userAgent: isMobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined });
  await ctx.addInitScript(() => { window.__opened = []; const o = window.open; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  const page = await ctx.newPage();
  const rows = new Map(); // listing_id -> source_table
  page.on('response', async (r) => {
    if (!r.url().includes('/rpc/location_search_candidates_ar') || r.request().method() !== 'POST') return;
    try { const j = await r.json(); if (Array.isArray(j)) for (const x of j) rows.set(String(x.listing_id), String(x.source_table)); } catch {}
  });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  await page.getByText('الضروري فقط').click({ timeout: 8000 }).catch(() => {});
  const tapTxt = async (t) => { await page.getByText(t, { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 }); await sleep(1000); };
  if (process.env.DEAL === 'rent-monthly') { await tapTxt('إيجار'); await tapTxt('شراء'); await tapTxt('شهري'); await tapTxt('سنوي'); }
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', 'الرياض');
  await sleep(2000);
  await page.getByText('الرياض', { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 });
  await sleep(1000);
  await page.getByText('بحث', { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 });
  await page.waitForSelector('[data-testid^="card-listing-"]', { timeout: 60000 });
  await sleep(3000);
  const r = { viewport, ms_to_cards: Date.now() - t0 };
  const cards = page.locator('[data-testid^="card-listing-"]');
  r.cards = await cards.count();
  const boxes = [];
  for (let i = 0; i < Math.min(r.cards, 6); i++) { const b = await cards.nth(i).boundingBox(); const id = (await cards.nth(i).getAttribute('data-testid')).replace('card-listing-', ''); boxes.push({ id, src: rows.get(id) || null, x: Math.round(b?.x ?? -1), y: Math.round(b?.y ?? -1), w: Math.round(b?.width ?? -1), h: Math.round(b?.height ?? -1) }); }
  r.first_cards = boxes;
  r.columns_in_first_row = new Set(boxes.filter((b) => b.y === boxes[0].y).map((b) => b.x)).size;
  r.gold_button_count = await page.getByText(/اضغط هنا/).count();
  r.shot_results = `${OUT}/card_${label}_results.png`;
  await page.screenshot({ path: r.shot_results, fullPage: false });
  // click an in-app card (Deal App / Gathern) if one is on screen, else the first card
  let target = boxes.find((b) => b.src && IN_APP.has(b.src.split('_')[0]));
  if (!target) {
    // scroll a bit through the list to find one
    for (let i = 6; i < r.cards && !target; i++) { const id = (await cards.nth(i).getAttribute('data-testid')).replace('card-listing-', ''); const src = rows.get(id); if (src && IN_APP.has(src.split('_')[0])) target = { id, src }; }
  }
  r.in_app_target = target || null;
  if (target) {
    const card = page.locator(`[data-testid="card-listing-${target.id}"]`);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const gold = card.getByText(/اضغط هنا/);
    if (await gold.count()) await gold.first().click({ timeout: 8000 }); else await card.click({ timeout: 8000 });
    await sleep(5000);
    r.iframes_after_click = await page.locator('iframe').count();
    r.opened_tabs_after_in_app_click = await page.evaluate(() => window.__opened);
    const after = []; for (let i = 0; i < Math.min(await cards.count(), 3); i++) { const b = await cards.nth(i).boundingBox(); after.push({ x: Math.round(b?.x ?? -1), y: Math.round(b?.y ?? -1), w: Math.round(b?.width ?? -1), h: Math.round(b?.height ?? -1) }); }
    r.cards_after_click = after;
    r.gold_button_count_after_click = await page.getByText(/اضغط هنا/).count();
    r.shot_pane = `${OUT}/card_${label}_pane.png`;
    await page.screenshot({ path: r.shot_pane, fullPage: false });
  }
  // an "other site" card: first card whose platform is not in-app
  const other = boxes.find((b) => b.src && !IN_APP.has(b.src.split('_')[0]));
  if (other && !isMobile) {
    const before = (await page.evaluate(() => window.__opened)).length;
    const card = page.locator(`[data-testid="card-listing-${other.id}"]`);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const gold = card.getByText(/اضغط هنا/);
    if (await gold.count()) await gold.first().click({ timeout: 8000 }); else await card.click({ timeout: 8000 });
    await sleep(3000);
    const opened = await page.evaluate(() => window.__opened);
    r.other_site = { id: other.id, src: other.src, new_tab_urls: opened.slice(before), iframes: await page.locator('iframe').count(), url_now: page.url() };
    r.shot_other = `${OUT}/card_${label}_other.png`; await page.screenshot({ path: r.shot_other, fullPage: false });
  }
  report[label] = r;
  await ctx.close();
}
const only = process.env.ONLY || '';
if (only !== 'phone') { try { await run('laptop1440', { width: 1440, height: 900 }, false); } catch (e) { report.laptop_error = String(e.message || e).split('\n')[0]; } }
if (only !== 'laptop') { try { await run('phone390', { width: 390, height: 844 }, true); } catch (e) { report.phone_error = String(e.message || e).split('\n')[0]; } }
await browser.close();
fs.writeFileSync(`${OUT}/card_check.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
