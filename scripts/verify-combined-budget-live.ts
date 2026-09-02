// THE COMBINED-BUDGET FIX, PROVEN IN A REAL BROWSER AGAINST PRODUCTION.
//
// scripts/verify-combined-deal-budget-split.ts proves the shipped predicate is correct, offline and
// mutation-hard. It cannot prove the thing the owner actually asked about: that a real person,
// clicking real controls on the deployed bundle, gets the rent listings they asked for.
//
// THE JOURNEY:
//
//   1. Residential · الرياض · شقة, with BOTH شراء and إيجار selected (combined mode)
//   2. type a BUY floor of 500,000 into the «Buy budget» box — and nothing into the Rent one
//   3. بحث
//   4. the request must be a combined one (p_deal null, p_price_min 500000, no rent bound)
//   5. the RESULTS must still contain rent cards
//
// Step 5 is the whole test. In combined mode the RPC bounds 'بيع' rows by p_price_min/max on
// price_total and 'إيجار' rows by p_price_min_rent/max_rent on price_annual — so with no rent bound
// sent, every rent row the cohort has comes back. The pre-fix client then re-applied the BUY pair to
// every returned row, and a Riyadh apartment's annual rent is nowhere near 500,000 SAR, so the user
// saw a Buy-only page while the headline count (which comes from the RPC) still counted the rent
// rows it had deleted.
//
// A rent card is identified by the suffix the card itself prints — «/سنوياً» or «/شهرياً»
// (src/i18n.tsx localises listingPriceString's /yr and /mo). A Buy card prints no suffix, so the
// presence of even one suffixed card is proof the rent side survived to the screen.
//
// LIVE CHECK — excluded from `npm test`, runs in .github/workflows/af-live-truth-check.yml.

import { chromium } from 'playwright';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const BASE = 'https://ezhalah-app.vercel.app';
// Resolved through the shared helper, never a repo secret, so the check is self-sufficient in a
// scheduled run — and so it asserts WHICH backend it proved something about.
const { url: EXPECTED_SUPABASE } = resolvePublicSupabase(process.env);

const CLICK_LEAF = (txt: string) => {
  let best: any = null;
  document.querySelectorAll('div,span,li,button').forEach((e: any) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc: any = null;
  while (a) {
    const s = getComputedStyle(a);
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight) { sc = a; break; }
    a = a.parentElement;
  }
  if (sc) { const er = best.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += (er.top - sr.top) - sc.clientHeight / 2 + er.height / 2; }
  else best.scrollIntoView({ block: 'center' });
  const r = best.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

const BUY_FLOOR = 500000;

const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
         ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
});

const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const searches: any[] = [];
const searchOrigins = new Set<string>();
// The candidate RPC returns KEYS ONLY — (source_table, listing_id, platform, …), no deal column —
// so it cannot tell us whether rent rows came back. (A first draft of this file filtered its rows on
// `deal_ar` and "found" 0 rent rows in a 1,500-row response: the harness was wrong, not production.)
// The rows the app will actually RENDER arrive in the hydration GETs against the platform tables,
// which carry LIST_SELECT — including `transaction_type` and `rent_period`. Count those.
const hydrated: any[] = [];
page.on('response', async (r) => {
  const url = r.url();
  if (url.includes('/rpc/location_search_candidates_ar') && r.request().method() === 'POST') {
    try { searchOrigins.add(new URL(url).origin); } catch {}
    try {
      const j = await r.json();
      if (Array.isArray(j)) searches.push(JSON.parse(r.request().postData() || '{}'));
    } catch {}
    return;
  }
  if (!url.includes('/rest/v1/') || url.includes('/rpc/')) return;
  try {
    const j = await r.json();
    if (Array.isArray(j) && j.length && typeof j[0] === 'object' && j[0] && 'transaction_type' in j[0]) {
      hydrated.push(...j);
    }
  } catch {}
});

const tap = async (txt: string, timeoutMs = 10000) => {
  const until = Date.now() + timeoutMs;
  let box: any = null;
  while (Date.now() < until) {
    box = await page.evaluate(CLICK_LEAF, txt);
    if (box) break;
    await page.waitForTimeout(300);
  }
  if (!box) throw new Error(`control never rendered: ${txt}`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // ── 1. city + category + type ─────────────────────────────────────────────────────────────────
  await page.click('[data-testid="city-input"]');
  await page.fill('[data-testid="city-input"]', 'الرياض');
  await tap('الرياض').catch(() => {});
  await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
  await tap('الشقق والسكن المشترك');
  await tap('شقة');

  // ── 2. BOTH deals — the boxes are independent toggles, so tapping the unselected one adds it ───
  // The Filter opens on a single deal; tapping the other gives Buy AND Rent, which is the combined
  // mode this journey is about. The helper line «لكل واحد ميزانيته» renders only in that state, so
  // its presence is the assertion that we really got there rather than merely switching deals.
  await tap('شراء').catch(() => {});
  await tap('إيجار').catch(() => {});
  const combined = await page.evaluate(() =>
    document.body.innerText.includes('لكل واحد ميزانيته') || document.body.innerText.includes('ميزانية الشراء'));
  check('the Filter is in COMBINED شراء+إيجار mode (both budget boxes shown)', combined,
    'the two-budget helper never appeared — the journey below would be testing single-deal search');

  // ── 3. the BUY floor only; the Rent box stays empty ───────────────────────────────────────────
  await page.click('[data-testid="price-min-input"]');
  await page.fill('[data-testid="price-min-input"]', String(BUY_FLOOR));
  await page.waitForTimeout(600);

  await tap('بحث');
  await page.waitForTimeout(16000);

  // ── 4. the request really is the combined shape this test needs ───────────────────────────────
  const req = searches[searches.length - 1] ?? {};
  check(`the browser talked to the expected backend (${EXPECTED_SUPABASE})`,
    searchOrigins.size === 1 && searchOrigins.has(EXPECTED_SUPABASE),
    `origins seen: ${[...searchOrigins].join(', ') || '(no search request captured)'}`);
  check('p_deal is null — the RPC is being asked for Buy AND Rent in one set', req.p_deal == null,
    `p_deal=${JSON.stringify(req.p_deal)}`);
  check(`the Buy floor reached the RPC as p_price_min=${BUY_FLOOR}`, Number(req.p_price_min) === BUY_FLOOR,
    `p_price_min=${JSON.stringify(req.p_price_min)}`);
  check('no rent bound was sent, so the RPC returns the cohort\'s rent rows unbounded',
    req.p_price_min_rent == null && req.p_price_max_rent == null,
    `p_price_min_rent=${JSON.stringify(req.p_price_min_rent)} p_price_max_rent=${JSON.stringify(req.p_price_max_rent)}`);

  const rentRows = hydrated.filter((r: any) => r.transaction_type === 'Rent');
  const cheapRent = rentRows.filter((r: any) => Number(r.price_annual) > 0 && Number(r.price_annual) < BUY_FLOOR);
  check('the backend handed the app rent rows (otherwise step 5 could pass vacuously)',
    rentRows.length > 0, `${rentRows.length} rent row(s) of ${hydrated.length} hydrated`);
  check(`...and some are priced BELOW the ${BUY_FLOOR.toLocaleString('en-US')} Buy floor — exactly what the old code deleted`,
    cheapRent.length > 0,
    `${cheapRent.length} rent row(s) under the Buy floor; without one, the Buy floor would not have bitten `
    + 'and this journey could not distinguish the fixed code from the broken code');

  // ── 5. THE TEST: those rent rows must reach the screen ────────────────────────────────────────
  const shown = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      annual: (txt.match(/\/\s*سنوياً/g) || []).length,
      monthly: (txt.match(/\/\s*شهرياً/g) || []).length,
      sar: (txt.match(/ر\.?س|SAR/g) || []).length,
    };
  });
  check('RENT cards are on screen — the Buy floor did not delete them',
    shown.annual + shown.monthly > 0,
    `rent-suffixed prices rendered: ${shown.annual} «/سنوياً» + ${shown.monthly} «/شهرياً» `
    + `(price-bearing text nodes: ${shown.sar}). Zero here with rent rows in the RPC response is the `
    + 'pre-2026-09-02 defect: priceFilter() applied the BUY pair to every row, rent included.');
} catch (e) {
  check('the journey ran to completion', false, String(e));
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n✗ ${failures} check(s) FAILED — a combined Buy+Rent search is not showing the rent side\n`);
  process.exit(1);
}
console.log('\n✓ a combined Buy+Rent search shows BOTH sides in a real browser: each budget binds only its own deal\n');
