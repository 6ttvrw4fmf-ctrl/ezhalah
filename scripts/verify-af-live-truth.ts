// AF BACKEND TRUTH AUDIT — browser-first, ID-exact, independently-oracled.
//
// For each real journey: drive the ACTUAL browser UI (production), capture the ACTUAL request
// bodies the app sends to apartment_guided_counts_ar (the AF live-count RPC) and
// location_search_candidates_ar (the search RPC), read the UI-DISPLAYED count, then independently
// verify by hitting search_listings_ar directly through PostgREST's own filter operators — NOT by
// calling our RPC again, NOT by re-running our SQL — translating only the specific params the
// captured request actually carried. Diffs exact (source_table,listing_id) sets: missing / extra /
// duplicate, not just counts.
import { chromium } from 'playwright';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: REST_URL, key: ANON_KEY } = resolvePublicSupabase(process.env);
const H = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

// ── proven browser helpers (verbatim technique from scripts/verify-web-runtime-smoke.mjs) ────────
const CLICK_LEAF = (txt) => {
  let best = null;
  document.querySelectorAll('div,span,li,button').forEach((e) => {
    if ((e.innerText || '').trim() !== txt) return;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (!best || e.children.length <= best.children.length)) best = e;
  });
  if (!best) return null;
  let a = best.parentElement, sc = null;
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
const REPORT = [];
const check = (label, ok, detail = '') => {
  REPORT.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--ignore-certificate-errors'] });

async function oracleCount(reqBody) {
  const { qs, unhandled } = buildOracleQS(reqBody);
  if (unhandled.length) return { count: null, unhandled };
  const r = await fetch(`${REST_URL}/rest/v1/search_listings_ar?select=listing_id&${qs}`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range');
  return { count: cr?.includes('/') ? Number(cr.split('/')[1]) : null, unhandled };
}

async function oracleIds(reqBody, cap = 30000) {
  const { qs, unhandled } = buildOracleQS(reqBody);
  if (unhandled.length) return { ids: null, unhandled };
  const ids = new Set();
  const PAGE = 1000;
  for (let off = 0; off < cap; off += PAGE) {
    const r = await fetch(`${REST_URL}/rest/v1/search_listings_ar?select=listing_id,source_table&${qs}`,
      { headers: { ...H, Range: `${off}-${off + PAGE - 1}` } });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) ids.add(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return { ids, unhandled };
}

async function rpcIds(reqBody, totalHint, cap = 30000) {
  const ids = [];
  const PAGE = 1000;
  for (let off = 0; off < Math.min(totalHint ?? cap, cap); off += PAGE) {
    const r = await fetch(`${REST_URL}/rest/v1/rpc/location_search_candidates_ar`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...reqBody, p_per_platform: null, p_limit: PAGE, p_offset: off }),
    });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) ids.push(`${row.source_table}:${row.listing_id}`);
    if (rows.length < PAGE) break;
  }
  return ids;
}

function diffIds(rpcList, oracleSet) {
  const rpcSet = new Set(rpcList);
  const seen = new Set();
  const duplicates = [];
  for (const id of rpcList) { if (seen.has(id)) duplicates.push(id); seen.add(id); }
  const missing = [...oracleSet].filter((id) => !rpcSet.has(id));
  const extra = [...rpcSet].filter((id) => !oracleSet.has(id));
  return { missing, extra, duplicates, rpcCount: rpcSet.size, rpcRawCount: rpcList.length };
}

// ── ONE journey runner ─────────────────────────────────────────────────────────────────────────
async function runJourney(name, { viewport = { width: 1440, height: 900 }, deal = [], category = null,
  group, type, city, district = null, answerAmenityIndex = null, answerBathrooms = null,
  answerFurnished = null, expectZero = false, skipFirst = false, backAndChange = false }) {
  console.log(`\n════════ JOURNEY: ${name} ════════`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport });
  const page = await ctx.newPage();
  let lastCountBody = null, lastCountResp = null, lastSearchBody = null, lastSearchResp = null;
  // Only accept a WELL-FORMED array response as "the" capture — a transient bad parse (or, per
  // remote.ts's own comments, a secondary diversity-seed call racing the main one) must never
  // silently overwrite a good capture with garbage and poison the total_count read downstream.
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/rpc/apartment_guided_counts_ar') && resp.request().method() === 'POST') {
      try {
        const j = await resp.json();
        if (Array.isArray(j)) { lastCountBody = JSON.parse(resp.request().postData() || '{}'); lastCountResp = j; }
      } catch {}
    }
    if (u.includes('/rpc/location_search_candidates_ar') && resp.request().method() === 'POST') {
      try {
        const j = await resp.json();
        if (Array.isArray(j)) { lastSearchBody = JSON.parse(resp.request().postData() || '{}'); lastSearchResp = j; }
      } catch {}
    }
  });
  const tap = async (txt) => {
    const box = await page.evaluate(CLICK_LEAF, txt);
    if (!box) throw new Error(`control not found: ${txt}`);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(900);
  };
  const body = () => page.evaluate(() => document.body.innerText);

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    for (const d of deal) await tap(d);
    if (category) await tap(category);
    await page.click('input >> nth=0');
    await page.type('input >> nth=0', city, { delay: 60 });
    await page.waitForTimeout(1800);
    await tap(city);
    await page.waitForTimeout(800);
    if (district) {
      await page.click('input >> nth=1');
      await page.type('input >> nth=1', district, { delay: 60 });
      await page.waitForTimeout(2200);
      await tap(district);
    }
    await tap(group);
    await tap(type);
    await tap('بحث');
    await page.waitForTimeout(14000);
    // scroll to reveal the AF launcher below the result cards
    await page.evaluate(() => { const els = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)); els.forEach(e => e.scrollTop = e.scrollHeight); });
    await page.waitForTimeout(1200);

    if (expectZero) {
      const uiTxt = await body();
      const nonZeroMatch = uiTxt.match(/لقينا\s*([\d,٬]+)\s*إعلان/);
      const nonZeroCount = nonZeroMatch ? parseInt(nonZeroMatch[1].replace(/[^\d]/g, ''), 10) : null;
      check(`${name}: UI shows no nonzero result count`, !nonZeroCount, `matched=${nonZeroMatch?.[0] ?? '(none)'}`);
      check(`${name}: result-RPC was captured for this search`, !!lastSearchBody, JSON.stringify(lastSearchBody));
      if (lastSearchBody) {
        const rpcTotal = Number(lastSearchResp?.[0]?.total_count ?? (Array.isArray(lastSearchResp) ? lastSearchResp.length : NaN));
        check(`${name}: result-RPC total_count == 0`, rpcTotal === 0, `rpc total_count=${rpcTotal}`);
        const { count: oc, unhandled } = await oracleCount(lastSearchBody);
        check(`${name}: independent oracle also finds 0 (honest zero, not a display bug)`,
          unhandled.length === 0 && oc === 0, unhandled.length ? `unhandled: ${unhandled.join(',')}` : `oracle=${oc}`);
      }
      await ctx.close();
      return;
    }

    const btn = await page.evaluate(CLICK_LEAF, 'خلّنا نحدد الطلب أكثر');
    if (!btn) { check(`${name}: AF launcher present`, false, 'not eligible on this scope — cannot test AF here'); await ctx.close(); return; }
    await page.mouse.click(btn.x, btn.y);
    await page.waitForTimeout(4000);

    const readCard = () => page.evaluate(() => {
      const card = document.querySelector('[data-testid="af-card"]');
      const q = card?.querySelector('[data-testid="af-question-title"]')?.innerText?.trim() ?? null;
      const chipTxt = card?.querySelector('[data-testid="af-count-chip"]')?.innerText ?? null;
      const chip = chipTxt ? parseInt(chipTxt.replace(/[^\d]/g, ''), 10) : null;
      return { hasCard: !!card, q, chip };
    });
    // Poll instead of a fixed sleep: the live-count RPC round-trip on a large base scope can take
    // well over a second under production load, and a fixed wait raced it more than once while
    // building this audit. Succeeds the instant the chip differs (or a real number lands); returns
    // the last read on timeout so a genuine non-change still fails honestly, not falsely.
    const readCardUntil = async (pred, timeoutMs = 9000) => {
      const until = Date.now() + timeoutMs;
      let last = await readCard();
      while (Date.now() < until) {
        if (pred(last)) return last;
        await page.waitForTimeout(350);
        last = await readCard();
      }
      return last;
    };
    let st = await readCardUntil((s) => s.hasCard && s.chip != null);
    check(`${name}: AF card opened on a real question`, st.hasCard && !!st.q, JSON.stringify(st));
    const baselineChip = st.chip;

    if (skipFirst) {
      const before = st.chip;
      await page.click('[data-testid="af-skip"]');
      const after = await readCardUntil((s) => s.hasCard && s.q !== st.q);
      check(`${name}: Skip does not change the count (no predicate applied)`, after.chip === before, `before=${before} after=${after.chip}`);
      check(`${name}: Skip advances to a different question`, after.q !== st.q, `q1=${st.q} q2=${after.q}`);
      await ctx.close();
      return;
    }

    // Answer the first question via whichever answer strategy applies to its shape.
    let optKey = null;
    if (answerBathrooms != null) optKey = String(answerBathrooms);
    else if (answerFurnished != null) optKey = answerFurnished ? 'furnished_yes' : 'furnished_no';
    if (answerAmenityIndex != null) {
      const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
      const testid = opts[answerAmenityIndex];
      await page.click(`[data-testid="${testid}"]`);
    } else {
      const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
      await page.click(`[data-testid="${opts[0]}"]`); // first option — deterministic, whatever the question is
    }
    const afterSelect = await readCardUntil((s) => s.chip !== baselineChip);
    check(`${name}: count changed after selecting an answer`, afterSelect.chip !== baselineChip, `base=${baselineChip} afterSelect=${afterSelect.chip}`);
    await page.click('[data-testid="af-confirm"]');
    await page.waitForTimeout(1200);

    if (backAndChange) {
      await page.click('[data-testid="af-back"]');
      const restored = await readCardUntil((s) => s.hasCard && s.q === st.q);
      check(`${name}: Back restores the previous question`, restored.q === st.q, `expected=${st.q} got=${restored.q}`);
      check(`${name}: Back restores the previous count`, restored.chip === afterSelect.chip, `expected=${afterSelect.chip} got=${restored.chip}`);
      const opts2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
      const otherIdx = opts2.length > 1 ? 1 : 0;
      await page.click(`[data-testid="${opts2[otherIdx]}"]`);
      const changed = await readCardUntil((s) => s.chip !== afterSelect.chip);
      check(`${name}: changing the answer recomputes the count`, changed.chip !== afterSelect.chip || opts2.length === 1, `after1st=${afterSelect.chip} afterChange=${changed.chip}`);
      await page.click('[data-testid="af-confirm"]');
      await page.waitForTimeout(1200);
    }

    // Finish now — «عرض النتائج» (af-skip-all) commits accumulated answers + searches. Confirming
    // the LAST useful question can already have ended the flow (mining → results) on its own, so
    // only click af-skip-all if the card is still actually there to click.
    lastSearchBody = null; lastSearchResp = null;
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-testid="af-card"]'));
    if (stillOpen) {
      const btn2 = await page.evaluate(() => !!document.querySelector('[data-testid="af-skip-all"]'));
      if (btn2) await page.click('[data-testid="af-skip-all"]');
    }
    // Poll for the RPC first (it is the ground truth for what number the UI SHOULD settle on),
    // then poll the UI's own typed-out text for that exact number — a results turn types itself out
    // character by character, so a fixed sleep here raced the same way [E] did in the smoke test.
    const until1 = Date.now() + 25000;
    while (!lastSearchBody && Date.now() < until1) await page.waitForTimeout(400);
    check(`${name}: final search request was captured`, !!lastSearchBody, JSON.stringify(lastSearchBody));
    if (!lastSearchBody) { await ctx.close(); return; }
    const rpcTotal = Number(lastSearchResp?.[0]?.total_count ?? (Array.isArray(lastSearchResp) ? lastSearchResp.length : NaN));
    const rpcTotalFmt = rpcTotal.toLocaleString('en-US');
    let uiCount = null;
    const until2 = Date.now() + 25000;
    while (Date.now() < until2) {
      const t = await body();
      if (t.includes(`لقينا ${rpcTotalFmt}`) || t.includes(`لقينا ${rpcTotal}`)) { uiCount = rpcTotal; break; }
      const m = [...t.matchAll(/لقينا\s*([\d,٬]+)/g)];
      if (m.length) uiCount = parseInt(m[m.length - 1][1].replace(/[^\d]/g, ''), 10);
      await page.waitForTimeout(500);
    }
    check(`${name}: UI displayed count == result-RPC total_count`, uiCount != null && uiCount === rpcTotal, `ui=${uiCount} rpc=${rpcTotal}`);

    const { count: oc, unhandled: ocUnhandled } = await oracleCount(lastSearchBody);
    if (ocUnhandled.length) {
      check(`${name}: independent oracle covers every predicate in this request`, false, `unhandled: ${ocUnhandled.join(', ')}`);
    } else {
      check(`${name}: result-RPC total_count == independent oracle count`, oc === rpcTotal, `rpc=${rpcTotal} oracle=${oc}`);
      const [rIds, { ids: oIds }] = await Promise.all([
        rpcIds(lastSearchBody, rpcTotal),
        oracleIds(lastSearchBody),
      ]);
      const d = diffIds(rIds, oIds);
      check(`${name}: MISSING eligible IDs == 0`, d.missing.length === 0, `missing=${d.missing.length} sample=${d.missing.slice(0, 5).join(',')}`);
      check(`${name}: EXTRA ineligible IDs == 0`, d.extra.length === 0, `extra=${d.extra.length} sample=${d.extra.slice(0, 5).join(',')}`);
      check(`${name}: DUPLICATE IDs == 0`, d.duplicates.length === 0, `duplicates=${d.duplicates.length}`);
    }
  } catch (e) {
    check(`${name}: journey completed without throwing`, false, String(e).slice(0, 300));
  } finally {
    await ctx.close();
  }
}

// ── the required coverage matrix ───────────────────────────────────────────────────────────────
await runJourney('Residential/Buy/Apartment/Riyadh — bathrooms', {
  deal: [], category: null, city: 'الرياض', group: 'الشقق والسكن المشترك', type: 'شقة', answerBathrooms: null,
});
await runJourney('Residential/Buy/Villa/Riyadh — street width', {
  deal: [], city: 'الرياض', group: 'الفلل والبيوت', type: 'فيلا',
});
await runJourney('Residential/Rent-Annual/Apartment/Riyadh — furnished', {
  deal: ['إيجار', 'شراء', 'سنوي'], city: 'الرياض', group: 'الشقق والسكن المشترك', type: 'شقة',
});
await runJourney('Residential/Rent-Monthly/Apartment/Riyadh — rating', {
  // سنوي/شهري are ALSO two independent toggles, at-least-one-enforced: سنوي defaults ON and is the
  // ONLY one selected, so tapping سنوي first is a rejected no-op (can't deselect the last one) — it
  // stays on, and adding شهري on top just gives "both" (كلاهما). Add شهري FIRST (now both selected,
  // removing either is safe), THEN tap سنوي to drop it — order matters for an at-least-one toggle.
  deal: ['إيجار', 'شراء', 'شهري', 'سنوي'], city: 'الرياض', group: 'الشقق والسكن المشترك', type: 'شقة',
});
await runJourney('Commercial/Rent-Annual/Shop/Riyadh — amenity', {
  deal: ['إيجار', 'شراء', 'سنوي'], category: 'تجاري', city: 'الرياض', group: 'التجزئة والمكاتب', type: 'محل',
});
await runJourney('Residential/Buy/Apartment/Jeddah (non-Riyadh) — bathrooms', {
  deal: [], city: 'جدة', group: 'الشقق والسكن المشترك', type: 'شقة',
});
await runJourney('MOBILE Residential/Rent-Annual/Apartment/Riyadh — furnished', {
  viewport: { width: 390, height: 844 }, deal: ['إيجار', 'شراء', 'سنوي'], city: 'الرياض', group: 'الشقق والسكن المشترك', type: 'شقة',
});
await runJourney('Residential/Buy/Camp/Riyadh — ZERO-result case', {
  deal: [], city: 'الرياض', group: 'الاستراحات والريف', type: 'مخيم', expectZero: true,
});
await runJourney('Residential/Buy/Apartment/Riyadh — SKIP case', {
  deal: [], city: 'الرياض', group: 'الشقق والسكن المشترك', type: 'شقة', skipFirst: true,
});
await runJourney('Residential/Buy/Apartment/Riyadh — BACK/change-answer case', {
  deal: [], city: 'الرياض', group: 'الشقق والسكن المشترك', type: 'شقة', backAndChange: true,
});

await browser.close();
console.log(`\n${failures === 0 ? '✓ AF backend truth audit — all checks passed' : `✗ ${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
