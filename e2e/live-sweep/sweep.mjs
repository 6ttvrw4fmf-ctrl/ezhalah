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

// The RPC serves at most one page (1,500). An ID-set comparison is only meaningful when the WHOLE
// eligible set fits inside it; above that the client legitimately holds a page of a larger set and
// only the count is comparable. Kept below the cap so a set sitting exactly at 1,500 is never
// mistaken for a complete one.
const ID_SET_CAP = 1200;

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

// ── الحي: the REQUEST's label is not always the SERVED label ─────────────────────────────────────
// The RPC matches a حي on a NORMALISED token (norm_district_tok), so «حي المهدية» and «المهدية» are
// one place to it. This oracle deliberately does not reimplement that normaliser (doing so would
// make agreement self-confirmation), and instead compares the SERVED label exactly — which is only
// valid while the label the request carries IS a served label.
//
// It frequently is not. The district picker is fed by district_options_ar (the loc_catalog canonical
// name, e.g. «حي المهدية»), while search_listings_ar stores its own canonical rendering of the same
// حي (e.g. «المهدية», 8,079 rows in الرياض). Measured 2026-08-26 over every (city, served label)
// pair the picker can reach: 1,874 agree exactly, 176 differ ONLY by the leading «حي », and 32
// differ otherwise. Before this, all 208 produced `district_ar=in.("حي المهدية")` → 0 rows → a
// confident «RPC 2470 vs independent DB 0» DEFECT against a product that was exactly right (the
// 2,470 it served = 2,467 Residential-macro rows + 3 macro-'both' «عمارة» rows in residential
// tables, with the 3 Commercial «أرض تجارية» rows correctly excluded). That is §40.7's cardinal
// sin — an oracle accusing the product for its own imprecision — and it fires on 29% of the index's
// (city, district) pairs, which carry no «حي » prefix at all.
//
// So the label is RESOLVED against what is actually served, using PostgREST's own operators:
// probe each candidate spelling inside the request's own city scope and keep the ones that exist.
// Nothing matches ⇒ the oracle cannot express this حي faithfully ⇒ it REFUSES and says so, rather
// than reporting its own blindness as a matching failure. The refusal is the honest half: it keeps
// the 32 residual cases from becoming false defects WITHOUT silencing the layer for the 2,050 it
// can express, and a resolved label makes a later db≠rpc a real finding again.
const stripHayy = (s) => String(s ?? '').replace(/^\s*ح[يى]\s+/, '').trim();
/** Candidate spellings of one حي, most specific first. PURE — the unit test pins this. */
export function districtLabelVariants(label) {
  const bare = stripHayy(label);
  return [...new Set([String(label ?? '').trim(), bare, `حي ${bare}`].filter(Boolean))];
}
/** Does this exact served label exist inside the request's own city scope? */
async function servedLabelExists(label, cityScopeFilter) {
  const q = `${SUPA}/rest/v1/search_listings_ar?select=listing_id&production_ready=is.true`
    + `&district_ar=eq.${encodeURIComponent(label)}${cityScopeFilter}`;
  try {
    const r = await fetch(q, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(30000) });
    const cr = r.headers.get('content-range');
    return cr && cr.includes('/') ? Number(cr.split('/')[1]) > 0 : null;
  } catch { return null; }
}
/**
 * Resolve every requested حي to the label(s) actually served in that city.
 * → { labels } when all resolved · { unresolved } when any could not be, so the caller can refuse.
 */
async function resolveDistrictLabels(districts, cityScopeFilter) {
  const labels = [], unresolved = [];
  for (const d of districts) {
    const hits = [];
    for (const v of districtLabelVariants(d)) {
      if (await servedLabelExists(v, cityScopeFilter)) hits.push(v);
    }
    if (hits.length) labels.push(...hits); else unresolved.push(d);
  }
  return unresolved.length ? { unresolved } : { labels: [...new Set(labels)] };
}

// ── the published taxonomy, fetched as DATA (never a hardcoded list — §1) ────────────────────────
// known_type_ar maps a نوع to its macro category. The oracle needs it to express p_category the way
// the PRODUCT defines it ("this type belongs to سكني"), which is a taxonomy fact, not RPC code. Two
// types are macro 'both' (عمارة, غير معروف) and are placed by the source table's own suffix.
let _taxonomy = null;
async function taxonomy() {
  if (_taxonomy) return _taxonomy;
  try {
    const r = await fetch(`${SUPA}/rest/v1/known_type_ar?select=type_ar,macro`, { headers: H, signal: AbortSignal.timeout(30000) });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    _taxonomy = rows;
  } catch { return null; }
  return _taxonomy;
}

/** LAYER 5b — the DB's own ID SET, so a count that matches by coincidence cannot pass. */
async function dbIds(filters, cap) {
  const q = `${SUPA}/rest/v1/search_listings_ar`
    + `?select=source_table,listing_id&production_ready=is.true&${filters}&limit=${cap}`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(q, { headers: H, signal: AbortSignal.timeout(60000) });
      const rows = await r.json();
      if (Array.isArray(rows)) return rows.map((x) => `${x.source_table}:${x.listing_id}`);
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

/** LAYER 4b — the RPC's OWN ID list. An ARRAY, not a Set: repeats are a finding, not a detail. */
const rpcIds = async (body, cap) => {
  const j = await post(SEARCH_RPC, { ...body, p_limit: cap, p_offset: 0, p_per_platform: null });
  return Array.isArray(j) ? j.map((r) => `${r.source_table}:${r.listing_id}`) : null;
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
// «not offered» must mean the PRODUCT did not offer it — never "the list had not rendered yet".
// This waited a flat 2,400 ms with no retry, so a slow suggestion fetch (this harness reaches
// production through an egress proxy) turned a perfectly offered city into a skipped journey — and a
// skipped journey costs a COVERAGE FLOOR. Seen 2026-08-26 on بريدة, a top-10 city with 4,850
// listings that the very same run had already searched successfully at the RPC layer.
//
// The predicate is unchanged — same option shape, same match — it is only POLLED until the options
// render instead of being sampled once. A city the product genuinely does not offer still returns
// false at the timeout, so this cannot mask a real product refusal (§41.13).
const CITY_OPTION_TIMEOUT_MS = 12000;
async function pickCity(page, city) {
  const input = page.locator('[data-testid="city-input"]');
  await input.click(); await input.fill(city);
  const optionAt = (c) => {
    const el = [...document.querySelectorAll('div')].filter((e) => {
      const t = (e.innerText || '').trim();
      return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
    }).pop();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const appeared = await page.waitForFunction(
    (c) => {
      const el = [...document.querySelectorAll('div')].filter((e) => {
        const t = (e.innerText || '').trim();
        return t.startsWith(c) && t.includes('إعلان') && t.length < 46;
      }).pop();
      return !!el;
    }, city, { timeout: CITY_OPTION_TIMEOUT_MS }).then(() => true).catch(() => false);
  if (!appeared) return false;
  const hit = await page.evaluate(optionAt, city);
  if (!hit) return false;
  await page.mouse.click(hit.x, hit.y); await sleep(1300);
  // The commit is the assertion, not the click (§41.13): a click that missed leaves the field empty
  // and the search would later be REFUSED, which reads as a broken product instead of a harness miss.
  const committed = await input.inputValue().catch(() => '');
  return !!committed && (committed.includes(city) || city.includes(committed));
}
// ── WHEN HAS A SEARCH SETTLED? ───────────────────────────────────────────────────────────────────
// Every terminal state the results screen can reach, as ONE predicate shared by every journey.
// It is a "the search has finished" signal, NOT an assertion — assertChain still runs all six
// layers afterwards, so widening it can never turn a failure into a pass.
//
// 2026-08-26: it previously listed only the «لقينا», «ما لقينا» and «ما فيه» openings, and therefore
// did not recognise the «ما لقيت …» family. Production answers an honest zero INSIDE a selected حي with
// «ما لقيت نتائج في الحي المحدد — لكن فيه خيارات في أحياء ثانية بنفس المدينة. تبيني أوسّع المنطقة؟»
// — correct behaviour (it OFFERS to widen, it never widens silently, §13). The harness simply could
// not see it: «ما لقيت», not «ما لقينا». Every district-scoped journey that lands on an honest zero
// therefore hung for the full 70 s and died, which is what killed the trending-district journey on
// بقعاء and failed the whole run on a missed coverage floor while production was perfectly healthy
// (proven separately: سكني/بيع/بقعاء returns «لقينا 87 إعلان»). Another §40.7 harness-failure-wearing-
// a-product-failure's-clothes, and a coverage floor is exactly what it took out.
//
// The alternation is derived from the user-facing strings in src/i18n.tsx and PINNED against them by
// scripts/verify-live-sweep-coverage-contract.ts, so a new zero-state phrasing cannot silently
// reintroduce the hang. «ما لقينا» needs no branch of its own — it contains «لقينا».
export const SETTLED_RE = /لقينا|ما لقيت|ما فيه/;
const runSearch = async (page) => {
  await page.getByText('بحث', { exact: true }).first().click();
  await page.waitForFunction((src) => new RegExp(src).test(document.body.innerText),
    SETTLED_RE.source, { timeout: 70000 });
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
function dbFilterFromRequest(req, tax) {
  const enc = encodeURIComponent;
  const unsupported = [];
  // What STAYS unexpressible, and why — each is a deliberate refusal, not an oversight:
  //   p_directions  norm_direction_ar() is the RPC's own normaliser; reimplementing it would make
  //                 agreement self-confirmation rather than evidence (the norm_district_tok rule).
  //   p_amenities   the RPC validates the token vocabulary and fails the whole predicate on an
  //                 unknown token; expressing the boolean columns without that gate would silently
  //                 disagree exactly when a bad token is sent — the case worth catching.
  //   p_platforms   diversity/ranking territory, not matching.
  for (const k of ['p_directions', 'p_platforms']) {
    const v = req?.[k];
    if (v != null && !(Array.isArray(v) && v.length === 0)) unsupported.push(k);
  }
  if (unsupported.length) return { comparable: false, reason: `not expressible here: ${unsupported.join(',')}` };

  // ── الحي: expressible, but only inside ONE city ────────────────────────────────────────────────
  // The product's promise (§9) is "every result belongs to ≥1 selected حي". The RPC keeps that
  // promise by comparing a NORMALISED token; this oracle keeps it by comparing the SERVED LABEL
  // exactly. Two different implementations of one contract — which is the whole point of layer 5,
  // and is why this is not a copy of the RPC.
  //
  // They coincide only because §42.1 guarantees ONE canonical rendering per (city_id, token). That
  // guarantee is per-CITY: 232 tokens are rendered differently in different cities (measured
  // 2026-08-24), so across a multi-city request label-equality would legitimately under-count and
  // this oracle would accuse a healthy product. One city → the guarantee holds → exact and safe.
  // More than one → say so and skip, rather than guess.
  //
  // Deliberately NOT excluded: «ناوان» and «العمارية», the 2 labels (of 1,575) whose English
  // district_name_bridge entry contributes a different token («جعرانة»). Today neither city holds a
  // جعرانة listing, so the extra token yields nothing and the two agree. If that ever changes the
  // user is getting a حي they did not select, and this oracle SHOULD fail — hardcoding them out
  // would be building the blind spot back in.
  if (req.p_districts?.length) {
    if ((req.p_cities?.length ?? 0) !== 1) {
      return { comparable: false,
               reason: `p_districts with ${req.p_cities?.length ?? 0} cities: one canonical rendering is only guaranteed per city` };
    }
  }

  let f = '';
  if (req.p_districts?.length) f += `&district_ar=in.(${enc(req.p_districts.map((d) => `"${d}"`).join(','))})`;
  // p_region_ids is a plain column predicate in the served index, so it needs no interpretation.
  if (req.p_region_ids?.length) f += `&region_id=in.(${req.p_region_ids.map((n) => Number(n)).join(',')})`;
  if (req.p_deal) f += `&deal_ar=eq.${enc(req.p_deal)}`;
  if (req.p_rent_period === 'سنوي') f += `&or=(rent_period_ar.eq.${enc('سنوي')},and(rent_period_ar.eq.${enc('شهري')},rent_now_pay_later.is.true))`;
  if (req.p_rent_period === 'شهري') f += '&payment_monthly=is.true&rent_now_pay_later=not.is.true';
  if (req.p_cities?.length) f += `&city_ar=in.(${enc(req.p_cities.map((c) => `"${c}"`).join(','))})`;

  // ── the SCOPE arm: (tables ∧ types) OR (tables2 ∧ types2) ─────────────────────────────────────
  // p_tables IS the category scope (residential vs commercial source tables) — omitting it was the
  // 36,916-vs-39,883 false alarm on the first run. p_tables2/p_types2 carry the SECOND arm: a
  // Residential-macro search still reaches commercial tables for types that live in both.
  const inList = (xs) => `(${xs.map((x) => `"${x}"`).join(',')})`;
  const arm = (tables, types) => {
    const parts = [];
    if (tables?.length) parts.push(`source_table.in.${inList(tables)}`);
    if (types?.length) parts.push(`type_ar.in.${inList(types)}`);
    return parts.length > 1 ? `and(${parts.join(',')})` : (parts[0] ?? null);
  };
  const a1 = arm(req.p_tables, req.p_types);
  const a2 = (req.p_tables2?.length && req.p_types2?.length) ? arm(req.p_tables2, req.p_types2) : null;
  const clauses = [];
  if (a1 && a2) clauses.push(`or(${a1},${a2})`);
  else if (a1) clauses.push(a1);
  else if (a2) clauses.push(a2);

  // ── the CATEGORY gate, expressed from the PUBLISHED TAXONOMY, not from the RPC ────────────────
  // p_category means "this نوع belongs to سكني/تجاري". That is a fact recorded in known_type_ar, so
  // the oracle reads the taxonomy as data and applies it itself. Two types are macro 'both'
  // (عمارة, غير معروف) and are placed by the source table's own suffix.
  if (req.p_category) {
    if (!tax) return { comparable: false, reason: 'known_type_ar unavailable — refusing to guess the category scope' };
    const macroTypes = tax.filter((t) => t.macro === req.p_category).map((t) => t.type_ar);
    const bothTypes = tax.filter((t) => t.macro === 'both').map((t) => t.type_ar);
    const suffix = req.p_category === 'Residential' ? '*_residential_listings'
                 : req.p_category === 'Commercial' ? '*_commercial_listings' : null;
    if (!macroTypes.length || !suffix) {
      return { comparable: false, reason: `p_category=${req.p_category} has no taxonomy mapping here` };
    }
    clauses.push(bothTypes.length
      ? `or(type_ar.in.${inList(macroTypes)},and(type_ar.in.${inList(bothTypes)},source_table.like.${suffix}))`
      : `type_ar.in.${inList(macroTypes)}`);
  }


  // ── NUMERIC PREDICATES ────────────────────────────────────────────────────────────────────────
  // Two DIFFERENT unset conventions live here and mixing them up manufactures false mismatches:
  //   • السعر and المساحة treat 0 as UNSET (nullif(x,0)) — a 0 budget means "no budget".
  //   • street width / floor / age treat 0 as a REAL VALUE and only null means unset.
  // Each is encoded below exactly as the product defines it, not as whichever is convenient.
  const nz = (v) => (v == null || Number(v) === 0 ? null : Number(v));   // 0-as-unset
  const nn = (v) => (v == null ? null : Number(v));                      // 0 is a real value
  const range = (col, min, max, requireNotNull) => {
    const parts = [];
    if (requireNotNull) parts.push(`${col}.not.is.null`);
    if (min != null) parts.push(`${col}.gte.${min}`);
    if (max != null) parts.push(`${col}.lte.${max}`);
    return parts.length ? (parts.length > 1 ? `and(${parts.join(',')})` : parts[0]) : null;
  };

  // السعر. The contract, per deal mode:
  //   combined (p_deal null) — Buy ∪ Rent, each side judged by its OWN budget, and a side with no
  //     budget set is unconstrained. The Rent side is annual: combined mode has no period selector.
  //   single deal — بيع against price_total; إيجار against price_annual, with a شهري budget
  //     multiplied by 12 because the index stores the ANNUAL price.
  // A listing with no usable price (null or 0) is excluded once a budget applies, and included
  // when none does — that asymmetry is the product's, and the oracle must reproduce it.
  const pmin = nz(req.p_price_min), pmax = nz(req.p_price_max);
  const rmin = nz(req.p_price_min_rent), rmax = nz(req.p_price_max_rent);
  if (req.p_deal == null) {
    const buy = (pmin == null && pmax == null) ? 'deal_ar.eq.بيع'
      : `and(deal_ar.eq.بيع,price_total.gt.0,${range('price_total', pmin, pmax, false)})`;
    const rent = (rmin == null && rmax == null) ? 'deal_ar.eq.إيجار'
      : `and(deal_ar.eq.إيجار,price_annual.gt.0,${range('price_annual', rmin, rmax, false)})`;
    if (!(pmin == null && pmax == null && rmin == null && rmax == null)) clauses.push(`or(${buy},${rent})`);
  } else if (pmin != null || pmax != null) {
    const k = req.p_rent_period === 'شهري' ? 12 : 1;
    if (req.p_deal === 'بيع') clauses.push(`and(price_total.gt.0,${range('price_total', pmin, pmax, false)})`);
    else if (req.p_deal === 'إيجار') {
      clauses.push(`and(price_annual.gt.0,${range('price_annual', pmin == null ? null : pmin * k, pmax == null ? null : pmax * k, false)})`);
    } else return { comparable: false, reason: `p_deal=${req.p_deal} with a budget: unknown deal mode` };
  }

  // المساحة — 0 is unset; once set, an unknown area is excluded (area_m2 must exist).
  const amin = nz(req.p_area_min), amax = nz(req.p_area_max);
  if (amin != null || amax != null) clauses.push(range('area_m2', amin, amax, true));

  // غرف النوم / دورات المياه — exact-list and minimum are ORed, not ANDed.
  for (const [col, exact, min] of [['bedrooms', req.p_beds_exact, req.p_beds_min],
                                   ['bathrooms', req.p_bath_exact, req.p_bath_min]]) {
    const alts = [];
    if (exact?.length) alts.push(`${col}.in.(${exact.map((n) => Number(n)).join(',')})`);
    if (min != null) alts.push(`and(${col}.not.is.null,${col}.gte.${Number(min)})`);
    if (alts.length) clauses.push(alts.length > 1 ? `or(${alts.join(',')})` : alts[0]);
  }

  // عرض الشارع / الدور / عمر العقار — null-unset (0 is a real width, floor and age).
  for (const [col, min, max] of [['street_width_m', nn(req.p_street_width_min), nn(req.p_street_width_max)],
                                 ['floor_number', nn(req.p_floor_min), nn(req.p_floor_max)],
                                 ['property_age', nn(req.p_age_min), nn(req.p_age_max)]]) {
    if (min != null || max != null) clauses.push(range(col, min, max, true));
  }
  if (req.p_age_unknown != null) clauses.push(req.p_age_unknown ? 'property_age.is.null' : 'property_age.not.is.null');
  if (req.p_is_new_construction != null) {
    clauses.push(req.p_is_new_construction ? 'property_age.eq.0' : 'or(property_age.is.null,property_age.neq.0)');
  }

  // التقييم / عدد المراجعات — a plain minimum; a null rating fails it, as in the product.
  if (req.p_rating_min != null) clauses.push(`and(rating.not.is.null,rating.gte.${Number(req.p_rating_min)})`);
  if (req.p_reviews_min != null) clauses.push(`and(reviews_count.not.is.null,reviews_count.gte.${Number(req.p_reviews_min)})`);
  if (req.p_furnished != null) clauses.push(req.p_furnished ? 'furnished.is.true' : 'furnished.is.false');

  // المميزات — each token is a boolean column, ANDed. The token→column mapping is a PRODUCT fact
  // (the chips the user taps), not RPC logic. The RPC additionally fails the WHOLE predicate closed
  // on a token outside its vocabulary; rather than reproduce that behaviour (which would be copying
  // it), the oracle REFUSES to compare when it sees an unknown token — the one case where the two
  // would legitimately differ is then reported, not silently averaged away.
  if (req.p_amenities?.length) {
    const COL = { elevator: 'elevator', parking: 'parking', kitchen: 'kitchen', ac: 'air_conditioner',
      maid_room: 'maid_room', driver_room: 'driver_room', private_entrance: 'private_entrance',
      car_entrance: 'car_entrance', sanitation: 'sanitation', electricity: 'electricity',
      water_supply: 'water_supply', furnished: 'furnished',
      rnpl: 'rent_now_pay_later', rent_now_pay_later: 'rent_now_pay_later' };
    const unknown = req.p_amenities.filter((t) => !COL[t]);
    if (unknown.length) {
      return { comparable: false, reason: `amenity token(s) outside the known vocabulary: ${unknown.join(',')}` };
    }
    for (const t of [...new Set(req.p_amenities.map((t) => COL[t]))]) clauses.push(`${t}.is.true`);
  }
  if (req.p_unit_subtypes?.length) clauses.push(`unit_subtype_ar.in.${inList(req.p_unit_subtypes)}`);

  if (clauses.length) f += `&and=(${enc(clauses.filter(Boolean).join(','))})`;
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
  // الحي first: the request's label may not be the SERVED label (see resolveDistrictLabels). Resolve
  // it against what is actually served, and REFUSE the layer when it cannot be — never accuse.
  let dbReq = req;
  if (req.p_districts?.length) {
    const enc = encodeURIComponent;
    let scope = '';
    if (req.p_cities?.length) scope += `&city_ar=in.(${enc(req.p_cities.map((c) => `"${c}"`).join(','))})`;
    if (req.p_region_ids?.length) scope += `&region_id=in.(${req.p_region_ids.map((n) => Number(n)).join(',')})`;
    const r = await resolveDistrictLabels(req.p_districts, scope);
    if (r.unresolved) {
      dbReq = null;
      j.dbSkipped = `الحي «${r.unresolved.join('», «')}» matches no served label in this city — `
        + 'the index renders it differently and this oracle will not guess (§40.7)';
    } else {
      dbReq = { ...req, p_districts: r.labels };
    }
  }
  const dbf = dbReq ? dbFilterFromRequest(dbReq, await taxonomy()) : { comparable: false, reason: j.dbSkipped };
  if (dbf.comparable) {
    j.db = await dbCount(dbf.filter);
    if (j.db != null && j.db !== j.rpc) { defect(name, 'RPC→DB', `RPC ${j.rpc} vs independent DB ${j.db}`); j.ok = false; }

    // 4b→5b THE ID SETS. Equal counts are not equal sets: one missing row plus one extra row is a
    // real matching bug that every count-only check reports as healthy. Only meaningful while the
    // whole set fits inside one RPC page — above the cap the client holds a page of a larger set,
    // so the count is the comparable quantity and the set comparison is skipped, not faked.
    if (j.rpc != null && j.rpc > 0 && j.rpc <= ID_SET_CAP) {
      const [rIds, dIds] = await Promise.all([rpcIds(req, ID_SET_CAP), dbIds(dbf.filter, ID_SET_CAP)]);
      if (rIds && dIds) {
        const rSet = new Set(rIds); const dSet = new Set(dIds);
        const missing = [...dSet].filter((x) => !rSet.has(x));   // DB has it, the user never sees it
        const extra   = [...rSet].filter((x) => !dSet.has(x));   // served but fails the user's filters
        const dupes   = rIds.length - rSet.size;
        j.idSet = { rpc: rIds.length, db: dIds.length, missing: missing.length, extra: extra.length, duplicates: dupes };
        if (missing.length) { defect(name, 'RPC→DB', `${missing.length} eligible listing(s) never served, e.g. ${missing.slice(0, 3).join(' ')}`); j.ok = false; }
        if (extra.length)   { defect(name, 'RPC→DB', `${extra.length} served listing(s) fail the user's own filters, e.g. ${extra.slice(0, 3).join(' ')}`); j.ok = false; }
        if (dupes > 0)      { defect(name, 'RPC→DB', `${dupes} duplicate listing(s) in one result set`); j.ok = false; }
      } else { j.idSetSkipped = 'id fetch failed'; }
    } else if (j.rpc > ID_SET_CAP) { j.idSetSkipped = `set larger than one RPC page (${j.rpc} > ${ID_SET_CAP})`; }
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
// Read at CALL time, not module-eval time: a caller that imports this module and then sets the env
// var would otherwise get the empty options object it captured on import.
const launchOpts = () => ({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY },
        args: ['--no-sandbox', '--disable-quic', '--ignore-certificate-errors', '--ssl-version-max=tls1.2'] }
    : {}),
});

async function withPage(mobile, fn) {
  const browser = await chromium.launch(launchOpts());
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
