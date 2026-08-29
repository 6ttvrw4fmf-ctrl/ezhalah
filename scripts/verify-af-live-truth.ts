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

// CATEGORY PURITY NEEDS THE SAME REFERENCE TABLE PRODUCTION USES (2026-08-28). p_category is a real
// predicate — a `both`-macro type is eligible only from the table matching the requested category —
// so the oracle now REFUSES a request carrying p_category without this map rather than silently
// ignoring it. Read from known_type_ar itself, which is what af_eligibility_clause() joins against,
// so the oracle stays genuinely independent of our own SQL rather than of our own constants.
const TYPE_MACROS = await (async () => {
  const r = await fetch(`${REST_URL}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H });
  if (!r.ok) throw new Error(`known_type_ar unreadable (${r.status}) — the oracle cannot apply category purity`);
  return Object.fromEntries((await r.json()).map((x) => [x.type_ar, x.macro]));
})();
const ORACLE_OPTS = { typeMacros: TYPE_MACROS };

async function oracleCount(reqBody) {
  const { qs, unhandled } = buildOracleQS(reqBody, ORACLE_OPTS);
  if (unhandled.length) return { count: null, unhandled };
  const r = await fetch(`${REST_URL}/rest/v1/search_listings_ar?select=listing_id&${qs}`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const cr = r.headers.get('content-range');
  return { count: cr?.includes('/') ? Number(cr.split('/')[1]) : null, unhandled };
}

async function oracleIds(reqBody, cap = 30000) {
  const { qs, unhandled } = buildOracleQS(reqBody, ORACLE_OPTS);
  if (unhandled.length) return { ids: null, unhandled };
  const ids = new Set();
  const PAGE = 1000;
  for (let off = 0; off < cap; off += PAGE) {
    // A Range-paged PostgREST query MUST carry an explicit total order (fix 2026-08-28). Without
    // `order=`, Postgres is free to return rows in a different sequence per page request, so paging
    // silently drops or repeats rows across page boundaries. Measured on جدة / Villa+Duplex / Buy:
    // unordered paging returned 3,866 of 3,867 on three consecutive passes — a phantom "1 MISSING
    // eligible ID" against a set the RPC had exactly right. That is a false alarm on the very check
    // that certifies AF returns the correct listings, and the same instability could just as easily
    // have hidden a real missing row. (source_table, listing_id) is unique, so it is a total order.
    const r = await fetch(`${REST_URL}/rest/v1/search_listings_ar?select=listing_id,source_table&${qs}&order=source_table.asc,listing_id.asc`,
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
  // A GitHub Actions runner measurably slower than a laptop turned this exact race real in CI
  // (run 32730730607, 2026-08-24): the city-suggestion row rendered after this journey's fixed
  // wait had already elapsed, so the strict tap threw "control not found: الرياض" — the same class
  // of failure verify-web-runtime-smoke.mjs's tapWhenRendered() was built to close. Every control
  // in this setup chain is reachable only after a prior async step (typeahead results, or a
  // category/group/type list that only renders once its parent is selected), so ALL of them poll
  // here rather than trusting a fixed wait to have been long enough.
  const tap = async (txt, timeoutMs = 8000) => {
    const until = Date.now() + timeoutMs;
    let box = null;
    while (Date.now() < until) {
      box = await page.evaluate(CLICK_LEAF, txt);
      if (box) break;
      await page.waitForTimeout(300);
    }
    if (!box) throw new Error(`control never rendered: ${txt}`);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(900);
  };
  const body = () => page.evaluate(() => document.body.innerText);
  // Confirmed pick, retried (verify-web-runtime-smoke.mjs's proven pattern): a slow runner can have
  // the suggestion row not yet mounted when the poll gives up once — retry the whole gesture and
  // let the app's OWN confirmation testID (citySelected → selected-city-visual) decide, rather than
  // trusting that a single click landed.
  const pickCity = async (name) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.click('input >> nth=0');
      await page.fill('input >> nth=0', '');
      await page.type('input >> nth=0', name, { delay: 60 });
      await tap(name).catch(() => {});
      const took = await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 4000 }).catch(() => null);
      if (took) return;
    }
    throw new Error(`pickCity(${name}): the app never confirmed the selection after 3 attempts`);
  };

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    for (const d of deal) await tap(d);
    if (category) await tap(category);
    await pickCity(city);
    await page.waitForTimeout(800);
    if (district) {
      await page.click('input >> nth=1');
      await page.type('input >> nth=1', district, { delay: 60 });
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

    // Poll rather than a single evaluate: a slow CI runner can still be laying out the results
    // page (and the CTA row under it) when this check runs — the SAME class of race fixed above
    // for city/group/type. Persistent absence after the poll is the real "not eligible" case.
    //
    // WIDENED 2026-08-25 (progressive rounds): the launcher is no longer rendered the moment a turn
    // has >25 results. It now waits on the OFFER PROBE — a real rankQuestions round trip whose count
    // RPCs carry their own 4s timeout — so on a large base scope under production load the button can
    // legitimately arrive several seconds after the cards do. 6s of polling raced that; 16s does not,
    // and a launcher that never appears in 16s is still the honest "nothing truthful left to ask".
    let btn = null;
    for (let i = 0; i < 40 && !btn; i++) { btn = await page.evaluate(CLICK_LEAF, 'خلّنا نحدد الطلب أكثر'); if (!btn) await page.waitForTimeout(400); }
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
      // WAIT FOR A RESOLVED COUNT, NOT MERELY A NEW QUESTION (fix 2026-08-26). #1061 made the
      // pending window blank the chip deliberately — "the pending window must not show the previous
      // answer's count either" — so a predicate that stops at `q !== st.q` samples the intentional
      // blank and reads chip=null. That is what turned this check red on production while Skip was
      // working correctly (its sibling "advances to a different question" passed in the same run).
      // Requiring `chip != null` compares Skip's count against a number instead of a transient null.
      // This does NOT weaken the assertion: the equality below is unchanged, and a chip that NEVER
      // resolves still fails honestly, because readCardUntil returns its last read on timeout and
      // the `!= null` guard in the check makes that null an explicit failure rather than a pass.
      // 25s, not the 9s default: Skip applies no predicate, so the chip has to be REFILLED with the
      // unchanged number rather than arriving with a narrowed one, and on a 10,957-row base scope
      // that round-trip ran past the default while the value was still on its way. The bound is
      // still finite and the assertion is unchanged — a chip that never refills at all remains a
      // red with `after=null`, which is exactly what a "Skip leaves the count blank forever" defect
      // would look like. Raising a timeout is not weakening the oracle; accepting null would be.
      const after = await readCardUntil((s) => s.hasCard && s.q !== st.q && s.chip != null, 25_000);
      check(`${name}: Skip does not change the count (no predicate applied)`, after.chip != null && after.chip === before, `before=${before} after=${after.chip}`);
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
    // `s.chip !== baselineChip` alone is satisfied BY the pending window's null (fix 2026-08-26), so
    // this captured a blank as "the answer's count" — which both passed this check for the wrong
    // reason and then poisoned the Back comparison below with `expected=null`. Demand a resolved
    // number; the assertion itself is unchanged and now cannot pass on a chip that never resolves.
    const afterSelect = await readCardUntil((s) => s.chip != null && s.chip !== baselineChip);
    check(`${name}: count changed after selecting an answer`, afterSelect.chip != null && afterSelect.chip !== baselineChip, `base=${baselineChip} afterSelect=${afterSelect.chip}`);
    // ARM THE CAPTURE **BEFORE** THE COMMITTING CLICK, never after it (fix 2026-08-28). Confirming
    // the last useful question can end the round on its own and fire the final search inside the
    // 1200 ms below; the reset used to sit after this block, so that search was captured and then
    // thrown away, and the 25s poll that followed had nothing left to find. That is a false FAIL
    // with no product defect behind it — `MOBILE …/furnished: final search request was captured =
    // null` in run 33168150595, while the byte-identical desktop journey passed in the same run
    // purely because its round still had a question left. Arming here cannot weaken the assertion:
    // a final search that never fires still leaves lastSearchBody null and still fails.
    lastSearchBody = null; lastSearchResp = null;
    await page.click('[data-testid="af-confirm"]');
    await page.waitForTimeout(1200);

    if (backAndChange) {
      await page.click('[data-testid="af-back"]');
      // 25s for the same reason Skip needs it: Back re-shows an EARLIER question, so its chip has to
      // be refilled with that step's number rather than arriving with a fresh narrowing, and on a
      // 10,957-row base scope that outran the 9s default — which then returned a no-card sample
      // (q=null), and the empty option list below turned into a click on [data-testid="undefined"].
      const restored = await readCardUntil((s) => s.hasCard && s.q === st.q && s.chip != null, 25_000);
      check(`${name}: Back restores the previous question`, restored.q === st.q, `expected=${st.q} got=${restored.q}`);
      check(`${name}: Back restores the previous count`, restored.chip != null && restored.chip === afterSelect.chip, `expected=${afterSelect.chip} got=${restored.chip}`);
      const opts2 = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="af-option-"]')].map((e) => e.getAttribute('data-testid')));
      // NEVER build a locator out of an undefined id. When the restore above times out, this list is
      // empty and `opts2[otherIdx]` is undefined — which used to click `[data-testid="undefined"]`
      // and spend 30s timing out on a selector that cannot exist, burying the real failure (the card
      // never came back) under a harness stack trace. Fail here, naming the actual cause.
      // The detail string is printed on PASS as well as FAIL, so it must READ TRUE IN BOTH STATES.
      // It used to be the failure sentence unconditionally, which produced the genuinely misleading
      // «PASS … no af-option-* found after Back — the restored card never rendered» in run
      // 33168150595 — a green check whose own evidence line says the card never rendered. A reader
      // triaging that log is being told the opposite of what happened.
      check(`${name}: Back re-offers the earlier question's options`, opts2.length > 0,
        opts2.length
          ? `${opts2.length} option(s) restored (restored.q=${restored.q})`
          : `no af-option-* found after Back — the restored card never rendered (restored.q=${restored.q})`);
      if (!opts2.length) { await ctx.close(); return; }
      const otherIdx = opts2.length > 1 ? 1 : 0;
      await page.click(`[data-testid="${opts2[otherIdx]}"]`);
      const changed = await readCardUntil((s) => s.chip != null && s.chip !== afterSelect.chip);
      check(`${name}: changing the answer recomputes the count`, changed.chip !== afterSelect.chip || opts2.length === 1, `after1st=${afterSelect.chip} afterChange=${changed.chip}`);
      lastSearchBody = null; lastSearchResp = null;   // re-arm: this confirm is now the committing one
      await page.click('[data-testid="af-confirm"]');
      await page.waitForTimeout(1200);
    }

    // Finish the round. The «عرض النتائج» early-exit was REMOVED by the owner (2026-08-28) — the
    // footer is متابعة/تخطي/رجوع only, and a round ends when its questions are exhausted. So when
    // the card is still open after the committing confirm above, walk it out by SKIPPING the
    // remaining questions (skip = commitGuidedStep([]) — the same ONE commit path, recorded as
    // no-preference, changing no filters). Bounded: AF_ROUND_MAX_QUESTIONS is 5, so 8 attempts can
    // never loop forever even if a click is swallowed once or twice. The capture was armed before
    // that confirm, so a search it already fired is still held here rather than discarded.
    for (let hop = 0; hop < 8; hop++) {
      const open = await page.evaluate(() => !!document.querySelector('[data-testid="af-card"]'));
      if (!open) break;
      const skip = await page.evaluate(() => !!document.querySelector('[data-testid="af-skip"]'));
      if (!skip) break; // intro/mining state — no question on screen to skip
      await page.click('[data-testid="af-skip"]');
      await page.waitForTimeout(900);
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
