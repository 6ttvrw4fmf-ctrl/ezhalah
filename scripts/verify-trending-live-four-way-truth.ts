// TRENDING, PROVEN THE WHOLE WAY DOWN — DOM → trending RPC → click-through → independent DB truth.
//
// The existing Trending barriers stop one link short of the user. verify-trending-carries-full-
// filter-state.ts reads remote.ts and proves the PARAMS are threaded; verify-trending-usable-under-
// narrowing.ts and verify-district-counts-honest.ts compare RPC against RPC. None of them reads the
// number a human actually SEES in the row and carries it all the way to an independent count.
//
// That gap matters because every link in the chain can fail on its own: a row can render a stale
// count from a previous filter state, a click can land a request that quietly drops a predicate the
// trending call carried, and both can agree with each other while disagreeing with the database.
// AF_TRENDING_DATA_INTEGRITY_ENGINEER.md PART 5 states the contract this file enforces:
//
//     INTENT = UI = REQUEST = RPC = DB TRUTH = RESULTS
//
// The last link only became checkable on 2026-09-01. Until then the independent oracle refused any
// request carrying price/area/beds/etc. (see verify-af-oracle-classifies-every-search-param.ts), so
// a click-through into a narrowed search could not be independently counted at all.
//
// TWO TRAPS, both documented in the routine's harness notes and both re-encoded here:
//   • Trending renders on FOCUS and its RPC fires once per distinct parameter set per page session.
//     Re-focusing after clearing a captured list yields nothing, so every case gets a FRESH context.
//   • District rows carry a `match_values` array that merges name variants (جدة «الصفاء» =
//     ['الصفاء','حي الصفا']). A click sends the whole set, so the landed request legitimately
//     carries more districts than the row's label — comparing against the label alone reports a
//     false mismatch.

import { chromium } from 'playwright';
import { gotoLive } from './lib/liveNav.ts';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: REST_URL, key: ANON_KEY } = resolvePublicSupabase(process.env);
const H = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

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
let unverified = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failures++;
};

const TYPE_MACROS = await (async () => {
  const r = await fetch(`${REST_URL}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H });
  if (!r.ok) throw new Error(`known_type_ar unreadable (${r.status})`);
  return Object.fromEntries((await r.json()).map((x: any) => [x.type_ar, x.macro]));
})();

// RESOLVE ONLY THE NAMES THE REQUEST ACTUALLY USES (2026-09-01, second pass).
//
// The first version of this read the WHOLE district reference set: 192,125 rows paged 1,000 at a
// time, each page carrying an `order=` over the full index, to learn 2,069 distinct values. It was
// correct and unusably slow — 193 ordered round-trips turned a ~2-minute live suite into a
// 30-minute one, which in CI is a timeout waiting to happen, i.e. another way for this check to go
// quiet. A barrier that is too slow to finish protects nothing.
//
// A request carries one to three district names, so ask about exactly those: one count-only probe
// per name (Range 0-0, no rows returned). Cost is O(names in the request), not O(rows in the index),
// and the fact being established is identical — "is this name stored verbatim in search_listings_ar".
const districtCache = new Map();
async function knownDistrictsFor(names) {
  const out = new Set();
  for (const n of new Set(names)) {
    if (!districtCache.has(n)) {
      const r = await fetch(`${REST_URL}/rest/v1/search_listings_ar?select=listing_id&district_ar=eq.${encodeURIComponent(n)}`,
        { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
      if (!r.ok) throw new Error(`district probe failed for ${n} (${r.status}) — refusing to guess`);
      districtCache.set(n, Number((r.headers.get('content-range') || '').split('/')[1] ?? 0) > 0);
    }
    if (districtCache.get(n)) out.add(n);
  }
  return out;
}

/** Independent count straight through PostgREST — never by re-calling our own RPC. */
async function oracleCount(body: any): Promise<{ count: number | null; unhandled: string[] }> {
  const knownDistricts = await knownDistrictsFor(body.p_districts ?? []);
  const { qs, unhandled } = buildOracleQS(body, { typeMacros: TYPE_MACROS, knownDistricts });
  if (unhandled.length) return { count: null, unhandled };
  const r = await fetch(`${REST_URL}/rest/v1/search_listings_ar?select=listing_id&${qs}`, {
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!r.ok) throw new Error(`oracle REST ${r.status}`);
  return { count: Number((r.headers.get('content-range') || '').split('/')[1] ?? -1), unhandled: [] };
}

const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors',
         ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
});

/** Read the Trending list the way the user reads it — from the app's own row testid, not a
 *  hand-rolled text heuristic. Rows render as «الرياض\n36,448 إعلان». */
const READ_TRENDING_ROWS = () => {
  const out: { label: string; count: number }[] = [];
  document.querySelectorAll('[data-testid="trending-row"]').forEach((e: any) => {
    const t = (e.innerText || '').trim();
    // Rows render as «1.\nالرياض\n36,448 إعلان» — the leading rank is chrome, not the label.
    const m = t.replace(/^\s*\d+\.\s*/, '').match(/^(.+?)[\n\s]+([\d,٬]+)\s*إعلان/s);
    if (m) out.push({ label: m[1].trim(), count: parseInt(m[2].replace(/[^\d]/g, ''), 10) });
  });
  return out;
};

type Journey = {
  name: string; city: string; group: string; type: string;
  deal?: string[]; category?: string | null; viewport?: { width: number; height: number };
  /** Real narrowing typed into the real controls, so Trending must inherit it. */
  priceMax?: number; areaMin?: number;
};

async function runJourney(j: Journey) {
  const { name, city, group, type, deal = [], category = null,
          priceMax = null, areaMin = null,
          viewport = { width: 1440, height: 900 } } = j;
  console.log(`\n════════ TRENDING JOURNEY: ${name} ════════`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport });
  const page = await ctx.newPage();

  // Pair each response to its OWN request object — several in-flight calls share one RPC name, and
  // matching by name alone silently pairs the wrong totals onto the wrong parameter set.
  const cityCalls: { body: any; rows: any[] }[] = [];
  const districtCalls: { body: any; rows: any[] }[] = [];
  let lastSearch: { body: any; rows: any[] } | null = null;
  page.on('response', async (resp) => {
    const u = resp.url();
    if (resp.request().method() !== 'POST') return;
    try {
      const j2 = await resp.json();
      if (!Array.isArray(j2)) return;
      const body = JSON.parse(resp.request().postData() || '{}');
      if (u.includes('/rpc/top_cities_by_deal_ar')) cityCalls.push({ body, rows: j2 });
      else if (u.includes('/rpc/district_options_ar')) districtCalls.push({ body, rows: j2 });
      else if (u.includes('/rpc/location_search_candidates_ar')) lastSearch = { body, rows: j2 };
    } catch {}
  });

  const tap = async (txt: string, timeoutMs = 9000) => {
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
    await gotoLive(page, `${BASE}/`, { timeout: 60000 });
    await page.waitForTimeout(5000);
    for (const d of deal) await tap(d);
    if (category) await tap(category);

    // Type the narrowing into the REAL controls before opening Trending, so what we assert is that
    // Trending inherited a state the USER set — not one a script poked into the request.
    if (priceMax != null) await page.fill('[data-testid="price-max-input"]', String(priceMax));
    if (areaMin != null) await page.fill('[data-testid="area-min-input"]', String(areaMin));
    if (priceMax != null || areaMin != null) await page.waitForTimeout(1200);

    // ── PART 2 — TRENDING CITIES ────────────────────────────────────────────────────────────────
    // Trending renders on focus of the city input, before any city is chosen.
    await page.click('[data-testid="city-input"]');
    await page.waitForTimeout(4000);
    const visibleCities = await page.evaluate(READ_TRENDING_ROWS);
    check(`${name}: Trending Cities rendered rows in the DOM`, visibleCities.length > 0,
      visibleCities.map((c) => `${c.label} ${c.count}`).join(' · ') || '(none)');
    check(`${name}: the Trending Cities RPC was captured`, cityCalls.length > 0);

    if (cityCalls.length && visibleCities.length) {
      const call = cityCalls[cityCalls.length - 1];
      // Every visible row must be backed by the RPC's own number — a row showing a count the RPC
      // did not return is a stale count from a previous filter state.
      const rpcByName = new Map<string, number>();
      for (const r of call.rows) {
        const label = r.city_ar ?? r.city ?? r.name_ar ?? r.label;
        const n = Number(r.listing_count ?? r.total ?? r.cnt ?? r.count ?? r.total_count);
        if (label != null && Number.isFinite(n)) rpcByName.set(String(label), n);
      }
      const mismatched = visibleCities
        .filter((v) => rpcByName.has(v.label))
        .filter((v) => rpcByName.get(v.label) !== v.count);
      const matchedRows = visibleCities.filter((v) => rpcByName.has(v.label)).length;
      check(`${name}: every visible city count == the Trending RPC's own count (no stale rows)`,
        mismatched.length === 0 && matchedRows > 0,
        mismatched.length
          ? mismatched.map((m) => `${m.label}: shown ${m.count} vs rpc ${rpcByName.get(m.label)}`).join(' · ')
          : `${matchedRows}/${visibleCities.length} rows cross-checked against the RPC`);

      // The trending call must carry the SAME narrowing the user already chose — a trending list
      // computed over a wider set than the search is a different question than the one asked.
      if (deal.length === 1) {
        check(`${name}: the Trending call carried the chosen deal (filter-state inheritance)`,
          call.body.p_deal === deal[0], `p_deal=${JSON.stringify(call.body.p_deal)} expected ${deal[0]}`);
      }
      // PART 2's permanent rule: Trending Cities is the location breakdown of the EXACT current
      // eligible set. A budget or area the user has already typed must reach the trending call, or
      // the list is answering a wider question than the one on screen.
      if (priceMax != null) {
        check(`${name}: the Trending call carried the typed price ceiling`,
          Number(call.body.p_price_max) === priceMax, `p_price_max=${JSON.stringify(call.body.p_price_max)}`);
      }
      if (areaMin != null) {
        check(`${name}: the Trending call carried the typed minimum area`,
          Number(call.body.p_area_min) === areaMin, `p_area_min=${JSON.stringify(call.body.p_area_min)}`);
      }
    }

    // ── click-through: the advertised number must survive the click ─────────────────────────────
    const advertised = visibleCities.find((c) => c.label === city)?.count ?? null;
    await tap(city).catch(async () => {
      await page.fill('[data-testid="city-input"]', city);
      await tap(city);
    });
    await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
    await page.waitForTimeout(800);

    // ── PART 3 — TRENDING DISTRICTS ─────────────────────────────────────────────────────────────
    // Choose the property type BEFORE reading the district list. PART 3's rule is that a district's
    // advertised count equals the count after clicking it, and that is only a meaningful comparison
    // when the SAME filter state was active at both moments — reading the rows first and narrowing
    // afterwards compares two different questions and reports a false mismatch.
    await tap(group);
    await tap(type);
    await page.waitForTimeout(1500);
    await page.click('[data-testid="district-input"]').catch(() => {});
    await page.waitForTimeout(4000);
    const visibleDistricts = await page.evaluate(READ_TRENDING_ROWS);
    check(`${name}: Trending Districts rendered for ${city}`, visibleDistricts.length > 0,
      visibleDistricts.map((d) => `${d.label} ${d.count}`).join(' · ') || '(none)');

    // PART 3's PERMANENT RULE: a district's advertised count must be the EXACT count after clicking
    // it — never a wider/unfiltered fallback dressed up as filtered truth. Checking that the number
    // appears in district_options_ar's own rows is NOT the same property and is wrong under
    // narrowing anyway: harness note 4 records that the UI replaces the RPC's scope counts with a
    // live per-row count whenever an extra predicate is active. So click the row and compare.
    const pickedDistrict = visibleDistricts[0] ?? null;
    if (pickedDistrict) {
      check(`${name}: no district row renders a zero-width or negative count`,
        visibleDistricts.every((d) => Number.isFinite(d.count) && d.count >= 0),
        visibleDistricts.map((d) => `${d.label}=${d.count}`).join(' · '));
      await tap(pickedDistrict.label).catch(() => {});
      await page.waitForTimeout(1200);
    }

    // ── run the search and close the chain against independent DB truth ─────────────────────────
    await page.keyboard.press('Escape').catch(() => {});
    await tap('بحث');
    await page.waitForTimeout(14000);

    check(`${name}: the search request was captured after click-through`, !!lastSearch);
    if (lastSearch) {
      const body: any = (lastSearch as any).body;
      const rows: any[] = (lastSearch as any).rows;
      const rpcTotal = Number(rows?.[0]?.total_count ?? rows.length);

      // INTENT = REQUEST: the city the user clicked in Trending must be the city searched.
      check(`${name}: the landed request carries the clicked city (Trending intent survived)`,
        Array.isArray(body.p_cities) && body.p_cities.includes(city),
        `p_cities=${JSON.stringify(body.p_cities)}`);

      const uiTxt = await page.evaluate(() => document.body.innerText);
      const m = uiTxt.match(/لقينا\s*([\d,٬]+)\s*إعلان/);
      const uiCount = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) : null;
      if (uiCount != null) {
        check(`${name}: the displayed result count == the search RPC's total_count`,
          uiCount === rpcTotal, `ui=${uiCount} rpc=${rpcTotal}`);
      }

      // THE LINK THAT WAS UNCHECKABLE BEFORE 2026-09-01.
      //
      // A REFUSAL IS NOT A FAILURE. The oracle declines a request it cannot translate soundly —
      // most often a district name production resolves through norm_district_tok() that is not
      // stored verbatim (e.g. «حي المهدية» indexed as «المهدية»). Before 2026-09-01 that case
      // silently produced 0 against a healthy RPC's 1,796, i.e. a false differential on a correct
      // search. Reporting it as UNVERIFIED is the honest outcome; only a real disagreement fails.
      const { count: oc, unhandled } = await oracleCount(body);
      if (unhandled.length) {
        console.log(`SKIP  ${name}: independent DB truth not verifiable for this request` +
                    `\n      ${unhandled.join('; ')}\n      (rpc=${rpcTotal}; a refusal, not a mismatch)`);
        unverified++;
      } else {
        check(`${name}: search RPC total_count == INDEPENDENT DB truth (PostgREST, not our RPC)`,
          oc === rpcTotal, `oracle=${oc} rpc=${rpcTotal}`);
      }

      if (pickedDistrict && Array.isArray(body.p_districts) && body.p_districts.length) {
        // The landed request may legitimately carry MORE district names than the row's label —
        // district_options_ar merges orthographic variants via match_values (جدة «الصفاء» =
        // ['الصفاء','حي الصفا']), and the click sends the whole set. What must hold is the COUNT.
        check(`${name}: district «${pickedDistrict.label}» advertised ${pickedDistrict.count} == the count after clicking it`,
          rpcTotal === pickedDistrict.count,
          `advertised=${pickedDistrict.count} landed=${rpcTotal} p_districts=${JSON.stringify(body.p_districts)}`);
      }

      if (advertised != null) {
        console.log(`      note: ${city} advertised ${advertised} in Trending before type narrowing; ` +
                    `landed ${rpcTotal} after ${group}/${type} — narrowing is expected here.`);
        check(`${name}: the landed total is not WIDER than the advertised city total`,
          rpcTotal <= advertised, `advertised=${advertised} landed=${rpcTotal}`);
      }
    }
  } catch (e: any) {
    check(`${name}: journey completed without a harness error`, false, e.message);
  } finally {
    await ctx.close();
  }
}

/**
 * PART 2/3 ON A RE-ENTRY — the journey the owner broke, in a real browser (P0 2026-09-01).
 *
 * Every journey above starts on a fresh context and searches ONCE, so none of them could ever see
 * this: the user commits an Advanced Filter answer, goes BACK to the Filter screen, and searches
 * again. Measured live before the fix, الرياض / إيجار / سنوي / تجاري / محل:
 *
 *   base search                        566   (no AF param in the body)
 *   «كم عمر العقار؟» → «جديد»          243   (p_is_new_construction: true)
 *   back → Trending «الرياض» → «بحث»   566   ← the committed answer simply gone from the request
 *
 * and every Trending row on that second visit advertised the 566-scoped number, so the card
 * promised exactly the wrong count it then delivered. Reproduced through a Trending city card, a
 * district card, a different city, and with Trending never touched at all.
 *
 * ASSERTED ON THE CAPTURED REQUEST BODY, never on rendered text: a UI assertion passes on a page
 * that merely re-renders a stale number. Note the «تصفية» pill is collapsed once a search has run
 * (agent.tsx modeSearched), so browser Back is the only non-destructive way back — which is exactly
 * the route the owner took.
 */
async function runAfReentryJourney(j: {
  name: string; city: string; group: string; type: string; deal: string[]; category: string;
  /** testID of the Advanced Filter option to commit, e.g. 'af-option-new'. */
  afOption: string;
}) {
  const { name, city, group, type, deal, category, afOption } = j;
  console.log(`\n════════ AF RE-ENTRY JOURNEY: ${name} ════════`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const searches: { body: any; total: number }[] = [];
  const cityCalls: { body: any }[] = [];
  page.on('response', async (resp) => {
    if (resp.request().method() !== 'POST') return;
    try {
      const rows = await resp.json();
      if (!Array.isArray(rows)) return;
      const body = JSON.parse(resp.request().postData() || '{}');
      if (resp.url().includes('/rpc/location_search_candidates_ar') && body.p_limit > 1)
        searches.push({ body, total: Number(rows?.[0]?.total_count ?? rows.length) });
      else if (resp.url().includes('/rpc/top_cities_by_deal_ar')) cityCalls.push({ body });
    } catch {}
  });
  const tap = async (txt: string, timeoutMs = 9000) => {
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
  /** Only the Advanced Filter half of a request — the half that went missing. */
  const afOf = (body: any) => Object.fromEntries(Object.entries(body)
    .filter(([k]) => /^p_(amenities|bath_min|furnished|street_width_min|directions|rating_min|reviews_min|unit_subtypes|age_min|age_max|is_new_construction)$/.test(k)));

  try {
    await gotoLive(page, `${BASE}/`, { timeout: 60000 });
    await page.waitForTimeout(5000);
    for (const d of deal) await tap(d);
    await tap(category);
    await page.click('[data-testid="city-input"]');
    await page.waitForTimeout(3000);
    await tap(city).catch(async () => { await page.fill('[data-testid="city-input"]', city); await tap(city); });
    await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 6000 }).catch(() => null);
    await tap(group);
    await tap(type);
    await tap('بحث');
    await page.waitForTimeout(14000);
    const base = searches[searches.length - 1] ?? null;
    check(`${name}: the base search ran`, !!base, `captured ${searches.length} search(es)`);

    // ── commit an Advanced Filter answer, then FINISH the round ─────────────────────────────────
    // By testID, never by label: the copy on this button is being reworked in a parallel PR, and a
    // barrier that silently stops finding its own entry point reports green on an untested journey —
    // which is precisely what the first run of this journey did.
    await page.waitForSelector('[data-testid="results-narrow"]', { timeout: 30000 });
    await page.click('[data-testid="results-narrow"]');
    await page.waitForSelector('[data-testid="af-card"]', { timeout: 20000 });
    await page.click(`[data-testid="${afOption}"]`);
    await page.waitForTimeout(900);
    await page.click('[data-testid="af-confirm"]');
    // The store write happens when the ROUND ends (finishGuided → runRefine), not per answer, so the
    // remaining questions must be skipped out or nothing is ever committed. Skip is a real answer of
    // "I'm open": it applies no predicate and cannot move the count.
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1500);
      if (!(await page.$('[data-testid="af-card"]'))) break;
      await page.click('[data-testid="af-skip"]').catch(() => {});
    }
    await page.waitForTimeout(14000);
    const committed = searches[searches.length - 1] ?? null;
    const committedAf = committed ? afOf(committed.body) : {};
    // FATAL, not a check: every assertion below compares against this answer, so if it never landed
    // they would all compare {} to {} and pass while proving nothing at all.
    if (!Object.keys(committedAf).length) {
      throw new Error(`the Advanced Filter answer never reached the request (af params = ${JSON.stringify(committedAf)}; ` +
        `base=${base?.total} committed=${committed?.total}) — the journey below would be vacuous`);
    }
    check(`${name}: the Advanced Filter answer reached the request`, true, `af params = ${JSON.stringify(committedAf)}`);
    check(`${name}: and it NARROWED the set (an AF answer may only ever narrow)`,
      !!base && !!committed && committed.total < base.total, `base=${base?.total} committed=${committed?.total}`);

    // ── back to the Filter screen, re-open Trending, search again ───────────────────────────────
    const before = cityCalls.length;
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await page.fill('[data-testid="city-input"]', '');           // clearing re-opens the Trending Top-6
    await page.click('[data-testid="city-input"]');
    await page.waitForTimeout(4000);
    const rows = await page.evaluate(READ_TRENDING_ROWS);
    check(`${name}: Trending re-rendered on the way back`, rows.length > 0,
      rows.map((r) => `${r.label} ${r.count}`).join(' · ') || '(none)');
    // R14.1.2: Trending is the location breakdown of the EXACT current eligible set — which now
    // includes the committed Advanced Filter answer.
    // A committed answer CHANGES the pool's narrowing signature, so a fresh top_cities_by_deal_ar
    // must fire on the way back. No new call at all is therefore a failure in its own right, not a
    // harness gap: it means the screen still believes it is looking at the pre-AF filter state.
    const trendingCall = cityCalls.slice(before).pop() ?? null;
    check(`${name}: the Trending request carries the committed Advanced Filter answer`,
      !!trendingCall && JSON.stringify(afOf(trendingCall.body)) === JSON.stringify(committedAf),
      trendingCall
        ? `trending af=${JSON.stringify(afOf(trendingCall.body))} committed af=${JSON.stringify(committedAf)}`
        : `no fresh Trending request fired at all — the pool signature never learned about the AF answer`);

    const advertised = rows.find((r) => r.label === city)?.count ?? null;
    await tap(city).catch(async () => { await page.fill('[data-testid="city-input"]', city); await tap(city); });
    await page.waitForTimeout(1200);
    await tap('بحث');
    await page.waitForTimeout(14000);
    const reentry = searches[searches.length - 1] ?? null;

    check(`${name}: the re-entry search carries the SAME Advanced Filter params (no dropped filters)`,
      !!reentry && JSON.stringify(afOf(reentry.body)) === JSON.stringify(committedAf),
      `re-entry af=${JSON.stringify(reentry ? afOf(reentry.body) : null)} committed af=${JSON.stringify(committedAf)}`);
    check(`${name}: the property type did not widen back out to its group`,
      !!reentry && !!committed && JSON.stringify(reentry.body.p_types) === JSON.stringify(committed.body.p_types),
      `re-entry p_types=${JSON.stringify(reentry?.body.p_types)} committed=${JSON.stringify(committed?.body.p_types)}`);
    check(`${name}: the Normal Filter state round-tripped (deal, period, category)`,
      !!reentry && !!committed && reentry.body.p_deal === committed.body.p_deal
        && reentry.body.p_rent_period === committed.body.p_rent_period
        && reentry.body.p_category === committed.body.p_category,
      `re-entry=${JSON.stringify([reentry?.body.p_deal, reentry?.body.p_rent_period, reentry?.body.p_category])}`);
    check(`${name}: the eligible set is the one the user committed, not the pre-AF one`,
      !!reentry && !!committed && reentry.total === committed.total,
      `committed=${committed?.total} re-entry=${reentry?.total}`);
    // COUNT == CLICK-THROUGH (R14.2.1). The whole scope was already committed before Trending
    // rendered, so the advertised city number is not merely an upper bound here — it is the answer.
    //
    // ON ITS OWN THIS CHECK CANNOT SEE THE DEFECT, and that is the point of the one above it: the
    // advertised count and the landed count are built from the SAME store, so when the store has
    // silently dropped the AF answer they agree with each other perfectly and are both wrong
    // (measured on production 2026-09-01: advertised 566, landed 566, against a committed 243).
    // Only «the eligible set is the one the user committed» distinguishes the two states.
    if (advertised != null && reentry) {
      check(`${name}: the Trending row advertised ${advertised} and clicking it delivered exactly that`,
        advertised === reentry.total, `advertised=${advertised} landed=${reentry.total}`);
    }
  } catch (e: any) {
    check(`${name}: journey completed without a harness error`, false, e.message);
  } finally {
    await ctx.close();
  }
}

// Rotate cities AND regions, desktop and mobile — never Riyadh-only (PART 5).
await runJourney({ name: 'Riyadh · Buy · Apartment — no extra narrowing', city: 'الرياض',
  deal: [], group: 'الشقق والسكن المشترك', type: 'شقة' });
await runJourney({ name: 'Jeddah (non-Riyadh) · Buy · Villa — price ceiling 3M', city: 'جدة',
  deal: [], group: 'الفلل والبيوت', type: 'فيلا', priceMax: 3000000 });
await runJourney({ name: 'Riyadh · Buy · Apartment — price 900k + area>=120 (stacked)', city: 'الرياض',
  deal: [], group: 'الشقق والسكن المشترك', type: 'شقة', priceMax: 900000, areaMin: 120 });
await runJourney({ name: 'MOBILE 390x844 · Dammam · Buy · Apartment', city: 'الدمام',
  deal: [], group: 'الشقق والسكن المشترك', type: 'شقة', viewport: { width: 390, height: 844 } });
// The owner's own repro, at the exact scope they measured it on.
await runAfReentryJourney({ name: 'RE-ENTRY · Riyadh · Rent-Annual · Shop + property_age', city: 'الرياض',
  // إيجار then شراء: the deal buttons are two independent toggles, so tapping إيجار alone leaves
  // BOTH on (dealCombined), and combined mode has no period selector at all — «سنوي» never renders.
  deal: ['إيجار', 'شراء', 'سنوي'], category: 'تجاري', group: 'التجزئة والمكاتب', type: 'محل', afOption: 'af-option-new' });

await browser.close();
console.log(failures
  ? `\n✗ ${failures} check(s) FAILED (${unverified} request(s) the oracle honestly declined)\n`
  : `\n✓ Trending live four-way truth — all checks passed` +
    `${unverified ? ` (${unverified} request(s) the oracle honestly declined — see SKIP lines)` : ''}\n`);
process.exit(failures ? 1 : 0);
