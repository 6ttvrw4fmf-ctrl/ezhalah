// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LIVE SEARCH & MATCHING SWEEP — drives PRODUCTION like a real user, every run.
//
// WHY THIS EXISTS (owner, 2026-08-23). The hardening pass added 16 static barriers, and static
// barriers are blind in exactly the place users live: they read source and query the database, so
// they cannot see what a browser actually RENDERS. Every defect in the 2026-08-22 hunt — a city
// silently re-scoped to a neighbourhood, a chip promising 8,914 and landing on 2,364, the page cap
// quoted as a match total, a district shown in the field but not searched — was invisible to
// `npm test` and obvious within seconds of driving the real site. So the browser sweep is a
// PERMANENT, SEPARATE layer, not a one-time hunt.
//
// THE SIX LAYERS. Clicking controls proves nothing on its own. Every journey captures the whole
// chain and any mismatch between adjacent layers is a defect:
//
//   1 INTENT    what we set out to search (the plan)
//   2 UI        what the form/page visibly shows (read from rendered text, not internal state)
//   3 REQUEST   the serialized RPC body the app actually sent
//   4 RPC       what that RPC returned (total_count)
//   5 DB TRUTH  an INDEPENDENT count over search_listings_ar via PostgREST filter operators —
//               different implementation, so agreement is evidence, not self-confirmation
//   6 RENDERED  the results the user ends up looking at
//
// ROTATION. Coverage is chosen from `ops_qa_coverage_ledger` stalest-first, so runs do not pile up
// on Riyadh. Floors below guarantee the shape of every run regardless of what rotation picks.
//
// Read-only against the app; the only writes are QA bookkeeping through ops_qa_record_coverage.
//
//   node e2e/live-sweep/sweep.mjs                # full sweep against production
//   BASE_URL=http://localhost:8081 node …        # against a local build
//   SWEEP_ONLY=trending-city node …              # one journey kind while developing
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { chromium, devices } from '@playwright/test';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const OUT_DIR = process.env.SWEEP_OUT || '/tmp/live-sweep';
const ONLY = process.env.SWEEP_ONLY || '';
const SEARCH_RPC = '/rpc/location_search_candidates_ar';

mkdirSync(OUT_DIR, { recursive: true });
const JOURNAL = `${OUT_DIR}/journeys.jsonl`;
writeFileSync(JOURNAL, '');

// ── MINIMUM COVERAGE FLOORS (owner). A run that cannot meet these FAILS: silently shrinking
// coverage is the failure mode a rotation system invites, so the floors are asserted, not hoped for.
export const FLOORS = {
  nonRiyadhCities: 3,
  mobileJourneys: 1,
  afJourneys: 1,
  trendingCityJourneys: 1,
  trendingDistrictJourneys: 1,
  buyRentJourneys: 1,
  monthlyJourneys: 1,
  zeroResultJourneys: 1,
  cardClickBackJourneys: 1,
};

// ── THE PERMANENT WATCHES — one per defect fixed on 2026-08-23. These are not generic checks; each
// re-runs the exact user-visible symptom that was live in production, so a regression is caught by
// the same evidence that found it.
export const WATCHES = [
  'exact-city-never-rescoped',      // «أبها» must stay the city, never «روابي أبها»
  'monthly-af-counts-update',       // the live «عرض N نتيجة» must move when a Monthly answer is picked
  'true-total-never-page-cap',      // never quote 1,500 (the RPC page limit) as the match total
  'buyrent-summary-both-budgets',   // combined mode must name BOTH budgets
  'unknown-period-stays-unknown',   // no «/سنوياً» on a row whose source published no period
  'no-html-entities-rendered',      // no literal &bull; / &quot; / &ndash; in card text
  'typed-district-not-dropped',     // a district typed but not tapped must not vanish silently
  'clarification-answer-commits',   // answering the city-vs-region question must search
  'tab-switch-no-junk-history',     // تصفية ↔ الوكيل الذكي must not push history entries
];

// ── small helpers ────────────────────────────────────────────────────────────────────────────────
const ar = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const num = (s) => { const m = ar(s).match(/[\d][\d,٬]*/); return m ? Number(m[0].replace(/[,٬]/g, '')) : null; };
const lastCount = (text) => num([...String(text).matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].pop()?.[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, tries = 4) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(`${SUPA}/rest/v1${path}`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => null);
      if (j && !j.message) return j;
    } catch { /* retry */ }
    await sleep(1500 * (a + 1));
  }
  return null;
}

/** LAYER 5 — DB truth through PostgREST's OWN filter operators (no shared SQL with the app). */
async function dbCount(filters) {
  const q = `${SUPA}/rest/v1/search_listings_ar?select=listing_id&production_ready=is.true&${filters}`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(60000) });
      const cr = r.headers.get('content-range');
      if (cr && cr.includes('/')) return Number(cr.split('/')[1]);
    } catch { /* retry */ }
    await sleep(1500 * (a + 1));
  }
  return null;
}

/** LAYER 4 — replay the app's OWN captured request body against the live RPC. */
const rpcTotal = async (body) => {
  const j = await post(SEARCH_RPC, { ...body, p_limit: 1, p_offset: 0, p_per_platform: null });
  return Array.isArray(j) ? (j.length ? Number(j[0].total_count) : 0) : null;
};

const ledgerPlan = (dimension, limit) => post('/rpc/ops_qa_sweep_plan', { p_dimension: dimension, p_limit: limit });
const ledgerRecord = (dimension, key, result, notes) =>
  post('/rpc/ops_qa_record_coverage', { p_dimension: dimension, p_key: key, p_result: result, p_notes: (notes ?? '').slice(0, 480) });

// ── findings ─────────────────────────────────────────────────────────────────────────────────────
const findings = [];
const journeys = [];
const defect = (journey, layerPair, detail) => {
  findings.push({ journey, layerPair, detail });
  console.error(`  ✗ DEFECT [${journey}] ${layerPair}: ${detail}`);
};
const note = (msg) => console.error(`    ${msg}`);

// ── UI driving ───────────────────────────────────────────────────────────────────────────────────
// The deal and period rows are INDEPENDENT TOGGLES, not radios: clicking the other one turns BOTH
// on (combined). Selecting exactly one means clicking it, then clicking its partner off.
async function setDeal(page, deal) {
  if (deal === 'both') { await page.getByText('إيجار', { exact: true }).first().click(); await sleep(900); return; }
  if (deal === 'إيجار') {
    await page.getByText('إيجار', { exact: true }).first().click(); await sleep(500);
    await page.getByText('شراء', { exact: true }).first().click(); await sleep(900);
  }
  // 'بيع' is the default already-on state
}
async function setPeriod(page, period) {
  if (period !== 'شهري') return;
  await page.getByText('شهري', { exact: true }).first().click(); await sleep(500);
  await page.getByText('سنوي', { exact: true }).first().click(); await sleep(900);
}
async function pickCity(page, city) {
  const input = page.locator('[data-testid="city-input"]');
  await input.click(); await input.fill(city); await sleep(2400);
  const hit = await page.evaluate((c) => {
    const el = [...document.querySelectorAll('div')].filter((e) => {
      const t = (e.innerText || '').trim();
      return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
    }).pop();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, city);
  if (!hit) return false;
  await page.mouse.click(hit.x, hit.y); await sleep(1300);
  return true;
}
const runSearch = async (page) => {
  await page.getByText('بحث', { exact: true }).first().click();
  await page.waitForFunction(() => /لقينا|ما لقينا|ما فيه/.test(document.body.innerText), null, { timeout: 70000 });
  await sleep(2600);
};

/** LAYER 2 — what the page VISIBLY says (read from rendered text, never internal state).
 *
 * SCOPED TO THE SUMMARY BLOCK ON PURPOSE. A listing DESCRIPTION can contain «الحي:» and «المدينة:»
 * of its own — reading them off the whole page made the sweep accuse the app of re-scoping a city
 * when it had only read a card's prose (first run, 2026-08-23). An oracle that cannot tell the
 * app's own summary from a source's ad text is not allowed to accuse it. */
const visibleState = (page) => page.evaluate(() => {
  const all = document.body.innerText;
  // The summary sits between «ملخص البحث» and the first listing card; fall back to the head of the
  // document (before any card) so a layout change degrades to "read less", never "read a card".
  const cardAt = all.indexOf('الضغط على هذا الإعلان');
  const sumAt = all.indexOf('ملخص البحث');
  const head = all.slice(0, cardAt > 0 ? cardAt : all.length);
  const summary = sumAt >= 0 ? head.slice(sumAt) : head;
  // Summary rows are short bulleted «• label: value» lines — cap the value so a run-on paragraph can
  // never masquerade as a field.
  const line = (label) => {
    const m = summary.match(new RegExp(`[•·]\\s*${label}:\\s*([^\\n]{1,60})`));
    return m ? m[1].trim() : null;
  };
  return {
    city: line('المدينة'), district: line('الحي'), region: line('الإقليم'),
    deal: line('نوع العملية'), type: line('نوع العقار'), budget: line('الميزانية'),
    headline: ([...all.matchAll(/لقينا\s+([\d,٬]+)\s+إعلان/g)].pop() || [])[1] ?? null,
    zero: /ما لقينا|ما فيه نتائج/.test(all),
    entities: (all.match(/&(?:bull|quot|amp|ndash|mdash|nbsp|lt|gt|#\d+);/g) || []).slice(0, 5),
    latinInCards: (all.match(/\b(?:undefined|NaN|\[object)\b/g) || []).slice(0, 5),
  };
});

/**
 * LAYER 5's filter, derived from the app's OWN captured request so the two sides compare the SAME
 * population. Built from PostgREST operators (a different implementation from the app's SQL), so
 * agreement is still real evidence.
 *
 * RETURNS comparable:false RATHER THAN GUESSING. The first run compared a typed/again-scoped search
 * against a filter that carried neither the type nor the residential/commercial table split and
 * "found" three defects that were purely the oracle's own imprecision. A sweep that accuses the
 * product for its own missing predicate is worse than one that stays quiet: skip, and say why.
 */
function dbFilterFromRequest(req) {
  const enc = encodeURIComponent;
  const unsupported = [];
  for (const k of ['p_districts', 'p_region_ids', 'p_price_min', 'p_price_max', 'p_price_min_rent',
                   'p_price_max_rent', 'p_area_min', 'p_area_max', 'p_beds_exact', 'p_beds_min',
                   'p_bath_min', 'p_amenities', 'p_age_min', 'p_age_max', 'p_is_new_construction',
                   'p_street_width_min', 'p_directions', 'p_furnished', 'p_rating_min',
                   'p_reviews_min', 'p_unit_subtypes', 'p_tables2', 'p_platforms']) {
    const v = req?.[k];
    if (v != null && !(Array.isArray(v) && v.length === 0)) unsupported.push(k);
  }
  if (unsupported.length) return { comparable: false, reason: `not expressible here: ${unsupported.join(',')}` };
  let f = '';
  if (req.p_deal) f += `&deal_ar=eq.${enc(req.p_deal)}`;
  if (req.p_rent_period === 'سنوي') f += `&or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`;
  if (req.p_rent_period === 'شهري') f += '&payment_monthly=is.true&rent_now_pay_later=not.is.true';
  if (req.p_cities?.length) f += `&city_ar=in.(${enc(req.p_cities.map((c) => `"${c}"`).join(','))})`;
  if (req.p_types?.length) f += `&type_ar=in.(${enc(req.p_types.map((t) => `"${t}"`).join(','))})`;
  // p_tables IS the category scope (residential vs commercial source tables) — omitting it was the
  // 36,916-vs-39,883 false alarm on the first run.
  if (req.p_tables?.length) f += `&source_table=in.(${enc(req.p_tables.map((t) => `"${t}"`).join(','))})`;
  return { comparable: true, filter: f.replace(/^&/, '') };
}

/** The whole six-layer comparison for one search. */
async function assertChain(name, { intent, page, requests, expectDb }) {
  const ui = await visibleState(page);
  const req = requests.filter((r) => (r.p_limit ?? 0) > 1).pop() ?? requests.pop() ?? null;
  const rendered = ui.headline != null ? num(ui.headline) : (ui.zero ? 0 : null);
  const j = { name, intent, ui, request: req, rpc: null, db: null, rendered, ok: true };

  if (!req) { defect(name, 'UI→REQUEST', 'the search sent no candidates request at all'); j.ok = false; journeys.push(j); return j; }

  // 1→2 INTENT vs UI
  if (intent.city && ui.city && !ui.city.includes(intent.city) && !intent.city.includes(ui.city)) {
    defect(name, 'INTENT→UI', `asked for city «${intent.city}», summary shows «${ui.city}»`); j.ok = false;
  }
  // THE أبها WATCH: an exact city must never come back scoped to a neighbourhood.
  if (intent.city && !intent.district && ui.district) {
    defect(name, 'INTENT→UI', `exact city «${intent.city}» was re-scoped to district «${ui.district}» (exact-city-never-rescoped)`); j.ok = false;
  }
  // 2→3 UI vs REQUEST
  if (intent.deal === 'بيع' && req.p_deal !== 'بيع') { defect(name, 'UI→REQUEST', `deal بيع but request sent p_deal=${JSON.stringify(req.p_deal)}`); j.ok = false; }
  if (intent.deal === 'إيجار' && req.p_deal !== 'إيجار') { defect(name, 'UI→REQUEST', `deal إيجار but request sent p_deal=${JSON.stringify(req.p_deal)}`); j.ok = false; }
  if (intent.deal === 'both' && req.p_deal != null) { defect(name, 'UI→REQUEST', `combined Buy+Rent must send p_deal=null, sent ${JSON.stringify(req.p_deal)}`); j.ok = false; }
  if (intent.period === 'شهري' && req.p_rent_period !== 'شهري') { defect(name, 'UI→REQUEST', `monthly selected but p_rent_period=${JSON.stringify(req.p_rent_period)}`); j.ok = false; }

  // 3→4 REQUEST vs RPC
  j.rpc = await rpcTotal(req);
  if (j.rpc == null) { note('RPC replay unavailable — skipping 4/5 for this journey'); journeys.push(j); return j; }

  // 4→5 RPC vs INDEPENDENT DB TRUTH — derived from the app's OWN request, or skipped honestly.
  const dbf = dbFilterFromRequest(req);
  if (dbf.comparable) {
    j.db = await dbCount(dbf.filter);
    if (j.db != null && j.db !== j.rpc) { defect(name, 'RPC→DB', `RPC ${j.rpc} vs independent DB ${j.db}`); j.ok = false; }
  } else { j.dbSkipped = dbf.reason; }
  // 5→6 what the user actually sees
  if (rendered != null && j.rpc != null && rendered !== j.rpc) {
    defect(name, 'RPC→RENDERED', `page shows ${rendered}, RPC returned ${j.rpc}`); j.ok = false;
  }
  // THE PAGE-CAP WATCH: 1,500 is the RPC page limit and must never be quoted as a match total.
  if (rendered === 1500 && j.rpc !== 1500) {
    defect(name, 'RPC→RENDERED', 'page quoted 1,500 — the RPC page cap — as the match total (true-total-never-page-cap)'); j.ok = false;
  }
  // Arabic rendering watches
  if (ui.entities.length) { defect(name, 'RENDERED', `raw HTML entities on screen: ${ui.entities.join(' ')} (no-html-entities-rendered)`); j.ok = false; }
  if (ui.latinInCards.length) { defect(name, 'RENDERED', `placeholder junk on screen: ${ui.latinInCards.join(' ')}`); j.ok = false; }

  journeys.push(j);
  appendFileSync(JOURNAL, JSON.stringify(j) + '\n');
  return j;
}

// ── the browser ──────────────────────────────────────────────────────────────────────────────────
// Launch options are ENV-DRIVEN and default to nothing, so CI (which runs `playwright install`) is
// byte-for-byte unaffected. They exist for the agent containers the daily routine actually runs in,
// where two things differ and both make every journey fail to launch — which reads as a total
// product outage until you notice it is the harness (SEARCH_MATCH_QA_ENGINEER.md §40.7, §41.1):
//   PW_EXECUTABLE_PATH — the image ships a pinned Chromium build (/opt/pw-browsers/chromium) that
//                        does not match the build number this Playwright driver would download.
//   HTTPS_PROXY        — behind the MITM egress proxy Chromium resets every connection under
//                        TLS 1.3, so the proxy is passed through with --ssl-version-max=tls1.2.
const LAUNCH = {
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY },
        args: ['--no-sandbox', '--disable-quic', '--ignore-certificate-errors', '--ssl-version-max=tls1.2'] }
    : {}),
};

async function withPage(mobile, fn) {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext(
    mobile ? { ...devices['iPhone 13'], locale: 'ar-SA' }
           : { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1100 }, locale: 'ar-SA' });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => {
    if (r.url().includes(SEARCH_RPC)) { try { requests.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ } }
  });
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 });
    await sleep(4200);
    return await fn(page, requests);
  } finally { await browser.close(); }
}

export { BASE, dbCount, rpcTotal, assertChain, dbFilterFromRequest, withPage, setDeal, setPeriod, pickCity, runSearch,
         visibleState, ledgerPlan, ledgerRecord, findings, journeys, defect, note, num, lastCount, sleep };
