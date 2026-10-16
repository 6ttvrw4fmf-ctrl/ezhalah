// Track E1 (docs/ops/QUALITY_REPAIR_ENGINEER.md): first tap on a cold page, as a real phone user.
// Prints ms until the city dropdown shows counts, cold and after switching to إيجار, then the empty-city answer.
// The dropdown has no testids: timing is measured by the body-text delta after the tap (🔧 2026-10-13).
// Usage: node e2e/engineers/first-tap.mjs [emptyCity]   — read-only against production.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const pwPath = ['/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright', 'playwright']
  .find((p) => { try { require.resolve(p); return true; } catch { return false; } });
if (!pwPath) { console.error('playwright not found'); process.exit(2); }
const { chromium } = require(pwPath);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const URL = 'https://ezhalah-app.vercel.app/';
const EMPTY = process.argv[2] || 'المرموثة';
// The city picker's empty-city note is read from the app's own translations, never restated here
// (verify-zero-vocabulary-is-derived-not-restated): the key is 'No listings here right now'.
const i18n = fs.readFileSync(new globalThis.URL('../../src/i18n.tsx', import.meta.url), 'utf8');
const NOTE = (i18n.match(/'No listings here right now':\s*'([^']+)'/) || [])[1];
if (!NOTE) { console.error("src/i18n.tsx has no 'No listings here right now' entry — the tool cannot judge the empty city"); process.exit(2); }

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-SA' })).newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500);
await page.getByText('الضروري فقط').click({ timeout: 4000 }).catch(() => {});

async function tapMs() {
  const before = await page.locator('body').innerText();
  const t0 = Date.now();
  await page.locator('[data-testid="city-input"]').click();
  for (let i = 0; i < 160; i++) {
    const added = (await page.locator('body').innerText()).replace(before, '');
    if (/[0-9]{2,}|[٠-٩]{2,}/.test(added)) return Date.now() - t0;
    await page.waitForTimeout(50);
  }
  return null;
}
const out = { cold_ms: await tapMs() };
await page.keyboard.press('Escape').catch(() => {});
await page.getByText('إيجار', { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(300);
out.after_rent_ms = await tapMs();
const inp = page.locator('[data-testid="city-input"]');
await inp.fill(EMPTY); await page.waitForTimeout(2500);
const body = await page.locator('body').innerText();
out.empty_city_shown = body.includes(EMPTY);
out.empty_city_note = body.includes(NOTE);
out.pass = out.cold_ms != null && out.cold_ms < 1000 && out.after_rent_ms != null && out.after_rent_ms < 3000 && out.empty_city_note;
console.log(JSON.stringify(out));
await browser.close();
process.exit(out.pass ? 0 : 1);
