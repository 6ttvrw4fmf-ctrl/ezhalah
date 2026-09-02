// THE NARROWING INVARIANT PROBE — §3.1 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md, fired live.
//
//   node e2e/qa-coverage/narrowing.mjs            # default probe budget
//   QA_NARROW_COHORTS=8 node e2e/qa-coverage/narrowing.mjs
//
// «Adding a filter may only REMOVE rows.» Formally, for a search S and an extra selection f:
//
//     results(S + f) ⊆ results(S)          — narrowing never INVENTS a row
//     { r ∈ results(S) : f(r) }  ⊆  results(S + f)   — narrowing never LOSES a qualifying row
//
// Why this layer exists even though every other layer already validates each search on its own:
// both sides of a broken narrowing can be internally consistent. The 2026-08-29 commercial-misfile
// defect passed per-search validation on BOTH sides — «فئة تجاري» was right, «فئة تجاري + نوع محل»
// was right about its own scope — and only the RELATIONSHIP between them was wrong. A per-search
// oracle is structurally incapable of seeing that; this probe is what sees it.
//
// It needs NO external oracle. The narrowed answer is checked against the BROAD answer's own rows,
// using the predicate fields the RPC itself returns (effective_price, area_m2, bedrooms). Two
// independent production answers, checked against each other — nothing here can be blamed on a
// harness reimplementation of the matching predicate, because there isn't one.
//
// Read-only. Hits ONLY Ezhalah's own index, never a source platform (§40.6), at the measured safe
// envelope (concurrency 2, ≤1.5 searches/sec).
import { buildRequest, PAGE_LIMIT } from './request.mjs';

const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const COHORT_BUDGET = Number(process.env.QA_NARROW_COHORTS) || 14;
const MIN_GAP_MS = 700;
const LEDGER_DIMENSION = 'narrowing_invariant';

// A broad set must be FULLY held to be a valid superset reference: above the page limit the client
// holds one page of a larger set, and a "missing" row may simply be on another page. §39.1.
const MAX_BROAD = PAGE_LIMIT;
const MIN_BROAD = 25;          // below this there is not enough spread to derive a meaningful cut

const rest = (p) => fetch(`${SUPA}/rest/v1/${p}`, { headers: H }).then((r) => r.json());
const rpc = async (fn, body) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastFire = 0;
async function search(cohort, s) {
  const gap = MIN_GAP_MS - (Date.now() - lastFire);
  if (gap > 0) await sleep(gap);
  lastFire = Date.now();
  const body = buildRequest(cohort, s);
  const rows = await rpc('location_search_candidates_ar', body);
  if (!Array.isArray(rows)) throw new Error(`unexpected RPC shape: ${JSON.stringify(rows).slice(0, 140)}`);
  return {
    body,
    rows,
    total: Number(rows?.[0]?.total_count ?? 0) || rows.length,
    ids: rows.map((r) => `${r.source_table}:${r.listing_id}`),
  };
}

// ── harvested truth — never a hardcoded control list (§1, §41.6) ──────────────────────────────────
const catalog = await rpc('ops_qa_cohort_catalog', {});
if (!Array.isArray(catalog) || !catalog.length) {
  console.error('ops_qa_cohort_catalog() returned nothing — refusing to guess the cohort mapping (§41.6)');
  process.exit(1);
}

// City → its OWN region. §41.16: a city NAME does not identify a city (290 names repeat across
// regions), so the region always comes from the same catalog row the name came from.
const cityRows = await rest('loc_catalog_city?select=city_ar,city_id,region_id&limit=20000');
if (!Array.isArray(cityRows) || !cityRows.length) {
  console.error('loc_catalog_city unreadable — refusing to guess a city/region pair (§41.11)');
  process.exit(1);
}

// Stalest-first rotation (§43.2): population never buys a slot.
const stale = new Map();
for (const r of await rpc('ops_qa_sweep_plan', { p_dimension: LEDGER_DIMENSION, p_limit: 100000 }) ?? [])
  stale.set(r.key, Number(r.staleness_days));

const CITY = new Map();
for (const c of cityRows) if (!CITY.has(c.city_id)) CITY.set(c.city_id, { city: c.city_ar, regionId: c.region_id });

// The populated cell grid, discovered LIVE from the index in ONE paging pass (§1: never a hardcoded
// list). Picking the (cohort, city) cell from the grid means the broad search is a single hit —
// probing city after city until one happens to fit would spend dozens of production searches per
// cohort to learn what the index can just be asked (§43.1: never spend budget for its own sake).
const TYPE2UI = new Map();
for (const c of catalog) for (const t of c.types_ar) if (!TYPE2UI.has(t)) TYPE2UI.set(t, c.ui_type);
const grid = new Map();
const PAGE_ROWS = 1000;
for (let page = 0; page < 250; page++) {
  const rows = await rest('search_listings_ar?select=type_ar,deal_ar,rent_period_ar,city_id'
    + `&production_ready=is.true&city_id=not.is.null&limit=${PAGE_ROWS}&offset=${page * PAGE_ROWS}`);
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    const uiType = TYPE2UI.get(r.type_ar), loc = CITY.get(r.city_id);
    if (!uiType || !loc) continue;
    // Only the three single-deal states are probed here; combined mode has no period selector and
    // its budget is a separate parameter pair (p_price_min_rent), covered by verify-rent-period-both.
    if (r.deal_ar === 'إيجار' && !r.rent_period_ar) continue;
    const period = r.deal_ar === 'إيجار' ? r.rent_period_ar : null;
    const k = `${uiType}|${r.deal_ar}|${period ?? ''}|${loc.city}`;
    const e = grid.get(k) ?? { uiType, deal: r.deal_ar, period, city: loc.city, regionId: loc.regionId, n: 0 };
    e.n++;
    grid.set(k, e);
  }
  if (rows.length < PAGE_ROWS) break;
}
// A cell is usable only if its whole eligible set can be held in one page — above the page limit a
// "missing" row may simply be on a page the probe never saw, which is not a defect (§39.1).
const usableCells = [...grid.values()].filter((c) => c.n >= MIN_BROAD && c.n <= MAX_BROAD * 0.8);

// ── the narrowings, derived FROM the broad answer's own rows ──────────────────────────────────────
// A threshold is always placed strictly BETWEEN two observed distinct values, so no row sits on the
// boundary and the probe can never mistake an inclusive/exclusive convention for a defect (§32 is
// where boundary semantics get tested deliberately; this layer must not conflate the two).
function derive(rows, period) {
  const out = [];
  const between = (vals, step = 1) => {
    const d = [...new Set(vals)].sort((a, b) => a - b);
    if (d.length < 2) return null;
    const mid = d[Math.floor(d.length / 2)];
    const below = d.filter((v) => v < mid).pop();
    if (below === undefined) return null;
    // Snap to a multiple of `step` STRICTLY inside (below, mid) so the cut never lands on an
    // observed value: no row sits on the boundary, and an inclusive/exclusive convention can never
    // be mistaken for a defect. §32 tests boundary semantics deliberately; this layer must not
    // conflate the two.
    const cut = Math.ceil((below + 1) / step) * step;
    return cut < mid && cut > below ? cut : null;
  };

  // ── THE UNIT (harness trap, measured 2026-09-02) ───────────────────────────────────────────────
  // `effective_price` comes back ANNUALISED, but a «شهري» search sends its budget in the DISPLAYED
  // (monthly) unit and the RPC multiplies it by 12:
  //     s.price_annual >= p_price_min * (case when p_rent_period='شهري' then 12 else 1 end)
  // Feeding a returned price straight back as a monthly bound therefore asks for a budget 12× too
  // large and returns 0 rows — which reads as production losing every qualifying listing. It is not:
  // production is right on both layers. The cut is chosen as a multiple of 12 in ANNUAL space so
  // that dividing it for the request is exact, with no rounding drift in either direction.
  const monthly = period === 'شهري';
  const toBound = (annualCut) => (monthly ? annualCut / 12 : annualCut);

  const prices = rows.map((r) => r.effective_price).filter((v) => v != null).map(Number);
  const pCut = between(prices, monthly ? 12 : 1);
  if (pCut != null && prices.length >= MIN_BROAD) {
    out.push({ tag: 'price-max', f: { priceMax: toBound(pCut) }, holds: (r) => r.effective_price != null && Number(r.effective_price) <= pCut });
    out.push({ tag: 'price-min', f: { priceMin: toBound(pCut) }, holds: (r) => r.effective_price != null && Number(r.effective_price) >= pCut });
  }

  const areas = rows.map((r) => r.area_m2).filter((v) => v != null).map(Number);
  const aCut = between(areas);
  if (aCut != null && areas.length >= MIN_BROAD) {
    out.push({ tag: 'area-max', f: { areaMax: aCut }, holds: (r) => r.area_m2 != null && Number(r.area_m2) <= aCut });
    out.push({ tag: 'area-min', f: { areaMin: aCut }, holds: (r) => r.area_m2 != null && Number(r.area_m2) >= aCut });
  }

  // Bedrooms is exact membership, so no boundary question arises at all.
  const beds = rows.map((r) => r.bedrooms).filter((v) => v != null).map(Number).filter((v) => v >= 1 && v <= 6);
  const bedTally = new Map();
  for (const b of beds) bedTally.set(b, (bedTally.get(b) ?? 0) + 1);
  const bedPick = [...bedTally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bedPick && bedPick[1] >= 5)
    out.push({ tag: `beds-${bedPick[0]}`, f: { beds: [bedPick[0]] }, holds: (r) => Number(r.bedrooms) === bedPick[0] });

  return out;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
const findings = [];
const covered = new Set();
let probes = 0, broadTried = 0, broadUsable = 0, searches = 0;

// Stalest-first, and at most one cell per (نوع، عملية، فترة) so one big type cannot eat the budget.
const cellKey = (c) => `${c.uiType}|${c.deal}|${c.period ?? ''}`;
const byCohort = new Map();
for (const c of usableCells) {
  const k = cellKey(c);
  // Within a cohort prefer the SMALLEST usable city — it holds a full set and rotates coverage away
  // from the same few big cities every day (§43.2: population never buys a slot).
  if (!byCohort.has(k) || c.n < byCohort.get(k).n) byCohort.set(k, c);
}
const plan = [...byCohort.values()].sort((a, b) => {
  const sa = stale.has(cellKey(a)) ? stale.get(cellKey(a)) : Infinity;
  const sb = stale.has(cellKey(b)) ? stale.get(cellKey(b)) : Infinity;
  return sb - sa;                                   // never-tested first, then stalest
});

for (const p of plan) {
  if (covered.size >= COHORT_BUDGET) break;
  const cohort = catalog.find((c) => c.ui_type === p.uiType);
  const key = cellKey(p);
  const chosenCity = { city: p.city, regionId: p.regionId };

  broadTried++;
  searches++;
  let broad;
  try { broad = await search(cohort, { ...p, city: p.city, regionId: p.regionId }); }
  catch (e) { findings.push({ key, kind: 'HARNESS', detail: e.message }); continue; }
  if (broad.total < MIN_BROAD || broad.total > MAX_BROAD) continue;
  broadUsable++;

  for (const n of derive(broad.rows, p.period)) {
    searches++;
    let narrow;
    try { narrow = await search(cohort, { ...p, city: chosenCity.city, regionId: chosenCity.regionId, ...n.f }); }
    catch (e) { findings.push({ key, kind: 'HARNESS', detail: `${n.tag}: ${e.message}` }); continue; }
    probes++;

    const broadSet = new Set(broad.ids);
    const narrowSet = new Set(narrow.ids);

    // 1 — narrowing invented a row the broad search never returned
    const extra = [...narrowSet].filter((id) => !broadSet.has(id));
    // 2 — narrowing lost a row that still satisfies the added selection
    const shouldHold = broad.rows.filter(n.holds).map((r) => `${r.source_table}:${r.listing_id}`);
    const missing = shouldHold.filter((id) => !narrowSet.has(id));
    // 3 — the narrowed answer served the same listing twice
    const dupes = narrow.ids.length - narrowSet.size;

    if (extra.length || missing.length || dupes) {
      findings.push({
        key, kind: 'NARROWING', city: chosenCity.city, tag: n.tag,
        broadTotal: broad.total, narrowTotal: narrow.total, expected: shouldHold.length,
        extra: extra.length, missing: missing.length, dupes,
        sample: { extra: extra.slice(0, 3), missing: missing.slice(0, 3) },
      });
      console.log(`  ✗ NARROWING ${key} ${chosenCity.city} [${n.tag}]`
        + ` broad=${broad.total} narrow=${narrow.total} expected=${shouldHold.length}`
        + ` extra=${extra.length} missing=${missing.length} dupes=${dupes}`);
    }
  }
  covered.add(key);
  await rpc('ops_qa_record_coverage', {
    p_dimension: LEDGER_DIMENSION, p_key: key,
    p_result: findings.some((f) => f.key === key && f.kind === 'NARROWING') ? 'fail' : 'pass',
    p_notes: `narrowing invariant · ${chosenCity.city} · broad ${broad.total}`,
  });
}

const violations = findings.filter((f) => f.kind === 'NARROWING');
const harness = findings.filter((f) => f.kind === 'HARNESS');
console.log(`
──────── NARROWING INVARIANT (§3.1) ────────
COHORTS PROBED:               ${covered.size}
NARROWING PROBES:             ${probes}
PRODUCTION API SEARCHES:      ${searches}
BROAD SETS FULLY HELD:        ${broadUsable}/${broadTried} candidate searches
INVENTED ROWS (extra):        ${violations.reduce((a, f) => a + f.extra, 0)}
LOST QUALIFYING ROWS:         ${violations.reduce((a, f) => a + f.missing, 0)}
DUPLICATES SERVED:            ${violations.reduce((a, f) => a + f.dupes, 0)}
VIOLATIONS:                   ${violations.length}
HARNESS ERRORS:               ${harness.length}`);
if (harness.length) console.log('HARNESS:\n' + harness.slice(0, 10).map((f) => `  ${f.key}: ${f.detail}`).join('\n'));
if (violations.length) console.log('\nVIOLATIONS:\n' + JSON.stringify(violations, null, 2));
process.exit(violations.length ? 1 : 0);
