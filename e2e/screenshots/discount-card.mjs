// One-off, owner-requested (2026-10-19): a REAL-browser screenshot of an Aqar Buy card that carries a
// source-published discount on production, taken from a GitHub runner because the agent sandbox's
// egress policy cannot dial ezhalah-app.vercel.app (docs/ops/VERIFYING_PRODUCTION.md). Drives the
// Filter home exactly as scripts/verify-web-runtime-smoke.mjs does (same taps, same consent/auth
// dismissal), narrows to one district known to hold discounted land, and saves:
//   out/01-results-discount-card.png   the results list scrolled to the first «خصم» card
//   out/02-listing-preview.png         that card opened — the details panel's price block
// Prints the card's and the panel's text so the numbers can be cross-checked against aqar.
//   node e2e/screenshots/discount-card.mjs            (BASE_URL, CITY, DISTRICT_TYPED, DISTRICT_ROW optional)
import '../../scripts/lib/robotPass.mjs'; // robot pass: our own robot is never blocked by the network guard or bot checks (docs/ops/SCRAPE_GUARD.md)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dismissCookieConsent } from '../../scripts/lib/liveConsent.ts';
import { clickWitnessed } from '../../scripts/lib/liveClick.ts';
import { searchSettled } from '../lib/resultsSentence.mjs';

const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
const CITY = process.env.CITY || 'الرياض';
const DISTRICT_TYPED = process.env.DISTRICT_TYPED || 'المهدية';
const DISTRICT_ROW = process.env.DISTRICT_ROW || 'حي المهدية';
const OUT = 'out';
mkdirSync(OUT, { recursive: true });

const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) {
    const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2;
  } else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-SA' });
const page = await ctx.newPage();
const body = () => page.innerText('body');
const tap = async (txt) => {
  const box = await page.evaluate(CLICK_LEAF, txt);
  if (!box) throw new Error(`control not found: ${txt}`);
  const w = await clickWitnessed(page, box, { text: txt });
  if (!w.landed) log(`tap(${txt}) did not land on its target — hit: ${w.hit}`);
  await page.waitForTimeout(1200);
};
const tapWhenRendered = async (txt, timeoutMs = 8000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await page.evaluate(CLICK_LEAF, txt)) return tap(txt);
    await page.waitForTimeout(300);
  }
  throw new Error(`control never rendered: ${txt}`);
};
const dismissAuthPopup = async (windowMs = 4000) => {
  const until = Date.now() + windowMs;
  while (Date.now() < until && !(await page.$('[data-testid="auth-popup-close"]'))) await page.waitForTimeout(250);
  const close = await page.$('[data-testid="auth-popup-close"]');
  if (!close) return;
  await close.click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="signin-card"]'), { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
};
const waitForSettled = async (timeoutMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (searchSettled(await body())) return true; await page.waitForTimeout(500); }
  return false;
};
const pickCity = async (name) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.click('input >> nth=0'); await page.fill('input >> nth=0', '');
    await page.type('input >> nth=0', name, { delay: 60 });
    await tapWhenRendered(name).catch(() => {});
    if (await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 4000 }).catch(() => null)) return;
  }
  throw new Error(`pickCity(${name}) never confirmed`);
};
const pickDistrict = async (typed, row) => {
  await page.click('input >> nth=1'); await page.fill('input >> nth=1', '');
  await page.type('input >> nth=1', typed, { delay: 60 });
  await tapWhenRendered(row);
};

const log = (...a) => console.log(...a);
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
await dismissCookieConsent(page);
await dismissAuthPopup();
// Home starts on شراء (Buy) — exactly what the discount applies to; no deal tap needed.
await pickCity(CITY);
await pickDistrict(DISTRICT_TYPED, DISTRICT_ROW);
await tap('بحث');
log('results landed:', await waitForSettled(60000), '| url:', page.url());
await page.waitForTimeout(3000);

// Find the first card with a discount line; page through «عرض المزيد» a few times if needed.
let found = null;
for (let round = 0; round < 6 && !found; round++) {
  found = await page.$('[data-testid="card-discount"]');
  if (found) break;
  const more = page.locator('[data-testid="results-load-more"]').last();
  if (!(await more.count())) break;
  await more.scrollIntoViewIfNeeded().catch(() => {});
  await more.click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
}
if (!found) {
  await page.screenshot({ path: `${OUT}/00-no-discount-card-found.png` });
  writeFileSync(`${OUT}/body.txt`, await body());
  throw new Error('no [data-testid="card-discount"] on screen after paging — see 00-no-discount-card-found.png and body.txt');
}
const cardEl = await found.evaluateHandle((d) => d.closest('[data-testid^="card-listing-"]') || d.parentElement);
await cardEl.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(800);
const cardText = await cardEl.evaluate((e) => e.innerText);
log('--- CARD TEXT ---\n' + cardText + '\n-----------------');
await page.screenshot({ path: `${OUT}/01-results-discount-card.png` });
await cardEl.screenshot({ path: `${OUT}/01b-card-only.png` }).catch(() => {});

// Open it: the details panel must carry the same discount line under its price.
await cardEl.click({ timeout: 10000 }).catch(async () => { await found.click({ timeout: 10000 }); });
const panel = await page.waitForSelector('[data-testid="listing-preview-discount"]', { timeout: 20000 }).catch(() => null);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/02-listing-preview.png` });
log('preview discount line present:', !!panel);
if (panel) {
  const price = await page.$('[data-testid="listing-preview-price"]');
  log('--- PREVIEW ---', price ? await price.innerText() : '(no price node)', '|', await panel.innerText());
}
await browser.close();
