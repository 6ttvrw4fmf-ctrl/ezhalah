// ONE USER ACTION, READ AT EVERY LAYER, ON PRODUCTION — routine #9's chain driver.
//
// docs/ops/PRODUCTION_RED_TEAM_ENGINEER.md PART 2.1: L1 USER ACTION · L2 FRONTEND REQUEST ·
// L3 RPC PARAMETERS · L4 DB TRUTH SET · L5 DISPLAYED COUNT · L6 RETURNED IDS · L7 CARD EVIDENCE ·
// L8 CONTINUATION. The existing harnesses each cover a contiguous slice; nobody joins L1→L8 on the
// SAME captured request, which is what this does.
//
// WHY ITS OWN REQUEST CAPTURE rather than sweep.mjs's `withPage`: that helper records ONLY
// location_search_candidates_ar. The disagreements this routine owns live BETWEEN the results RPC and
// the COUNT RPCs (top_cities_by_deal_ar / district_options_ar / apartment_guided_counts_ar), so a
// capture that cannot see the count calls cannot see the class. Reading the wire myself is also the
// independence PART 2.2 asks for: the oracle, the reader and the product must not share a program.
//
// Read-only. Ezhalah's own index only, never a source platform (§40.6).

import { chromium, devices } from 'playwright';
import { parseVisibleState } from '../live-sweep/visibleState.mjs';

export const BASE = process.env.BASE_URL || 'https://ezhalah-app.vercel.app';
const SUPA = 'https://aannarbkwcymrotzwdbo.supabase.co';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';   // the app's own publishable key, same as the sweep

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESULTS_RPC = '/rpc/location_search_candidates_ar';
const COUNT_RPCS = ['/rpc/top_cities_by_deal_ar', '/rpc/district_options_ar', '/rpc/apartment_guided_counts_ar'];

/**
 * Drive one journey on production and return every layer's raw reading.
 * `plan`: { deal: 'بيع'|'إيجار'|'both', period: 'سنوي'|'شهري'|null, city, mobile }
 */
export async function chain(plan, body) {
  // The container pins a Chromium build the installed @playwright/test does not expect, so point at
  // the one that IS present rather than downloading (the environment forbids `playwright install`).
  // The proxy args mirror e2e/live-sweep/sweep.mjs launchOpts() — same container, same egress.
  const browser = await chromium.launch({
    executablePath: process.env.PW_EXECUTABLE_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      ...(process.env.HTTPS_PROXY ? ['--disable-quic', '--ignore-certificate-errors', '--ssl-version-max=tls1.2'] : [])],
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  });
  const ctx = await browser.newContext(
    plan.mobile ? { ...devices['iPhone 13'], locale: 'ar-SA' }
                : { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1100 }, locale: 'ar-SA' });
  const page = await ctx.newPage();

  // L2/L3 — the bytes the app actually sent, off the wire. Never the harness's memory of what it clicked.
  const wire = { results: [], counts: [] };
  page.on('request', (r) => {
    const u = r.url();
    let post = null;
    try { post = JSON.parse(r.postData() || '{}'); } catch { return; }
    if (u.includes(RESULTS_RPC)) wire.results.push(post);
    else { const hit = COUNT_RPCS.find((c) => u.includes(c)); if (hit) wire.counts.push({ rpc: hit, post }); }
  });
  // L6 — the ids the client actually holds, off the RESPONSE. Never card text (§41.9: text-shaped keys
  // collided across 150 genuinely distinct مكتب cards).
  // Correlated to its OWN request: autocomplete reuses this RPC at p_limit 1 (§41.5), so an
  // uncorrelated "last response wins" reads a 1-row typeahead reply as page 2 of the results and
  // reports a false pagination repeat (observed on the first run of this driver).
  const responses = [];
  page.on('response', async (resp) => {
    if (!resp.url().includes(RESULTS_RPC)) return;
    let post = null;
    try { post = JSON.parse(resp.request().postData() || '{}'); } catch { return; }
    if (Number(post.p_limit ?? 0) <= 1) return;          // typeahead, not a result search
    try {
      const j = await resp.json();
      if (Array.isArray(j)) responses.push({ rows: j, post });
    } catch { /* non-JSON or already consumed */ }
  });

  try {
    // gotoLive's contract, inlined structurally: retry only the TRANSPORT, still throw when it never loads.
    let loaded = false, lastErr = null;
    for (let a = 1; a <= 3 && !loaded; a++) {
      try { await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 90000 }); loaded = true; }
      catch (e) { lastErr = e; if (a < 3) await sleep(a * 2000); }
    }
    if (!loaded) throw new Error(`page never loaded after 3 attempts: ${lastErr?.message}`);
    await sleep(4200);
    return await body({ page, wire, responses, plan });
  } finally { await browser.close(); }
}

/** Click a control by its exact visible label, scrolling the inner ScrollView first. */
export async function tap(page, label, timeout = 15000) {
  const el = page.getByText(label, { exact: true }).first();
  if (!await el.waitFor({ state: 'attached', timeout }).then(() => true).catch(() => false)) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ timeout: 9000 }).then(() => true).catch(() => false);
  return true;
}

/** The deal toggle, as a user drives it (the two buttons are independent toggles, not a radio). */
export async function setDeal(page, deal) {
  if (deal === 'both') { await tap(page, 'إيجار'); await sleep(900); return; }
  if (deal === 'إيجار') {
    await tap(page, 'إيجار'); await sleep(500);   // Buy+Rent
    await tap(page, 'شراء'); await sleep(900);    // turn Buy off → Rent only
  }
  // 'بيع' is the default already-on state.
}

/** The period toggle. `null` means DO NOT TOUCH IT — the default state every Rent search starts in. */
export async function setPeriod(page, period) {
  if (period === null) return;
  if (period === 'شهري') { await tap(page, 'شهري'); await sleep(500); await tap(page, 'سنوي'); await sleep(900); return; }
  if (period === 'سنوي') { await tap(page, 'سنوي'); await sleep(900); }
}

export async function pickCity(page, city) {
  const input = page.locator('[data-testid="city-input"]');
  await input.click(); await input.fill(city);
  const ok = await page.waitForFunction((c) => {
    const rows = [...document.querySelectorAll('div')].filter((e) => (e.innerText || '').trim().startsWith(c));
    return rows.length > 0;
  }, city, { timeout: 25000 }).then(() => true).catch(() => false);
  if (!ok) return false;
  await sleep(900);
  const row = page.getByText(new RegExp(`^${city}`), { exact: false }).last();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click().catch(() => {});
  await sleep(1600);
  return true;
}

/** «بحث», then WAIT for the app to say it settled — never a flat sleep that reads a half-rendered screen. */
export async function runSearch(page, budgetMs = 45000) {
  const ok = await tap(page, 'بحث');
  if (!ok) return false;
  const settled = await page.waitForFunction(
    () => /لقينا|ما لقيت|ما فيه/.test(document.body.innerText || ''),
    null, { timeout: budgetMs },
  ).then(() => true).catch(() => false);
  await sleep(1500);
  return settled;
}

/** L1 — the app's OWN «ملخص البحث» summary, the sanctioned reader. */
export async function visibleState(page) {
  const all = await page.evaluate(() => document.body.innerText);
  return { ...parseVisibleState(all), raw: all };
}

/**
 * L4 — the INDEPENDENT oracle. PostgREST's own filter operators over search_listings_ar, built ONLY
 * from the captured request. Never our RPC a second time, never a copy of its SQL, never a predicate
 * helper the product also imports (PART 2.2). Returns PROBE_FAILED-style `null` on a failed fetch —
 * a failed fetch is NOT an empty answer.
 */
/**
 * Translate a CAPTURED results-RPC body into PostgREST filter operators. Returns
 * `{ filters }` or `{ unhandled: [...] }` — it REFUSES rather than guesses, because a parameter
 * silently dropped widens the oracle's set until it agrees with whatever the RPC did (PART 2.2 rule 2).
 *
 * There is no `category` column: the category IS the table split, so p_category is translated by the
 * two table lists it produced — (source_table ∈ p_tables) OR (source_table ∈ p_tables2 AND
 * type_ar ∈ p_types2) — which is how the client's own macro filter resolves the dual عمارة type.
 * p_rotation_seed is an ORDERING input with no effect on the set, so it is explicitly ignored rather
 * than left to trip the refusal.
 */
/**
 * The live category → type_ar map, read from `known_type_ar` — the SAME reference table
 * af_eligibility_clause() joins against, and NOT a constant this repo chose. Fetched from the
 * database, so it stays independent of the client (which carries its own CLEAN_MACRO copy).
 * Throws when unreadable: without it the oracle cannot apply category purity and must refuse
 * rather than count a wider set.
 *
 * MEASURED, 2026-09-06: omitting this made the oracle over-count Buy/المدينة المنورة by exactly
 * 1,389 rows — أرض تجارية (1,306) + أرض صناعية (83), both macro='Commercial' sitting in RESIDENTIAL
 * tables. 4,509 − 1,389 = 3,120, the number the screen showed. Production was right; the oracle was
 * the defect. `عمارة` is macro 'both' (a Residential Building in a residential table, a Commercial
 * Building in a commercial one), so 'both' belongs on EVERY category's side.
 */
export async function categoryTypeMap() {
  const r = await fetch(`${SUPA}/rest/v1/known_type_ar?select=type_ar,macro`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`known_type_ar unreadable (${r.status}) — the oracle cannot apply category purity`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('known_type_ar returned no rows — refusing to guess');
  return (category) => rows.filter((x) => x.macro === category || x.macro === 'both').map((x) => x.type_ar);
}

export function oracleFilterFromRequest(p, typesForCategory = null) {
  const inList = (vals) => `(${vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')})`;
  const parts = [];
  if (p.p_deal) parts.push(`deal_ar=eq.${encodeURIComponent(p.p_deal)}`);
  if (p.p_rent_period) parts.push(`rent_period_ar=eq.${encodeURIComponent(p.p_rent_period)}`);
  if (p.p_cities?.length) parts.push(`city_ar=in.${encodeURIComponent(inList(p.p_cities))}`);
  if (p.p_districts?.length) parts.push(`district_ar=in.${encodeURIComponent(inList(p.p_districts))}`);
  if (p.p_platforms?.length) parts.push(`platform=in.${encodeURIComponent(inList(p.p_platforms))}`);
  if (p.p_region_ids?.length) parts.push(`region_id=in.(${p.p_region_ids.join(',')})`);

  // CATEGORY PURITY. A category search does NOT mean "every row in the residential tables": those
  // tables also hold the commercial types the source files under residential (أرض تجارية, أرض صناعية,
  // مستودع, فندق…). When the user picked no explicit type, the residential half is restricted to the
  // category's own types, read from the LIVE known_type_ar map — never from a list this repo wrote.
  const t1 = p.p_tables ?? [], t2 = p.p_tables2 ?? [], ty2 = p.p_types2 ?? [];
  let t1Types = p.p_types?.length ? p.p_types : null;
  if (!t1Types && p.p_category) {
    if (!typesForCategory) return { unhandled: [`p_category=${p.p_category} without the live known_type_ar map`] };
    t1Types = typesForCategory(p.p_category);
    if (!t1Types.length) return { unhandled: [`p_category=${p.p_category} has no types in known_type_ar`] };
  }
  // The type restriction must survive even when no table list came with the request — otherwise a
  // category-only request silently loses category purity and the oracle over-counts (caught while
  // testing this function: `p_tables: []` dropped the restriction and reproduced the 4,509 over-count).
  const half1 = t1.length
    ? (t1Types ? `and(source_table.in.${inList(t1)},type_ar.in.${inList(t1Types)})` : `source_table.in.${inList(t1)}`)
    : (t1Types ? `type_ar.in.${inList(t1Types)}` : null);
  const half2 = (t2.length && ty2.length) ? `and(source_table.in.${inList(t2)},type_ar.in.${inList(ty2)})` : null;
  if (t2.length && !ty2.length) return { unhandled: ['p_tables2 without p_types2'] };
  if (half1 && half2) parts.push(`or=${encodeURIComponent(`(${half1},${half2})`)}`);
  else if (half1) parts.push(`or=${encodeURIComponent(`(${half1})`)}`);
  else if (half2) parts.push(`or=${encodeURIComponent(`(${half2})`)}`);
  else if (p.p_types?.length) parts.push(`type_ar=in.${encodeURIComponent(inList(p.p_types))}`);

  const HANDLED = new Set(['p_deal', 'p_rent_period', 'p_cities', 'p_districts', 'p_platforms',
    'p_region_ids', 'p_tables', 'p_tables2', 'p_types', 'p_types2', 'p_limit', 'p_offset',
    'p_category',        // realised by the table split above
    'p_rotation_seed']); // ordering only — cannot change the SET
  const unhandled = Object.keys(p).filter((k) => k.startsWith('p_') && !HANDLED.has(k)
    && p[k] !== null && p[k] !== undefined && !(Array.isArray(p[k]) && p[k].length === 0));
  return unhandled.length ? { unhandled } : { filters: parts.join('&') };
}

export async function oracleCount(filters) {
  if (!ANON) return null;
  const q = `${SUPA}/rest/v1/search_listings_ar?select=listing_id&production_ready=is.true&${filters}`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(q, {
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact', Range: '0-0' },
        signal: AbortSignal.timeout(60000),
      });
      const cr = r.headers.get('content-range');
      if (cr && cr.includes('/')) return Number(cr.split('/')[1]);
    } catch { /* retry */ }
    await sleep(1500 * (a + 1));
  }
  return null;   // UNKNOWN, never 0
}
