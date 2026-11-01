#!/usr/bin/env node
// THE UI BATTERY (owner 2026-10-11: «test it like a real user, in front of me»): types real searches into the LIVE app in a real
// browser, one fresh phone session per message, and reports what the user would SEE: how many results, the summary lines, whether the
// page said «no results», and whether any summary line is absurd (a size of 3 m² from «تحت ٣ مليون»).
//
//   node scripts/agent-ui-battery.mjs                      # all cases against https://ezhalah-app.vercel.app
//   BASE=http://localhost:8811 node …                       # a local build
//   ONLY=budget node …  /  N=10 node …  /  CONC=3 node …
// Needs @playwright/test (the repo's own dev dependency) and its Chromium.
import './lib/robotPass.mjs'; // robot pass: our own robot is never blocked by the network guard or bot checks (docs/ops/SCRAPE_GUARD.md)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('@playwright/test');

const BASE = process.env.BASE || 'https://ezhalah-app.vercel.app';
const W = Number(process.env.WAIT || 38000);

const C = (g, text, expect = {}) => ({ g, text, expect });
const CASES = [
  // the budget phrasings that once became «area up to 3 m²» (the «م» of «مليون» read as metres)
  C('budget', 'فيلا للبيع في جدة تحت ٣ مليون'), C('budget', 'شقة للبيع في الرياض اقل من ٢ مليون'), C('budget', 'فيلا للبيع في الدمام من ١ الى ٣ مليون'),
  C('budget', 'بيت للبيع في الخبر بين ٢ و ٤ مليون'), C('budget', 'ارض للبيع في الخرج تحت مليون'), C('budget', 'فيلا في الرياض ما تتجاوز ٥ مليون'), C('budget', 'villa for sale in Jeddah up to 3 million'),
  C('budget', 'شقة للإيجار في الرياض ٦٠ ألف بالسنة'), C('budget', 'شقة للإيجار في جدة تحت ٥٠ ألف'), C('budget', 'ابغى شقة ٥ آلاف شهري في الخبر'),
  C('plain', 'شقة ٣ غرف للإيجار في الرياض'), C('plain', 'شقة للإيجار في جدة'), C('plain', 'فيلا للبيع في الدمام'), C('plain', 'ارض للبيع في الرياض'), C('plain', 'مكتب للإيجار في الرياض'),
  C('plain', 'مستودع للإيجار في الدمام'), C('plain', 'محل للإيجار في جدة'), C('plain', 'استراحة للإيجار في الرياض'), C('plain', 'دور للبيع في الطائف'), C('plain', 'شقة للبيع في مكة'),
  C('plain', 'شقة للإيجار في المدينة المنورة'), C('plain', 'فيلا للإيجار في أبها'), C('plain', 'شقة للإيجار في بريدة'), C('plain', 'شقة للإيجار في تبوك'), C('plain', 'apartment for rent in Riyadh'), C('plain', 'villa for sale in Jeddah'),
  C('size', 'فيلا مساحتها فوق ٥٠٠ متر في الرياض'), C('size', 'ارض ١٠٠٠ متر في الرياض سعر المتر ٢٠٠٠'), C('size', 'شقة في الرياض ما تزيد عن ١٢٠ متر'), C('size', 'ابي بيت كبير في الرياض'),
  C('extras', 'شقة في الرياض فيها مصعد'), C('extras', 'فيلا في جدة فيها مسبح'), C('extras', 'استراحة للإيجار في الرياض بمسبح'), C('extras', 'شقة مفروشة للإيجار في جدة'),
  C('currency', 'ابغى شقة ٢٠٠٠ دولار شهري في الرياض'), C('currency', 'ابي بيت في الرياض مع غرفة للخادمة الحد الأقصى لي هو خمس مليون دينار'),
  C('district', 'شقة في حي النرجس الرياض'), C('district', 'فيلا في حي الشاطئ جدة'), C('district', 'شقة في العليا الرياض للإيجار'),
  C('personal', 'عائلتي ٥ وابغى شقة في الرياض'), C('personal', 'ابي شقة هادية وراقية في جدة'),
];

let list = CASES;
if (process.env.ONLY) list = list.filter((c) => c.g === process.env.ONLY);
if (process.env.N) list = list.slice(0, Number(process.env.N));

const browser = await chromium.launch();
async function one(c) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load' }); await page.waitForTimeout(4500);
    const b = page.getByText('الضروري فقط', { exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    await page.locator('[role="tab"]').nth(1).click(); await page.waitForTimeout(2500);
    const box = page.locator('textarea, input[type="text"]').last();
    await box.click(); await box.type(c.text, { delay: 20 }); await page.keyboard.press('Enter');
    let body = '';
    for (let waited = 0; waited < W; waited += 3000) {
      await page.waitForTimeout(3000);
      body = await page.evaluate(() => document.body.innerText);
      if (/#1\n/.test(body) || /ما لقينا نتائج|لا توجد نتائج|عذراً، ما لقينا/.test(body)) break;
    }
    const head = body.split(/#1\n/)[0];                              // everything the bot says BEFORE the first card (cards carry source text)
    const lines = head.split('\n').filter((l) => /^•/.test(l.trim())).map((l) => l.replace(/^•\s*/, '').trim());
    const count = (body.match(/(\d[\d,]*)\s*(?:نتيجة|إعلان)/) || [])[1];
    const cards = (body.match(/#\d+\n/g) || []).length;
    const none = /ما لقينا نتائج|لا توجد نتائج|عذراً، ما لقينا/.test(body);
    // MATCH FIRST, THEN DIVERSIFY THE PLATFORMS (permanent rule): the sites of the cards, in order
    const sites = [...body.split(/#1\n/).slice(1).join('#1\n').matchAll(/(?:^|\n)((?:[a-z0-9-]+\.)+(?:sa|com|fm|app|net|co|org|io|me))\n/g)].map((m) => m[1]).slice(0, 12);
    const flags = [];
    if (none || cards === 0) flags.push('NO-RESULTS');
    const size = lines.find((l) => /^(?:المساحة|Size)/.test(l));
    if (size && /م²/.test(size) && /(?:إلى|To)\s*[1-9]\s*م²/.test(size)) flags.push('ABSURD-SIZE');
    if (/[-‐-―−]/.test(head.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ''))) flags.push('DASH-IN-CHAT');
    const top = sites.slice(0, 10), share = top.length ? Math.max(...Object.values(top.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {}))) / top.length : 0;
    if (top.length >= 8 && share > 0.7 && Number((count || '0').replace(/,/g, '')) > 300) flags.push(`ONE-SITE(${Math.round(share * 100)}%)`);
    return { c, count, cards, lines, flags, sites };
  } catch (e) { return { c, flags: ['ERROR ' + String(e.message).slice(0, 60)], lines: [] }; } finally { await ctx.close(); }
}
const out = []; let i = 0;
await Promise.all(Array.from({ length: Number(process.env.CONC || 3) }, async () => { while (i < list.length) { const c = list[i++]; const r = await one(c); out.push(r); console.error(`  ${out.length}/${list.length} ${r.flags.length ? '⚠' : '✓'} ${c.text.slice(0, 40)}`); } }));
await browser.close();

const bad = out.filter((r) => r.flags.length);
console.log(`\n${out.length} searches typed into ${BASE} · ${out.length - bad.length} showed results and looked right · ${bad.length} need a look`);
for (const r of out.sort((a, b) => a.c.g.localeCompare(b.c.g))) console.log(`${r.flags.length ? '⚠' : '✓'} [${r.c.g}] «${r.c.text}» → ${r.count ?? '-'} results, ${r.cards ?? 0} cards on screen${r.flags.length ? '  ' + r.flags.join(',') : ''}\n      ${r.lines.join(' · ')}\n      sites: ${(r.sites ?? []).join(' ')}`);
process.exit(bad.length ? 1 : 0);
