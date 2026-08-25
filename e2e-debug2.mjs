import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:8877';
const SESSION = JSON.parse(readFileSync('/tmp/e2e-token.json', 'utf8'));
SESSION.expires_at = Math.floor(Date.now() / 1000) + SESSION.expires_in;
const SB_KEY = 'sb-aannarbkwcymrotzwdbo-auth-token';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [SB_KEY, JSON.stringify(SESSION)]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 200)));
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
console.log('A: sidebar has الأخيرة:', (await page.innerText('body')).includes('الأخيرة'));
// open the first chat: click its title text (server-merged entries exist)
const clicked = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('div,span')).filter((e) => /مصانع للإيجار في الرياض/.test((e.innerText || '').trim()) && e.children.length === 0);
  if (!rows.length) return null;
  const r = rows[0].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('B: found chat row:', !!clicked);
if (clicked) { await page.mouse.click(clicked.x, clicked.y); await page.waitForTimeout(4000); }
console.log('C: after open, counts:', JSON.stringify((await page.innerText('body')).match(/لقينا [\d,٬،]+ إعلان/g)));
console.log('C2: URL:', page.url());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
console.log('D: after reload URL:', page.url());
const b = await page.innerText('body');
console.log('E: after reload sidebar has الأخيرة:', b.includes('الأخيرة'), '| body head:', JSON.stringify(b.slice(0, 250)));
await browser.close();
