#!/usr/bin/env node
// 🔧 Quality & Repair — speed track E1, the READY first-tap check (QUALITY_REPAIR_ENGINEER.md §2.E.1).
// Opens https://ezhalah-app.vercel.app in real Chromium at phone size (390x844), taps the city field on a
// cold page and measures, in ms, when city NAMES and COUNTS appear; then with شراء+إيجار (both toggles
// on), then إيجار only; then types the empty city «المرموثة» under إيجار and measures when it is shown and
// when «لا توجد إعلانات هنا حالياً» appears. Limits (owner 2026-10-03): names < 1,000 ms, counts < 3,000 ms.
// Read-only against production; one browser. Prints one JSON line. Container recipe per
// docs/ops/VERIFYING_PRODUCTION.md (pinned Chromium, --proxy-server, TLS 1.2; verification stays ON).
//   node e2e/engineers/first-tap.mjs
// Built 2026-10-11 so no run rebuilds it (the 10-10 and 10-11 runs each wrote it from scratch).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const CONTAINER = require('node:fs').existsSync('/opt/pw-browsers');
const exe = CONTAINER ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking', ...(CONTAINER ? ['--ssl-version-max=tls1.2'] : []), ...(CONTAINER && process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [])] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar' });
const page = await ctx.newPage();
const out = {};
const ms = () => Date.now();
// visible leaf elements whose text starts with a city word, and whether a count (digits) sits in the same row
const probe = (city) => page.evaluate((city) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight; };
  let names = 0, counts = 0;
  document.querySelectorAll('div,span').forEach((e) => {
    if (e.children.length > 0) return;
    const t = (e.innerText || '').trim();
    if (t !== city) return;
    if (!vis(e)) return;
    names++;
    let p = e.parentElement; for (let i = 0; i < 4 && p; i++) { if (/[0-9٠-٩][0-9٠-٩,٬.]{1,}/.test(p.innerText || '')) { counts++; break; } p = p.parentElement; }
  });
  return { names, counts, empty: /لا توجد إعلانات هنا حالياً|ما فيه إعلانات/.test(document.body.innerText) };
}, city);
const measure = async (label, city = 'الرياض', expectCounts = true) => {
  const t0 = ms(); let tn = null, tc = null;
  await page.click('[data-testid="city-input"]');
  while (ms() - t0 < 15000) {
    const r = await probe(city);
    if (r.names && tn === null) tn = ms() - t0;
    if (r.counts && tc === null) tc = ms() - t0;
    if (tn !== null && (tc !== null || !expectCounts)) break;
    await page.waitForTimeout(50);
  }
  out[label] = { names_ms: tn, counts_ms: tc };
  await page.keyboard.press('Escape').catch(() => {});
};
const clickLeaf = async (txt) => { const ok = await page.evaluate((txt) => { let best = null; document.querySelectorAll('div,span,button').forEach((e) => { if ((e.innerText || '').trim() !== txt) return; const r = e.getBoundingClientRect(); if (r.width && r.height && (!best || e.children.length <= best.children.length)) best = e; }); if (!best) return false; best.click(); return true; }, txt); return ok; };
const t_nav = ms();
await page.goto('https://ezhalah-app.vercel.app/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-testid="city-input"]', { timeout: 60000 });
out.page_ready_ms = ms() - t_nav;
await page.getByText('الضروري فقط').click({ timeout: 3000 }).catch(() => {});
await measure('cold_buy');
out.both_on = await clickLeaf('إيجار'); await page.waitForTimeout(300);
await measure('buy_plus_rent'); out.buy_off = await clickLeaf('شراء'); await page.waitForTimeout(300); await measure('rent_only');
// empty city under إيجار
await page.waitForTimeout(100);
const t1 = ms(); await page.click('[data-testid="city-input"]'); await page.fill('[data-testid="city-input"]', 'المرموثة');
let te = null, tnm = null;
while (ms() - t1 < 10000) { const r = await probe('المرموثة'); if (r.names && tnm === null) tnm = ms() - t1; if (r.empty && te === null) te = ms() - t1; if (te !== null && tnm !== null) break; await page.waitForTimeout(50); }
out.marmootha = { shown_ms: tnm, empty_note_ms: te };
const lim = (o) => o && o.names_ms !== null && o.names_ms < 1000 && o.counts_ms !== null && o.counts_ms < 3000;
out.verdict = lim(out.cold_buy) && lim(out.buy_plus_rent) && lim(out.rent_only) && out.marmootha.shown_ms !== null && out.marmootha.shown_ms < 1000 ? 'PASS' : 'FAIL';
console.log(JSON.stringify(out));
process.exitCode = out.verdict === 'PASS' ? 0 : 1;
await b.close();
