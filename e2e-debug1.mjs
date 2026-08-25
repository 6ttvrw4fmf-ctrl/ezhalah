import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = 'http://localhost:8877';
const SESSION = JSON.parse(readFileSync('/tmp/e2e-token.json', 'utf8'));
SESSION.expires_at = Math.floor(Date.now() / 1000) + SESSION.expires_in;
const SB_KEY = 'sb-aannarbkwcymrotzwdbo-auth-token';
const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [SB_KEY, JSON.stringify(SESSION)]);
const page = await ctx.newPage();
const tap = async (txt, wait = 900) => { const b = await page.evaluate(CLICK_LEAF, txt); if (!b) return false; await page.mouse.click(b.x, b.y); await page.waitForTimeout(wait); return true; };

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await tap('إيجار'); await tap('شراء');
await page.locator('[data-testid="city-input"]').click(); await page.keyboard.type('الرياض', { delay: 40 }); await page.waitForTimeout(2000);
await tap('الرياض');
await tap('تجاري'); await page.waitForTimeout(300);
await tap('الصناعة واللوجستيات'); await page.waitForTimeout(300);
await tap('مصنع'); await page.waitForTimeout(300);
await tap('بحث');
await page.waitForTimeout(15000);
console.log('counts:', JSON.stringify((await page.innerText('body')).match(/لقينا [\d,٬،]+ إعلان/g)));
await page.waitForTimeout(4000);
// inspect localStorage
const lsInfo = await page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k) || '';
    out[k] = v.length;
  }
  return out;
});
console.log('localStorage keys:', JSON.stringify(lsInfo, null, 1));
const hist = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('history:'));
  if (!k) return 'NO HISTORY KEY';
  try { const arr = JSON.parse(localStorage.getItem(k)); return arr.map((e) => ({ id: e.id, title: e.title, hasTranscript: !!e.transcript, msgs: e.transcript?.msgs?.length })); } catch (e) { return String(e); }
});
console.log('history entries:', JSON.stringify(hist, null, 1));
console.log('sidebar text head:', JSON.stringify((await page.innerText('body')).slice(0, 400)));
await browser.close();
