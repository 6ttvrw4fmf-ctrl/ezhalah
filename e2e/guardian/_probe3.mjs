import { chromium, devices } from '@playwright/test';
const BASE = 'https://ezhalah-app.vercel.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.argv.includes('--mobile');

const b = await chromium.launch();
const ctx = await b.newContext(MOBILE
  ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ar-SA' }
  : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'ar-SA' });
const page = await ctx.newPage();
const reqs = [];
page.on('request', (r) => { if (r.url().includes('/rpc/location_search_candidates_ar')) { try { reqs.push(JSON.parse(r.postData() || '{}')); } catch { reqs.push({}); } } });
const snap = () => page.evaluate(() => ({
  url: location.href,
  count: (document.body.innerText.match(/لقينا\s+([\d,٬]+)/) || [])[1] ?? null,
  cards: document.querySelectorAll('[data-testid^="card-listing-"]').length,
  first: document.querySelector('[data-testid^="card-listing-"]')?.getAttribute('data-testid') ?? null,
  loadMore: document.querySelectorAll('[data-testid="results-load-more"]').length,
  af: document.querySelectorAll('[data-testid="af-card"]').length,
  composer: [...document.querySelectorAll('textarea')].filter((e) => e.offsetParent !== null).map((e) => e.value),
  hist: history.length,
}));

// ── DOORS first (cheap) ──
for (const door of ['about', 'support']) {
  await page.goto(`${BASE}/${door}`, { waitUntil: 'load', timeout: 90000 });
  await sleep(4500);
  console.log(`=== /${door} ===`);
  console.log(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    close: document.querySelectorAll('[data-testid="info-modal-close"]').length,
    textareas: document.querySelectorAll('textarea').length,
    body: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 700),
  })), null, 1));
  const c = await page.$('[data-testid="info-modal-close"]');
  if (c) { await c.click(); await sleep(1500); }
  console.log('after close:', JSON.stringify(await page.evaluate(() => ({
    close: document.querySelectorAll('[data-testid="info-modal-close"]').length, url: location.href }))));
}

// ── search ──
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
await sleep(5000);
const close = await page.$('[data-testid="auth-popup-close"]');
if (close) { await close.click(); await sleep(600); }
const input = page.locator('[data-testid="city-input"]');
await input.click(); await input.fill('الرياض');
await page.waitForFunction((c) => [...document.querySelectorAll('div')].some((e) => {
  const t = (e.innerText || '').trim(); return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
}), 'الرياض', { timeout: 20000 });
const h = await page.evaluateHandle((c) => [...document.querySelectorAll('div')].filter((e) => {
  const t = (e.innerText || '').trim(); return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
}).pop(), 'الرياض');
await h.asElement().click(); await sleep(1500);
if (process.argv.includes('--zero')) {
  await page.locator('[data-testid="price-min-input"]').fill('999000000');
  await page.locator('[data-testid="price-max-input"]').fill('999999999');
  await sleep(1200);
}
const histBefore = await page.evaluate(() => history.length);
await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.children.length === 0 && (e.textContent || '').trim() === 'بحث') { e.scrollIntoView({ block: 'center' }); return; } });
await sleep(700);
await page.getByText('بحث', { exact: true }).first().click({ timeout: 30000 }).catch((e) => console.log('SEARCH CLICK FAILED', String(e).slice(0, 160)));
await page.waitForFunction(() => /لقينا|ما لقيت|ما فيه/.test(document.body.innerText), null, { timeout: 90000 })
  .catch(async () => console.log('SETTLE TIMEOUT\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 900)));
await sleep(2500);
console.log('=== RESULTS ===', JSON.stringify(await snap()), 'rpcs', reqs.length, 'histBefore', histBefore);
if (process.argv.includes('--zero')) {
  console.log('ZERO TEXT:', (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n').slice(0, 1200));
}

if (process.argv.includes('--back')) {
  const n0 = reqs.length;
  await page.goBack({ timeout: 30000 }).catch((e) => console.log('goBack err', String(e).slice(0, 100)));
  await sleep(4000);
  console.log('=== AFTER BACK ===', JSON.stringify(await snap()), 'rpcs', n0, '→', reqs.length);
  const n1 = reqs.length;
  await page.goForward({ timeout: 30000 }).catch((e) => console.log('goForward err', String(e).slice(0, 100)));
  await sleep(6000);
  console.log('=== AFTER FORWARD ===', JSON.stringify(await snap()), 'rpcs', n1, '→', reqs.length);
}

if (process.argv.includes('--reload')) {
  const n0 = reqs.length;
  const url = page.url();
  await page.reload({ waitUntil: 'load', timeout: 90000 });
  await sleep(7000);
  console.log('=== AFTER RELOAD ===', url, JSON.stringify(await snap()), 'rpcs', n0, '→', reqs.length);
  console.log('body:', (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n').slice(0, 600));
}

if (process.argv.includes('--cardtab')) {
  const n0 = reqs.length;
  const before = await snap();
  const opened = page.context().waitForEvent('page', { timeout: 25000 }).catch(() => null);
  await page.locator('[data-testid^="card-listing-"]').first().click({ timeout: 15000 }).catch((e) => console.log('card click', String(e).slice(0, 120)));
  const tab = await opened;
  console.log('new tab?', !!tab, tab ? tab.url().slice(0, 80) : '');
  if (tab) { await tab.close(); }
  await page.bringToFront(); await sleep(2500);
  console.log('=== AFTER CARD TAB ===', JSON.stringify(before), '→', JSON.stringify(await snap()), 'rpcs', n0, '→', reqs.length);
}

await b.close();
