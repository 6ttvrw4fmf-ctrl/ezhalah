// Customer proof for the AI agent (🔧 2026-10-13): type messages into the chat as a phone user and print, per message,
// the cards shown and the p_cities / p_districts the app really sent to location_search_candidates_ar.
// Usage: node e2e/engineers/agent-chat.mjs "<message 1>" ["<message 2>" …]   — read-only against production.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const pwPath = ['/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright', 'playwright']
  .find((p) => { try { require.resolve(p); return true; } catch { return false; } });
if (!pwPath) { console.error('playwright not found'); process.exit(2); }
const { chromium } = require(pwPath);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const msgs = process.argv.slice(2);
if (!msgs.length) { console.error('give at least one message'); process.exit(2); }

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-SA' })).newPage();
const sent = [];
page.on('request', (r) => { if (r.url().includes('location_search_candidates_ar')) { try { sent.push(JSON.parse(r.postData() || '{}')); } catch {} } });
await page.goto('https://ezhalah-app.vercel.app/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
await page.getByText('الضروري فقط').click({ timeout: 4000 }).catch(() => {});
await page.getByText('الوسيط الذكي', { exact: true }).first().click({ timeout: 5000 });
await page.waitForTimeout(1500);
const box = page.locator('[data-testid="agent-footer"] textarea, [data-testid="agent-footer"] input').first();
let last = 0;
for (const m of msgs) {
  const n0 = sent.length;
  await box.click(); await box.fill(m); await page.keyboard.press('Enter');
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await page.waitForTimeout(1000);
    if (sent.length > n0 && (await page.locator('[data-testid^="card-listing-"]').count()) > 0 && Date.now() - t0 > 4000) break;
    if (sent.length === n0 && Date.now() - t0 > 20000) break; // an aside sends no search
  }
  last = await page.locator('[data-testid^="card-listing-"]').count();
  const req = sent.length > n0 ? sent.at(-1) : null;
  console.log(JSON.stringify({ message: m, searched: !!req, cards: last, p_cities: req?.p_cities ?? null, p_districts: req?.p_districts ?? null }));
}
await browser.close();
process.exit(last > 0 ? 0 : 1);
