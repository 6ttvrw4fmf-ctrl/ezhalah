#!/usr/bin/env node
// ⚡ Scraping Engineer — live-site full-chain check, used like a real user (read-only).
//
// Searches https://ezhalah-app.vercel.app through the Filter UI, pages through the results with
// «عرض المزيد», finds the card for ONE known source listing, clicks it, and reports the URL the card
// really opens next to the price/area text the card shows. Compare that with the source page
// (source-reread.yml) to finish the chain.
//
//   node e2e/engineers/full-chain.mjs '{"id":13105192,"city":"جدة","deal":"rent","period":"سنوي",
//        "category":"سكني","url":"https://example.sa/property/123","price":"48,000","pages":15}'
//
//   id        required, the listing's search_listings_ar.listing_id (cards are testid card-listing-<id>)
//   city      required, the city exactly as the suggestion shows it
//   district  optional, typed into the district box and picked from its suggestions
//   region    optional, a substring of the suggestion row (for names that exist in two regions)
//   deal      "buy" (default) | "rent"           chips start on شراء; rent taps إيجار then شراء off
//   period    optional rent period chip («شهري», «سنوي», …)
//   category  optional «سكني» | «تجاري»; group optional, e.g. «المكاتب»
//   url       required, the listing's stored source URL (compared without the part after #)
//   price     optional text the card must show (e.g. "48,000")
//   pages     how many «عرض المزيد» presses to try before giving up (default 12)
//
// Exit 0 = card found AND it opened the exact URL (and showed `price` when given). Exit 1 = not.
// Launch flags are the ones docs/ops/VERIFYING_PRODUCTION.md documents for this cloud proxy.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pwPath = ['/opt/node22/lib/node_modules/playwright', 'playwright'].find((p) => {
  try { require.resolve(p); return true; } catch { return false; }
});
const { chromium } = require(pwPath);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium']
  .find((p) => fs.existsSync(p));

const a = JSON.parse(process.argv[2] || '{}');
if (!a.city || !a.url || !a.id) { console.error('need {"id":…,"city":…,"url":…}'); process.exit(2); }
const norm = (u) => String(u || '').split('#')[0].replace(/\/+$/, '').replace(/^http:/, 'https:');
const log = (...m) => console.log(...m);

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ssl-version-max=tls1.2',
    ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])],
});
let ok = false;
try {
  const ctx = await browser.newContext({ locale: 'ar', viewport: { width: 1280, height: 900 } });
  // A card opens its source in a new tab: record the URL instead of loading the source site.
  await ctx.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
  });
  const page = await ctx.newPage();
  await page.goto('https://ezhalah-app.vercel.app', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByText('الضروري فقط').click({ timeout: 15000 }).catch(() => {});

  if (a.deal === 'rent') {
    await page.getByText('إيجار', { exact: true }).first().click();
    await page.getByText('شراء', { exact: true }).first().click();
  }
  const city = page.getByPlaceholder('اختر المدينة', { exact: true });
  await city.click();
  await city.pressSequentially(a.city, { delay: 60 });
  await page.waitForTimeout(2500);
  const sugg = page.getByText(new RegExp(`^${a.city}$`));
  if (a.region) {
    await page.locator('div', { hasText: a.region }).filter({ has: sugg }).last().click();
  } else {
    await sugg.last().click();
  }
  if (a.district) {
    const d = page.locator('input').nth(1);
    await d.click();
    await d.pressSequentially(a.district.replace(/^حي\s+/, ''), { delay: 60 });
    await page.waitForTimeout(2500);
    await page.getByText(new RegExp(`^(حي )?${a.district.replace(/^حي\s+/, '')}$`)).last().click();
  }
  if (a.category) await page.getByText(a.category, { exact: true }).first().click();
  if (a.group) await page.getByText(a.group, { exact: true }).first().click();
  if (a.period) await page.getByText(a.period, { exact: true }).first().click().catch(() => log(`! no «${a.period}» chip`));
  await page.getByText('بحث', { exact: true }).first().click();
  await page.waitForSelector('[data-testid^="card-listing-"]', { timeout: 120000 }).catch(async () => {
    const t = await page.evaluate(() => document.body.innerText.split('\n').filter(Boolean).slice(-25).join(' | '));
    throw new Error(`no result cards appeared; page ends: ${t}`);
  });
  const summary = await page.evaluate(() => (document.body.innerText.match(/[^\n]*\d[\d,]* نتيجة[^\n]*/) || [''])[0]);
  log(`search: ${summary}`);

  // Every result card carries data-testid="card-listing-<search_listings_ar.listing_id>".
  const card = page.getByTestId(`card-listing-${a.id}`);
  const all = page.locator('[data-testid^="card-listing-"]');
  // Results arrive as a cascade revealed on scroll (src/lib/initialReveal.ts): scroll like a user
  // until the revealed set stops growing before deciding the card is not on this page.
  const revealAll = async () => {
    let prev = -1;
    for (let i = 0; i < 40; i++) {
      if (await card.count()) return;
      const now = await all.count();
      if (now === prev) return;
      prev = now;
      await all.last().scrollIntoViewIfNeeded().catch(() => {});
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(900);
    }
  };
  for (let p = 0; p <= (a.pages ?? 12); p++) {
    await page.waitForTimeout(2500);
    await revealAll();
    if (await card.count()) {
      const text = (await card.first().innerText()).replace(/\s*\n+\s*/g, ' | ');
      await card.first().getByRole('link').first().click();
      await page.waitForTimeout(800);
      const opened = await page.evaluate(() => window.__opened.at(-1));
      ok = norm(opened) === norm(a.url) && (!a.price || text.includes(a.price));
      log(`card found after ${p} «عرض المزيد» press(es)`);
      log(`card: ${text}`);
      log(`opens: ${opened}`);
      log(`url ${norm(opened) === norm(a.url) ? 'MATCHES' : 'DIFFERS'}${a.price ? `; price ${text.includes(a.price) ? 'shown' : 'NOT shown'} (${a.price})` : ''}`);
      break;
    }
    const more = page.getByText('عرض المزيد', { exact: true }).last();
    if (!(await more.count())) { log(`no «عرض المزيد» after ${p} press(es)`); break; }
    await more.scrollIntoViewIfNeeded();
    await more.click();
  }
  if (!ok) log(`NOT VERIFIED: listing ${a.id} → ${a.url}`);
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
