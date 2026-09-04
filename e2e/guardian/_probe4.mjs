import { chromium, devices } from '@playwright/test';
const BASE = 'https://ezhalah-app.vercel.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = process.argv.includes('--mobile');

const LOADER_PROBE = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01; };
  const hits = [];
  for (const e of document.querySelectorAll('[role="progressbar"],[data-testid*="shimmer"],[data-testid="voice-processing"]')) if (vis(e)) hits.push(`sel:${e.getAttribute('data-testid') || e.getAttribute('role')}`);
  const t = document.body.innerText;
  for (const p of ['يبحث في المنصات', 'جاري التحميل', 'جارٍ التحميل', 'جاري البحث', 'لحظات']) if (t.includes(p)) hits.push(`text:${p}`);
  return hits;
};

const b = await chromium.launch();
const ctx = await b.newContext(MOBILE
  ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'ar-SA' }
  : { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'ar-SA' });
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
await sleep(6000);

const authProbe = () => page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01; };
  const cards = [...document.querySelectorAll('[data-testid="signin-card"]')].filter(vis);
  const closes = [...document.querySelectorAll('[data-testid="auth-popup-close"]')].filter(vis);
  const inputs = [...document.querySelectorAll('input,textarea')].filter(vis).map((e) => ({ type: e.type, ph: e.placeholder, im: e.inputMode, tid: e.closest('[data-testid]')?.getAttribute('data-testid') || null }));
  const t = document.body.innerText;
  // is the primary CTA covered?
  let covered = null;
  for (const e of document.querySelectorAll('*')) {
    if (e.children.length === 0 && (e.textContent || '').trim() === 'بحث') {
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      if (r.width && r.height) {
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        covered = top ? !!top.closest('[data-testid="signin-card"]') : 'offscreen';
      }
      break;
    }
  }
  return {
    cards: cards.length, closes: closes.length, inputs,
    cardRects: cards.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), getComputedStyle(c).position]; }),
    google: t.includes('Google'), apple: t.includes('Apple'),
    phoneish: /رقم الجوال|واتساب|رمز التحقق|OTP|\+966/.test(t),
    ctaCovered: covered,
  };
});

console.log('=== AUTH (fresh load) ===', JSON.stringify(await authProbe(), null, 1));
console.log('=== LOADERS on home ===', JSON.stringify(await page.evaluate(LOADER_PROBE)));

// open the sidebar sign-in CTA (desktop) -> does a SECOND invitation appear?
const cta = await page.$('[data-testid="sidebar-signin-cta"]');
console.log('sidebar-signin-cta present:', !!cta);
if (cta) {
  await cta.click().catch((e) => console.log('cta click', String(e).slice(0, 90)));
  await sleep(2500);
  console.log('=== AUTH (after sign-in CTA) ===', JSON.stringify(await authProbe(), null, 1));
  const c = await page.$('[data-testid="auth-popup-close"]');
  if (c) { await c.click(); await sleep(1500); }
  console.log('=== AUTH (after closing) ===', JSON.stringify(await authProbe(), null, 1));
}

// dismissal survives client-side navigation (tab switch)
await page.getByText('الوكيل الذكي', { exact: true }).first().click().catch(() => {});
await sleep(2500);
console.log('=== AUTH (agent tab) ===', JSON.stringify(await authProbe(), null, 1));
console.log('=== LOADERS on agent ===', JSON.stringify(await page.evaluate(LOADER_PROBE)));
await page.getByText('تصفية', { exact: true }).first().click().catch(() => {});
await sleep(2500);
console.log('=== AUTH (back on filter) ===', JSON.stringify(await authProbe(), null, 1));

await b.close();
