// Is «عرض المزيد» genuinely covered, or was the harness clicking mid-layout-shift?
//
// The 2026-09-22 sweep filed [show-more:الرياض/شقة] PAGER-CLICK — batch 2 timed out for the full
// 20s with Playwright reporting, over and over:
//     <div class="css-g5y9jx" data-expoimage="true"> ... subtree intercepts pointer events
//     element is not stable
// The locator was right (it resolved to data-testid="results-load-more"), so §41.3 is not the
// explanation. Two readings remain, and they call for opposite responses:
//
//   PRODUCT  — a card image sits ON TOP of the pager once batch 1 has revealed 100 cards, so a real
//              user cannot paginate at all on this cohort. A P0-shaped, user-visible defect.
//   HARNESS  — 100 card images are still loading and reflowing, so the button keeps moving out from
//              under the point Playwright computed. A human would simply press again and succeed.
//
// Hit-testing settles it. This probe reads document.elementFromPoint() at the pager's own centre
// REPEATEDLY once the page is quiet, which is the exact question "is something on top of it?" —
// and then tries an ordinary trusted click. §40.7: do not report a harness failure as a product
// failure, and do not hide a product failure as a harness one without proving it is one.
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
const CITY = process.env.PROBE_CITY || 'الرياض';
const TYPE = process.env.PROBE_TYPE || 'شقة';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launchOpts = () => ({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY },
        args: ['--no-sandbox', '--disable-quic', '--ignore-certificate-errors', '--ssl-version-max=tls1.2'] }
    : { args: ['--no-sandbox', '--disable-dev-shm-usage'] }),
});

// The pager, located the way showmore.mjs locates it: bottom-most «عرض المزيد» of real button
// height, never a card's own description expander (§41.3).
const PAGER_MIN_HEIGHT = 30;

async function pagerBox(page) {
  return page.evaluate((minH) => {
    const cands = [];
    for (const e of document.querySelectorAll('div')) {
      if ((e.innerText || '').trim() !== 'عرض المزيد') continue;
      const r = e.getBoundingClientRect();
      if (r.height >= minH) cands.push({ y: r.y, x: r.x, w: r.width, h: r.height, testid: e.getAttribute('data-testid') });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.y - b.y);
    return cands[cands.length - 1];
  }, PAGER_MIN_HEIGHT);
}

// What is actually at the pager's centre right now, and is the pager itself in that hit chain?
async function hitTest(page) {
  return page.evaluate((minH) => {
    const cands = [];
    for (const e of document.querySelectorAll('div')) {
      if ((e.innerText || '').trim() !== 'عرض المزيد') continue;
      const r = e.getBoundingClientRect();
      if (r.height >= minH) cands.push({ e, r });
    }
    if (!cands.length) return { pager: false };
    cands.sort((a, b) => a.r.y - b.r.y);
    const { e: btn, r } = cands[cands.length - 1];
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    // THE PAINTED STACK, never the singular elementFromPoint (repo rule, pinned by
    // scripts/verify-ownership-probes-use-the-painted-stack.ts). The singular form answers "what is
    // on top", which conflates two different findings here: a button genuinely buried under an
    // overlay, and a button merely sitting under its own child span. The plural form asks the
    // question this probe actually has — "is the pager painted at its own centre at all?" — and a
    // stack also NAMES what is in front of it, which is the evidence that decides product vs harness.
    const stack = document.elementsFromPoint(cx, cy);
    if (!stack.length) return { pager: true, top: null, covered: null, y: Math.round(r.y), inViewport: r.y >= 0 && r.bottom <= innerHeight };
    const idx = stack.findIndex((e) => e === btn || btn.contains(e) || e.contains(btn));
    const describe = (e) => (e.tagName || '')
      + (e.getAttribute?.('data-expoimage') ? '[expoimage]' : '')
      + (e.getAttribute?.('data-testid') ? `[${e.getAttribute('data-testid')}]` : '');
    return {
      pager: true,
      // Everything painted IN FRONT of the button — empty means nothing is covering it.
      inFront: (idx < 0 ? stack : stack.slice(0, idx)).map(describe).slice(0, 3).join('>'),
      top: describe(stack[0]),
      covered: idx !== 0,        // the button is not the front-most thing at its own centre
      absent: idx < 0,           // the button is not in the painted stack at all
      y: Math.round(r.y),
      inViewport: r.y >= 0 && r.bottom <= innerHeight,
    };
  }, PAGER_MIN_HEIGHT);
}

const cardCount = (page) =>
  page.evaluate(() => document.querySelectorAll('[data-testid="result-card"]').length
                   || (document.body.innerText.match(/#\d+/g) || []).length);

// §41.4: a stable count of 0 is not "settled" (the app types an intro before the first card), and
// the first non-zero reading is a half-drawn batch. Settled = non-zero AND unchanged for a while.
async function settleCards(page, { stableFor = 4, maxTries = 90 } = {}) {
  let last = -1, stable = 0;
  for (let i = 0; i < maxTries; i++) {
    const n = await cardCount(page);
    if (n > 0 && n === last) { if (++stable >= stableFor) return n; } else { stable = 0; }
    last = n;
    await sleep(1000);
  }
  return last;
}

(async () => {
  const browser = await chromium.launch(launchOpts());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const out = [];
  const log = (s) => { console.log(s); out.push(s); };

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(3000);

    // Same UI path a user walks: type the city, COMMIT it from the dropdown (§41.13 — an
    // uncommitted city is a deliberate refusal, not a broken search), pick the type, search.
    const input = page.locator('input').first();
    await input.click();
    await input.fill(CITY);
    await sleep(1800);
    await page.getByText(CITY, { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
    await sleep(800);
    const committed = await input.inputValue().catch(() => '');
    if (!committed.includes(CITY)) { log(`HARNESS: city never committed (input="${committed}") — no verdict`); throw new Error('city-not-committed'); }

    await page.getByText(TYPE, { exact: true }).first().click({ timeout: 15000 }).catch(() => {});
    await sleep(1200);
    await page.getByText('بحث', { exact: true }).first().click({ timeout: 20000 });

    // Cards drip in and the app types an intro first, so a stable count of 0 is NOT settled, and
    // neither is the FIRST non-zero count — it is a partially-rendered batch (§41.4). Wait until
    // the count has genuinely stopped growing.
    await settleCards(page);
    log(`after «بحث»: ${await cardCount(page)} cards`);

    for (let batch = 1; batch <= 2; batch++) {
      const box = await pagerBox(page);
      if (!box) { log(`batch ${batch}: NO PAGER on the page`); break; }
      log(`batch ${batch}: pager present testid=${box.testid} h=${Math.round(box.h)}`);

      await page.locator(`[data-testid="results-load-more"]`).last().scrollIntoViewIfNeeded().catch(() => {});

      // Let the page go genuinely quiet before asking "is it covered?" — the whole point is to
      // distinguish a transient overlap during reflow from a standing one.
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await sleep(2500);

      // Sample repeatedly at rest. A PERSISTENT cover is a product defect; a flickering one is
      // layout shift, i.e. the harness clicking into a moving target.
      const samples = [];
      for (let s = 0; s < 8; s++) { samples.push(await hitTest(page)); await sleep(500); }
      const covered = samples.filter((s) => s.covered === true).length;
      const ys = [...new Set(samples.map((s) => s.y))];
      log(`batch ${batch}: covered ${covered}/8 samples · distinct pager Y positions at rest: ${ys.length} (${ys.join(',')}) `
        + `· front=${samples.at(-1)?.inFront || '(nothing)'} · top=${samples.at(-1)?.top}`);

      const before = await cardCount(page);
      const t0 = Date.now();
      let clickErr = null;
      await page.locator('[data-testid="results-load-more"]').last()
        .click({ timeout: 25000 }).catch((e) => { clickErr = e.message.split('\n')[0]; });
      log(`batch ${batch}: click ${clickErr ? 'FAILED: ' + clickErr : 'OK'} in ${Date.now() - t0}ms`);

      for (let i = 0; i < 40; i++) { if (await cardCount(page) > before) break; await sleep(1000); }
      await settleCards(page);
      log(`batch ${batch}: cards ${before} → ${await cardCount(page)}`);

      if (clickErr) {
        // The click failed. Decide WHY, from the hit-test evidence rather than from the timeout.
        if (covered >= 7) log(`VERDICT batch ${batch}: PRODUCT — the pager is persistently covered at rest (${covered}/8)`);
        else if (ys.length > 1) log(`VERDICT batch ${batch}: HARNESS — the pager is still MOVING at rest (${ys.length} Y positions); click raced layout`);
        else log(`VERDICT batch ${batch}: UNDECIDED — not covered at rest and not moving, yet the click failed`);
      } else {
        log(`VERDICT batch ${batch}: PAGER WORKS — an ordinary trusted click paginated`);
      }
    }
  } catch (e) {
    log(`probe error: ${e.message}`);
  } finally {
    await browser.close();
  }
})();
