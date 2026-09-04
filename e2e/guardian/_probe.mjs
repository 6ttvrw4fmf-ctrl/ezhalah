import { chromium, devices } from '@playwright/test';
const BASE = 'https://ezhalah-app.vercel.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'ar-SA', colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
await sleep(6000);

console.log('=== THEME ===');
console.log(JSON.stringify(await page.evaluate(() => {
  const d = document.documentElement;
  const cs = getComputedStyle(d);
  return {
    dataTheme: d.getAttribute('data-theme'),
    paper: cs.getPropertyValue('--ez-paper'),
    ink: cs.getPropertyValue('--ez-ink'),
    colorScheme: cs.colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlBg: cs.backgroundColor,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
  };
}), null, 1));

console.log('=== STYLESHEET DARK RULE ===');
console.log(JSON.stringify(await page.evaluate(() => {
  const out = [];
  for (const ss of document.styleSheets) {
    let rules; try { rules = ss.cssRules; } catch { continue; }
    for (const r of rules) {
      const t = r.cssText || '';
      if (t.includes('data-theme="dark"') || t.includes('prefers-color-scheme: dark')) out.push(t.slice(0, 240));
    }
  }
  return out;
}), null, 1));

console.log('=== AUTH SURFACE ===');
console.log(JSON.stringify(await page.evaluate(() => ({
  signinCards: document.querySelectorAll('[data-testid="signin-card"]').length,
  closes: document.querySelectorAll('[data-testid="auth-popup-close"]').length,
  inputs: [...document.querySelectorAll('input')].map((e) => ({ type: e.type, ph: e.placeholder, tid: e.closest('[data-testid]')?.getAttribute('data-testid') || null, vis: e.offsetParent !== null })),
  bodyHas: { google: document.body.innerText.includes('Google'), apple: document.body.innerText.includes('Apple') },
})), null, 1));

console.log('=== BODY TEXT (first 1800) ===');
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1800));

await b.close();
