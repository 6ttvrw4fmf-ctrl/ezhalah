// THE EIGHT-LAYER CHAIN, ON ONE ACTION — routine #9's own instrument.
//
// docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md PART 2.4: every existing harness covers a CONTIGUOUS
// SLICE of the chain (verify-af-live-truth.ts is L1–L6 for AF journeys; e2e/live-sweep is six
// layers of breadth; verify-af-card-evidence-live.ts is L7 alone). Nobody joins L1 through L8 on
// the SAME captured request, which is the one thing #9 exists to do. This is that join.
//
// NOT a barrier and deliberately NOT named `verify-*`: scripts/lib/testRegistry.ts discovers every
// `scripts/verify-*.{ts,mjs}` into the REQUIRED `npm test` suite, and a check that drives a real
// browser against production must never sit in the hermetic PR gate (the same reason
// verify-migration-drift-vs-production.ts is pinned OUT of it). It is an investigative tool the
// routine runs by hand:
//
//   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium node --experimental-strip-types \
//     scripts/redteam-chain-live.mjs
//
//   RT_CELLS=<json>   override the cell list        RT_ONLY=<label substring>   run one cell
//   RT_PAGES=<n>      «عرض المزيد» clicks per chain (default 3)
//
// THE EIGHT LAYERS AND THEIR SANCTIONED READERS (PART 2.1) — each read INDEPENDENTLY, never from
// this harness's memory of what it clicked:
//   L1 user action     → the app's own «ملخص البحث» via e2e/live-sweep/visibleState.mjs
//   L2 frontend request→ resp.request().postData() off the wire, p_limit > 1 only (§41.5)
//   L3 RPC parameters  → every p_* in that body, p_tables included
//   L4 DB truth set    → an INDEPENDENT PostgREST oracle (scripts/lib/afOracleFilter.ts), never a
//                        second call to our own RPC and never a copy of its SQL (PART 2.2)
//   L5 displayed count → «لقينا N إعلان» off the rendered page
//   L6 returned ids    → (source_table, listing_id) off the RPC RESPONSE, never card text (§41.9)
//   L7 card evidence   → ids off each card's own `card-listing-<id>` wrapper, never by position
//   L8 continuation    → «عرض المزيد» clicked for real; predicates unchanged, offset advancing,
//                        no duplicate, no row outside the oracle set, headline unmoved
//
// A layer this run could not reach is printed as NOT REACHED and counted separately. It is never
// folded into the passes (PART 7): a rule this run could not reach is not a rule this run proved.
import { chromium, devices } from 'playwright';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { loadCityScope } from './lib/afOracleLive.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { parseVisibleState } from '../e2e/live-sweep/visibleState.mjs';

const BASE = 'https://ezhalah-app.vercel.app';
const { url: REST, key: KEY } = resolvePublicSupabase(process.env);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const SEARCH_RPC = '/rpc/location_search_candidates_ar';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = Number(process.env.RT_PAGES ?? 3);

const rows = [];
let fails = 0;
const notReached = [];
const eq = (chain, label, ok, detail = '') => {
  rows.push({ chain, label, ok, detail });
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const unreached = (chain, label, why) => {
  notReached.push(`${chain} :: ${label} — ${why}`);
  console.log(`  NOT REACHED  ${label}  — ${why}`);
};

// ── the independent oracle (PART 2.2) ────────────────────────────────────────────────────────────
const TYPE_MACROS = await (async () => {
  const r = await fetch(`${REST}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H });
  if (!r.ok) throw new Error(`known_type_ar unreadable (${r.status}) — the oracle cannot apply category purity`);
  return Object.fromEntries((await r.json()).map((x) => [x.type_ar, x.macro]));
})();

// Districts are resolved per-NAME, count-only, exactly as verify-af-live-truth.ts does — asking
// about the whole 192k reference set makes the oracle too slow to finish, and a barrier that cannot
// finish protects nothing.
const districtCache = new Map();
async function knownDistrictsFor(names) {
  const out = new Set();
  for (const n of new Set(names ?? [])) {
    if (!districtCache.has(n)) {
      const r = await fetch(`${REST}/rest/v1/search_listings_ar?select=listing_id&district_ar=eq.${encodeURIComponent(n)}`,
        { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
      if (!r.ok) throw new Error(`district probe failed for ${n} (${r.status}) — refusing to guess`);
      districtCache.set(n, Number((r.headers.get('content-range') || '').split('/')[1] ?? 0) > 0);
    }
    if (districtCache.get(n)) out.add(n);
  }
  return out;
}

async function oracle(body) {
  // The city arms are resolved from the REFERENCE CATALOGUE, not from the label alone: production
  // matches city_ar OR city_id OR match_city_ids (see afOracleFilter.ts's p_cities case, and
  // scripts/verify-af-oracle-city-arms.ts). Without this the oracle undercounts every aliased city —
  // it reported 652 against a correct RPC's 802 on الهفوف/بيع/فيلا the first time this tool ran.
  const opts = {
    typeMacros: TYPE_MACROS,
    knownDistricts: await knownDistrictsFor(body.p_districts),
    cityScope: await loadCityScope(REST, H, body.p_cities ?? []),
  };
  const { qs, unhandled } = buildOracleQS(body, opts);
  if (unhandled.length) return { count: null, ids: null, unhandled };
  const cr = await fetch(`${REST}/rest/v1/search_listings_ar?select=listing_id&${qs}`,
    { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const hdr = cr.headers.get('content-range');
  const count = hdr?.includes('/') ? Number(hdr.split('/')[1]) : null;
  // ID-set comparison only below the cap: a set sitting exactly at the cap could be a truncation
  // mistaken for a complete set (PART 2.3, the sweep's own ID_SET_CAP reasoning).
  const ID_SET_CAP = 1200;
  if (count == null || count > ID_SET_CAP) return { count, ids: null, unhandled };
  const ids = new Set();
  for (let off = 0; off < ID_SET_CAP + 1000; off += 1000) {
    // A Range-paged PostgREST query MUST carry an explicit total order, or paging silently drops
    // and repeats rows across page boundaries — an artefact that looks exactly like a product bug
    // (fix of 2026-08-28, already in verify-af-live-truth.ts).
    const r = await fetch(`${REST}/rest/v1/search_listings_ar?select=listing_id,source_table&${qs}&order=source_table.asc,listing_id.asc`,
      { headers: { ...H, Range: `${off}-${off + 999}` } });
    const page = await r.json();
    if (!Array.isArray(page) || !page.length) break;
    for (const x of page) ids.add(`${x.source_table}:${x.listing_id}`);
    if (page.length < 1000) break;
  }
  return { count, ids, unhandled };
}

// ── browser driving (the CLICK_LEAF technique, proven on BOTH viewports) ─────────────────────────
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

// §41.3 — a card's own description carries an «عرض المزيد» expander too; the real pager is the
// BOTTOM-MOST match at >= 30px. Both discriminators are needed (e2e/live-sweep/showmore.mjs).
const PAGER = (minH) => {
  const c = [];
  for (const e of document.querySelectorAll('div')) {
    if ((e.innerText || '').trim() !== 'عرض المزيد') continue;
    const r = e.getBoundingClientRect();
    if (r.height >= minH) c.push({ y: r.y + window.scrollY, h: r.height });
  }
  if (!c.length) return null;
  c.sort((a, b) => a.y - b.y);
  return c[c.length - 1].y;
};

const CARD_IDS = () => [...document.querySelectorAll('[data-testid^="card-listing-"]')]
  .map((e) => e.getAttribute('data-testid').replace('card-listing-', ''));

/**
 * §41.4 — a settled screen is one whose card count has STOPPED GROWING, never a fixed sleep.
 * Returns the stable count. A count that never stabilises still returns its last read, so a genuinely
 * stuck cascade still fails honestly rather than being waited into a pass.
 */
async function settleCards(page, { tries = 60, stableFor = 4, everyMs = 700 } = {}) {
  let last = -1, stable = 0;
  for (let i = 0; i < tries; i++) {
    const n = (await page.evaluate(CARD_IDS)).length;
    if (n === last) { if (++stable >= stableFor) return n; } else { stable = 0; }
    last = n;
    await sleep(everyMs);
  }
  return last;
}

const launchOpts = () => ({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  args: ['--no-sandbox', '--ignore-certificate-errors',
         ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ssl-version-max=tls1.2'] : [])],
});

/** Every p_* that is a PREDICATE — i.e. everything a later page must carry unchanged. */
const predicatesOf = (b) => Object.fromEntries(Object.entries(b)
  .filter(([k]) => k.startsWith('p_') && !['p_limit', 'p_offset'].includes(k))
  .sort(([a], [c]) => a.localeCompare(c)));

async function runChain(cell) {
  const name = cell.label;
  console.log(`\n════════ CHAIN: ${name} (${cell.mobile ? 'MOBILE' : 'desktop'}) ════════`);
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext(cell.mobile
    ? { ...devices['iPhone 13'], locale: 'ar-SA', ignoreHTTPSErrors: true }
    : { viewport: { width: 1280, height: 1100 }, locale: 'ar-SA', ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // L2/L6 — the bytes sent and the rows returned, paired, in wire order. Only p_limit > 1 is a
  // RESULT search: autocomplete reuses the same RPC at p_limit 1 (§41.5).
  const searches = [];
  page.on('response', async (resp) => {
    if (!resp.url().includes(SEARCH_RPC) || resp.request().method() !== 'POST') return;
    try {
      const body = JSON.parse(resp.request().postData() || '{}');
      if (!(Number(body.p_limit) > 1)) return;
      const json = await resp.json();
      if (Array.isArray(json)) searches.push({ body, json });
    } catch { /* a transient bad parse must never overwrite a good capture */ }
  });

  const tap = async (txt, timeoutMs = 12000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const box = await page.evaluate(CLICK_LEAF, txt);
      if (box) { await page.mouse.click(box.x, box.y); await sleep(900); return true; }
      await sleep(300);
    }
    return false;
  };
  const text = () => page.evaluate(() => document.body.innerText);

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
    await sleep(5000);

    for (const d of cell.deal ?? []) if (!await tap(d)) throw new Error(`deal control never rendered: ${d}`);
    if (cell.category && !await tap(cell.category)) throw new Error(`category never rendered: ${cell.category}`);

    // The COMMIT is the assertion, not the click (§41.13): the app's own confirmation testID decides.
    let picked = false;
    for (let a = 0; a < 3 && !picked; a++) {
      await page.click('input >> nth=0');
      await page.fill('input >> nth=0', '');
      await page.type('input >> nth=0', cell.city, { delay: 60 });
      await tap(cell.city, 8000);
      picked = !!await page.waitForSelector('[data-testid="selected-city-visual"]', { timeout: 5000 }).catch(() => null);
    }
    if (!picked) throw new Error(`the app never confirmed the city selection: ${cell.city}`);
    await sleep(800);
    if (!await tap(cell.group)) throw new Error(`group never rendered: ${cell.group}`);
    if (!await tap(cell.type)) throw new Error(`type never rendered: ${cell.type}`);
    if (!await tap('بحث')) throw new Error('«بحث» never rendered');

    // Wait for the app to SETTLE on a terminal state, not for a guessed number of seconds.
    await page.waitForFunction(() => /لقينا|ما لقيت|ما فيه/.test(document.body.innerText), null, { timeout: 90000 });
    // …AND THEN WAIT FOR THE CARD CASCADE (§41.4). A terminal headline is not a settled screen: the
    // cards drip in one by one, so a fixed sleep here samples a PARTIAL list. This cost a false
    // product finding on its first run — الطائف/تجاري/محل read 32 cards under a «37» headline with
    // no pager at 3.5 s and was reported as 5 counted-but-unreachable listings; watched for 80 s the
    // same screen reaches all 37 with the correct «عرضت لك كل النتائج المطابقة (37 إعلان)» and no
    // pager, because everything really is on screen. Production was right and the harness was
    // early — §41.15: an oracle that accuses the product for its own imprecision is worse than none.
    // The sweep already learned this (e2e/live-sweep/sweep.mjs settle()); this is the same rule.
    await settleCards(page);

    const first = searches.filter((s) => Number(s.body.p_offset ?? 0) === 0).pop();
    if (!first) { unreached(name, 'L2 result request captured', 'no p_limit>1 search request was seen'); return; }

    // The captured body IS the evidence for L2/L3 — print it, so a disagreement found here can be
    // replayed by hand against the RPC without re-driving the browser.
    console.log(`  L2/L3 captured body: ${JSON.stringify(predicatesOf(first.body))}`);

    // ── L1 = L3 : what the screen says the search is, against what the request carried ───────────
    const vs = parseVisibleState(await text());
    eq(name, 'L1 the app renders its own «ملخص البحث»', vs.summaryFound, `city=${vs.city} deal=${vs.deal} type=${vs.type}`);
    if (vs.city) {
      const sent = (first.body.p_cities ?? []).join('|');
      eq(name, 'L1 city == L3 p_cities', sent.includes(vs.city) || vs.city.includes(sent), `ui=${vs.city} rpc=[${sent}]`);
    }
    if (vs.type) eq(name, 'L1 type == L3 p_types', JSON.stringify(first.body.p_types ?? []).includes(vs.type),
      `ui=${vs.type} rpc=${JSON.stringify(first.body.p_types)}`);
    eq(name, 'L3 carries the scope key p_tables', Array.isArray(first.body.p_tables) && first.body.p_tables.length > 0,
      `p_tables=${JSON.stringify(first.body.p_tables)}`);

    // ── L5 = L6 : the number on screen is the number the RPC returned ────────────────────────────
    const rpcTotal = Number(first.json?.[0]?.total_count ?? first.json.length);
    const ui = vs.headline == null ? null : Number(String(vs.headline).replace(/[^\d]/g, ''));
    eq(name, 'L5 displayed count == L6 RPC total_count', ui === rpcTotal, `ui=${ui} rpc=${rpcTotal}`);

    // ── L4 : the independent oracle, on the captured body ────────────────────────────────────────
    const o = await oracle(first.body);
    if (o.unhandled.length) {
      unreached(name, 'L4 independent oracle', `unhandled params: ${o.unhandled.join(', ')}`);
    } else {
      eq(name, 'L6 RPC total_count == L4 independent oracle count', o.count === rpcTotal, `rpc=${rpcTotal} oracle=${o.count}`);
    }

    // ── L6 = L7 : every card on screen is a row the response actually returned ───────────────────
    const returned = first.json.map((r) => String(r.listing_id));
    const cardIds = await page.evaluate(CARD_IDS);
    eq(name, 'L7 at least one card rendered', cardIds.length > 0 || rpcTotal === 0, `cards=${cardIds.length}`);
    const notReturned = cardIds.filter((id) => !returned.includes(id));
    eq(name, 'L7 every rendered card is in the L6 response', notReturned.length === 0,
      `cards=${cardIds.length} not-in-response=${notReturned.length} ${notReturned.slice(0, 4).join(',')}`);
    eq(name, 'L7 no duplicate card on screen', new Set(cardIds).size === cardIds.length,
      `rendered=${cardIds.length} distinct=${new Set(cardIds).size}`);
    // A no-AF search must carry af_canon = SQL NULL (the payload gate) — the negative that makes the
    // card-evidence strip non-vacuous.
    if (!cell.af) eq(name, 'L6 af_canon is NULL on a search with no AF answer',
      first.json.every((r) => r.af_canon == null), `non-null=${first.json.filter((r) => r.af_canon != null).length}`);

    // ── L8 : «عرض المزيد» for real ───────────────────────────────────────────────────────────────
    const seen = new Set(returned);
    let clicks = 0, prevOffset = 0;
    const basePredicates = JSON.stringify(predicatesOf(first.body));
    for (let i = 0; i < PAGES; i++) {
      const y = await page.evaluate(PAGER, 30);
      if (y == null) break;
      await page.evaluate((yy) => window.scrollTo(0, yy - 300), y);
      await sleep(600);
      const before = searches.length;
      const hit = await page.evaluate(PAGER, 30);
      if (hit == null) break;
      const clicked = await page.evaluate((minH) => {
        const c = [];
        for (const e of document.querySelectorAll('div')) {
          if ((e.innerText || '').trim() !== 'عرض المزيد') continue;
          const r = e.getBoundingClientRect();
          if (r.height >= minH) c.push(e);
        }
        if (!c.length) return false;
        c[c.length - 1].click();
        return true;
      }, 30);
      if (!clicked) break;
      clicks++;
      // Wait for the app to actually render more, or for a genuinely-new page request.
      for (let w = 0; w < 40 && searches.length === before; w++) await sleep(400);
      await sleep(2500);

      const more = searches.slice(before);
      for (const s of more) {
        const off = Number(s.body.p_offset ?? 0);
        eq(name, `L8 page@${off} carries the SAME predicates`, JSON.stringify(predicatesOf(s.body)) === basePredicates,
          'a page that changes a predicate silently dropped or invented a filter mid-browse');
        eq(name, `L8 page@${off} advances the offset`, off > prevOffset, `prev=${prevOffset} now=${off}`);
        prevOffset = off;
        const t = Number(s.json?.[0]?.total_count ?? rpcTotal);
        eq(name, `L8 page@${off} total_count unmoved`, t === rpcTotal, `page=${t} first=${rpcTotal}`);
        const dup = [];
        for (const r of s.json) {
          const k = String(r.listing_id);
          if (seen.has(k)) dup.push(k);
          seen.add(k);
        }
        eq(name, `L8 page@${off} introduces no duplicate id`, dup.length === 0, `dups=${dup.length} ${dup.slice(0, 4).join(',')}`);
        if (o.ids) {
          const outside = s.json.map((r) => `${r.source_table}:${r.listing_id}`).filter((k) => !o.ids.has(k));
          eq(name, `L8 page@${off} adds no row outside the L4 truth set`, outside.length === 0,
            `outside=${outside.length} ${outside.slice(0, 4).join(',')}`);
        }
      }
      const vs2 = parseVisibleState(await text());
      const ui2 = vs2.headline == null ? null : Number(String(vs2.headline).replace(/[^\d]/g, ''));
      eq(name, `L8 headline unmoved after click ${clicks}`, ui2 === ui, `before=${ui} after=${ui2}`);
      const ids2 = await page.evaluate(CARD_IDS);
      eq(name, `L8 no duplicate card after click ${clicks}`, new Set(ids2).size === ids2.length,
        `rendered=${ids2.length} distinct=${new Set(ids2).size}`);
      const outOfSet = ids2.filter((id) => !seen.has(id));
      eq(name, `L8 every card after click ${clicks} came from a captured response`, outOfSet.length === 0,
        `unexplained=${outOfSet.length} ${outOfSet.slice(0, 4).join(',')}`);
    }
    if (clicks === 0) {
      await settleCards(page);
      const onScreen = await page.evaluate(CARD_IDS);
      const shown = onScreen.length;
      // THE HONESTY EQUALITY (scripts/verify-result-cap-honesty.ts, asserted live). With no pager the
      // app must either have shown the whole matched set, or say so honestly — a closing line that
      // claims «كل النتائج» over fewer cards than the headline counted is the count/set disagreement
      // this routine exists to find, and it is the shape ops_incident #66 took.
      const closing = (await text()).match(/عرضت لك[^\n]*/g) ?? [];
      const claimsAll = closing.some((l) => /كل النتائج|جميع الإعلانات/.test(l));
      if (claimsAll) {
        const unreachable = first.json.filter((r) => !onScreen.includes(String(r.listing_id)))
          .map((r) => `${r.source_table}:${r.listing_id}`);
        eq(name, 'L8 a closing line claiming ALL is backed by the whole matched set on screen',
          shown === rpcTotal && unreachable.length === 0,
          `closing=${JSON.stringify(closing.slice(-1))} shown=${shown} total=${rpcTotal} ` +
          `counted-but-never-rendered=${unreachable.length} ${unreachable.slice(0, 6).join(' ')}`);
      } else if (rpcTotal > shown) {
        unreached(name, 'L8 «عرض المزيد»', `pager absent while ${rpcTotal} > ${shown} shown, and the ` +
          `closing line does not claim completion: ${JSON.stringify(closing.slice(-1))}`);
      } else console.log(`  (L8 n/a — every match is on screen: ${shown} of ${rpcTotal})`);
    }
  } catch (e) {
    // A harness failure is UNDETERMINED, never a product bug (AUTONOMOUS_INCIDENT_LOOP.md §6).
    unreached(name, 'chain completed', `HARNESS: ${String(e).slice(0, 200)}`);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

const DEFAULT_CELLS = [
  { label: 'مكة/بيع/شقة',            city: 'مكة المكرمة',     deal: [],                                group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'المدينة/إيجار-سنوي/شقة',  city: 'المدينة المنورة', deal: ['إيجار', 'شراء', 'سنوي'],          group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'الهفوف/بيع/فيلا',         city: 'الهفوف',          deal: [],                                group: 'الفلل والبيوت',        type: 'فيلا' },
  { label: 'خميس-مشيط/بيع+إيجار/شقة', city: 'خميس مشيط',       deal: ['إيجار'],                          group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'جازان/بيع/شقة',           city: 'جازان',           deal: [],                                group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'الطائف/تجاري/محل',        city: 'الطائف', category: 'تجاري', deal: ['إيجار', 'شراء', 'سنوي'], group: 'التجزئة والمكاتب',     type: 'محل' },
  { label: 'سكاكا/بيع/شقة',           city: 'سكاكا',           deal: [],                                group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'بيشة/بيع+إيجار/شقة',      city: 'بيشة',            deal: ['إيجار'],                          group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'MOB ينبع/إيجار-شهري/شقة', city: 'ينبع', mobile: true, deal: ['إيجار', 'شراء', 'شهري', 'سنوي'], group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'MOB عرعر/بيع/شقة',        city: 'عرعر', mobile: true, deal: [],                              group: 'الشقق والسكن المشترك', type: 'شقة' },
  { label: 'MOB القطيف/بيع+إيجار/فيلا', city: 'القطيف', mobile: true, deal: ['إيجار'],                    group: 'الفلل والبيوت',        type: 'فيلا' },
  { label: 'MOB الجبيل/إيجار-سنوي/شقة', city: 'الجبيل', mobile: true, deal: ['إيجار', 'شراء', 'سنوي'],    group: 'الشقق والسكن المشترك', type: 'شقة' },
];

const CELLS = (process.env.RT_CELLS ? JSON.parse(process.env.RT_CELLS) : DEFAULT_CELLS)
  .filter((c) => !process.env.RT_ONLY || c.label.includes(process.env.RT_ONLY));

for (const c of CELLS) {
  await runChain(c);
  await sleep(1500);   // production safety envelope (§40.6): sequential, well under 1.5 searches/s
}

console.log(`\n──────── ${rows.length} equalities asserted across ${CELLS.length} chain(s) ────────`);
if (notReached.length) console.log(`\n${notReached.length} layer(s) NOT REACHED (not proved, not counted as passes):\n  ${notReached.join('\n  ')}`);
console.log(fails === 0
  ? `\n✓ every equality held`
  : `\n✗ ${fails} equality/equalities FAILED:\n` + rows.filter((r) => !r.ok).map((r) => `    • [${r.chain}] ${r.label}${r.detail ? `\n      ${r.detail}` : ''}`).join('\n'));
process.exit(fails === 0 ? 0 : 1);
