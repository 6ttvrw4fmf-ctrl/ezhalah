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
page.on('request', (r) => { if (r.url().includes('/rpc/location_search_candidates_ar')) { try { reqs.push(JSON.parse(r.postData() || '{}')); } catch {} } });
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
await sleep(5000);

// close signin card
const close = await page.$('[data-testid="auth-popup-close"]');
if (close) { await close.click(); await sleep(600); }

// pick city
const input = page.locator('[data-testid="city-input"]');
await input.click(); await input.fill('الرياض');
await page.waitForFunction((c) => [...document.querySelectorAll('div')].some((e) => {
  const t = (e.innerText || '').trim(); return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
}), 'الرياض', { timeout: 15000 });
const h = await page.evaluateHandle((c) => [...document.querySelectorAll('div')].filter((e) => {
  const t = (e.innerText || '').trim(); return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
}).pop(), 'الرياض');
await h.asElement().click();
await sleep(1500);
console.log('city committed =', await input.inputValue());

if (process.argv.includes('--zero')) {
  await page.locator('[data-testid="price-min-input"]').fill('999000000');
  await page.locator('[data-testid="price-max-input"]').fill('999999999');
  await sleep(1200);
}

await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.children.length === 0 && (e.textContent || '').trim() === 'بحث') { e.scrollIntoView({ block: 'center' }); return; } });
await sleep(800);
const t0 = Date.now();
await page.getByText('بحث', { exact: true }).first().click({ timeout: 30000 });
await page.waitForFunction(() => /لقينا|ما لقيت|ما فيه/.test(document.body.innerText), null, { timeout: 70000 })
  .catch(async () => { console.log('SETTLE TIMEOUT. url=', page.url(), '\nBODY:\n', (await page.evaluate(() => document.body.innerText)).slice(0, 1500)); });
await sleep(2500);
console.log(`search settled in ${Date.now() - t0}ms · url=${page.url()} · rpcs=${reqs.length}`);

console.log('=== CARDS ===');
console.log(JSON.stringify(await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-testid^="card-listing-"]')];
  return {
    n: cards.length,
    loadMore: document.querySelectorAll('[data-testid="results-load-more"]').length,
    first: cards.slice(0, 2).map((c) => ({ id: c.getAttribute('data-testid'), text: (c.innerText || '').slice(0, 700) })),
  };
}), null, 1));

console.log('=== HEADLINE ===');
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 900));

console.log('=== LOADERS PRESENT? ===');
console.log(JSON.stringify(await page.evaluate(() => ({
  progressbar: document.querySelectorAll('[role="progressbar"]').length,
  shimmer: document.querySelectorAll('[data-testid="device-card-shimmer"]').length,
  svgSpin: [...document.querySelectorAll('svg')].filter((e) => e.getAttribute('viewBox') === '0 0 32 32').length,
  animName: [...document.querySelectorAll('*')].filter((e) => { const a = getComputedStyle(e).animationName; return a && a !== 'none'; }).map((e) => getComputedStyle(e).animationName).slice(0, 12),
})), null, 1));

// BACK
if (process.argv.includes('--back')) {
  const cnt = (await page.evaluate(() => document.body.innerText)).match(/لقينا\s+([\d,٬]+)/)?.[1];
  const firstId = await page.evaluate(() => document.querySelector('[data-testid^="card-listing-"]')?.getAttribute('data-testid'));
  const before = reqs.length;
  const ctx2 = page.context();
  const opened = ctx2.waitForEvent('page', { timeout: 20000 }).catch(() => null);
  await page.locator('[data-testid^="card-listing-"]').first().click({ timeout: 15000 }).catch((e) => console.log('card click err', String(e).slice(0, 120)));
  await sleep(3000);
  const tab = await opened;
  console.log('opened new tab?', !!tab, 'url now', page.url());
  if (tab) { await tab.close(); await page.bringToFront(); await sleep(1500); }
  else { await page.goBack({ timeout: 30000 }).catch(() => {}); await sleep(3000); }
  const cnt2 = (await page.evaluate(() => document.body.innerText)).match(/لقينا\s+([\d,٬]+)/)?.[1];
  const firstId2 = await page.evaluate(() => document.querySelector('[data-testid^="card-listing-"]')?.getAttribute('data-testid'));
  console.log(`BACK: count ${cnt} → ${cnt2} · first ${firstId} → ${firstId2} · rpcs ${before} → ${reqs.length} · url ${page.url()}`);
}

// NEW CHAT
if (process.argv.includes('--newchat')) {
  const before = reqs.length;
  const ok = await page.getByText('محادثة جديدة', { exact: true }).first().click({ timeout: 15000 }).then(() => true).catch((e) => String(e).slice(0, 100));
  console.log('new chat click:', ok);
  await sleep(4000);
  console.log(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    cards: document.querySelectorAll('[data-testid^="card-listing-"]').length,
    af: document.querySelectorAll('[data-testid="af-card"]').length,
    textareas: [...document.querySelectorAll('textarea,input')].filter((e) => e.offsetParent !== null).map((e) => ({ tag: e.tagName, v: e.value, ph: e.placeholder })),
    body: document.body.innerText.slice(0, 500),
  })), null, 1));
  console.log('rpcs after new chat:', reqs.length, '(was', before, ')');
}

await b.close();
