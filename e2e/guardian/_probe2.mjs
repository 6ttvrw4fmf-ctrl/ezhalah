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
page.on('request', (r) => { if (r.url().includes('/rpc/location_search_candidates_ar')) reqs.push(r.url()); });
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
await sleep(5000);
const close = await page.$('[data-testid="auth-popup-close"]');
if (close) { await close.click(); await sleep(600); }

console.log('=== SIDEBAR / testids on home ===');
console.log(JSON.stringify(await page.evaluate(() => ({
  testids: [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))],
  newChatText: document.body.innerText.includes('محادثة جديدة'),
})), null, 1));

// city + search
const input = page.locator('[data-testid="city-input"]');
await input.click(); await input.fill('الرياض');
await page.waitForFunction((c) => [...document.querySelectorAll('div')].some((e) => {
  const t = (e.innerText || '').trim(); return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
}), 'الرياض', { timeout: 20000 });
const h = await page.evaluateHandle((c) => [...document.querySelectorAll('div')].filter((e) => {
  const t = (e.innerText || '').trim(); return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
}).pop(), 'الرياض');
await h.asElement().click();
await sleep(1500);
console.log('city =', await input.inputValue());

if (process.argv.includes('--zero')) {
  await page.locator('[data-testid="price-min-input"]').fill('999000000');
  await page.locator('[data-testid="price-max-input"]').fill('999999999');
  await sleep(1200);
}

await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.children.length === 0 && (e.textContent || '').trim() === 'بحث') { e.scrollIntoView({ block: 'center' }); return; } });
await sleep(700);
const t0 = Date.now();
await page.getByText('بحث', { exact: true }).first().click({ timeout: 30000 }).then(() => console.log('search clicked')).catch((e) => console.log('SEARCH CLICK FAILED:', String(e).slice(0, 200)));

// mid-flight snapshot
await sleep(900);
console.log('=== MID-FLIGHT ===');
console.log(JSON.stringify(await page.evaluate(() => ({
  url: location.href,
  testids: [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))].filter((t) => !/input|city|district|price|area/.test(t)),
  anim: [...new Set([...document.querySelectorAll('*')].map((e) => getComputedStyle(e).animationName).filter((a) => a && a !== 'none'))].slice(0, 10),
  body: document.body.innerText.slice(-700),
})), null, 1));

await page.waitForFunction(() => /لقينا|ما لقيت|ما فيه/.test(document.body.innerText), null, { timeout: 90000 })
  .then(() => console.log(`settled in ${Date.now() - t0}ms`))
  .catch(async () => console.log('SETTLE TIMEOUT\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 1200)));
await sleep(2500);

console.log('=== AFTER ===');
console.log(JSON.stringify(await page.evaluate(() => ({
  url: location.href,
  cards: document.querySelectorAll('[data-testid^="card-listing-"]').length,
  loadMore: document.querySelectorAll('[data-testid="results-load-more"]').length,
  testids: [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))].filter((t) => !t.startsWith('card-listing-')),
  newChatText: document.body.innerText.includes('محادثة جديدة'),
  anim: [...new Set([...document.querySelectorAll('*')].map((e) => getComputedStyle(e).animationName).filter((a) => a && a !== 'none'))].slice(0, 10),
  tail: document.body.innerText.slice(-500),
})), null, 1));

if (process.argv.includes('--newchat')) {
  console.log('=== NEW CHAT ===');
  const targets = await page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && (e.textContent || '').trim() === 'محادثة جديدة')
    .map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vis: e.offsetParent !== null }; }));
  console.log('new-chat leaves:', JSON.stringify(targets));
  const before = reqs.length;
  const el = page.getByText('محادثة جديدة', { exact: true }).first();
  await el.click({ timeout: 10000 }).then(() => console.log('clicked')).catch((e) => console.log('click failed', String(e).slice(0, 150)));
  await sleep(4500);
  console.log(JSON.stringify(await page.evaluate(() => ({
    url: location.href,
    cards: document.querySelectorAll('[data-testid^="card-listing-"]').length,
    af: document.querySelectorAll('[data-testid="af-card"]').length,
    fields: [...document.querySelectorAll('textarea,input')].filter((e) => e.offsetParent !== null).map((e) => ({ tag: e.tagName, v: e.value, tid: e.closest('[data-testid]')?.getAttribute('data-testid') })),
    body: document.body.innerText.slice(0, 400),
  })), null, 1));
  console.log('rpcs', before, '→', reqs.length);
}

await b.close();
