// THE DAILY RPC COVERAGE RUN — layer B, planned stale-first and validated against an independent
// oracle, then written back to the ledger so tomorrow's run knows what today actually covered.
//
//   node e2e/qa-coverage/run.mjs                # the daily heartbeat, DAILY_BUDGET searches
//   QA_BUDGET=120 node e2e/qa-coverage/run.mjs  # smaller, e.g. while production is under load
//
// Every search is read-only and hits ONLY Ezhalah's own index — never a source platform (§40.6).
// Rate is held at the measured safe envelope: concurrency 2, ≤1.5 searches/second sustained.
//
// The run prints the SIX SEPARATE NUMBERS the owner requires (2026-08-28) — it never collapses them
// into one "searches" figure, because a request count is not a coverage claim.
import '../../scripts/lib/searchPacer.mjs';   // shared pacing: wraps fetch, spaces searches against ALL routines
import { pacingStats } from '../../scripts/lib/searchPacer.mjs';
import { createHash } from 'node:crypto';
import { buildRequest, cohortKey, PAGE_LIMIT } from './request.mjs';
import { dbCount, dbFilterFromRequest, cityCatalog } from '../live-sweep/sweep.mjs';
import { planCells, SHAPES, DAILY_BUDGET } from './plan.mjs';

const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const BUDGET = Number(process.env.QA_BUDGET) || DAILY_BUDGET;
const CONCURRENCY = 2;
const MIN_GAP_MS = 700;                       // ≤1.5 searches/sec sustained

// Pacing lives in the SHARED pacer (imported at the top of this file), not here. It wraps fetch, so
// every search this run fires is spaced against every OTHER routine's searches too — which is the
// whole point: a per-run constant is correct in isolation and blind to the sum. See
// scripts/lib/searchPacer.mjs for why this is one module rather than seven rate limiters.
const LEDGER_DIMENSION = 'rpc_cohort';

const rest = (p) => fetch(`${SUPA}/rest/v1/${p}`, { headers: H }).then((r) => r.json());
// A void RPC (ops_qa_record_coverage) answers with an EMPTY body — .json() throws on it, which
// killed the first run AFTER all its searches had been spent. Treat "no body" as "no result".
const rpc = async (fn, body) => {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── harvested truth ──────────────────────────────────────────────────────────────────────────────
const catalog = await rpc('ops_qa_cohort_catalog', {});
if (!Array.isArray(catalog) || !catalog.length) {
  console.error('ops_qa_cohort_catalog() returned nothing — refusing to guess the cohort mapping (§41.6)');
  process.exit(1);
}
const COHORT = new Map(catalog.map((c) => [c.ui_type, c]));
const TYPE2UI = new Map();
for (const c of catalog) for (const t of c.types_ar) if (!TYPE2UI.has(t)) TYPE2UI.set(t, c.ui_type);

// known_type_ar feeds the oracle's category-purity clause; without it the oracle refuses (never guesses).
const tax = await rest('known_type_ar?select=type_ar,macro');

// The city catalog the oracle needs to express the RPC's city_id / match_city_ids arms. Without it
// a city-scoped comparison REFUSES rather than degrading to a label-only filter — the label-only
// form is exactly what produced 12 false COUNT MISMATCHes on 2026-09-01 (see sweep.mjs).
const cityCat = await cityCatalog();
if (!cityCat) { console.error('loc_catalog_city unreadable — the oracle would have to guess the city scope; refusing'); process.exit(1); }

// City → its OWN region (§41.16: never a name-keyed dict; 290 city names repeat across regions).
const CITY = new Map();
for (const r of await rest('loc_catalog_city?select=city_ar,city_id,region_id&limit=20000')) {
  if (!CITY.has(r.city_id)) CITY.set(r.city_id, { city: r.city_ar, regionId: r.region_id });
}

// ── the populated cell grid, discovered LIVE from the index (§1: never a hardcoded list) ─────────
// PostgREST caps a response at its own max-rows, which is NOT the requested limit — paging on
// "did I get fewer than I asked for" therefore stops after page 0 and silently samples a sliver of
// the inventory. Page on the size the SERVER actually returns.
const grid = new Map();
const PAGE_ROWS = 1000;
for (let page = 0; page < 200; page++) {
  const rows = await rest('search_listings_ar?select=type_ar,deal_ar,rent_period_ar,city_id'
    + `&production_ready=is.true&city_id=not.is.null&limit=${PAGE_ROWS}&offset=${page * PAGE_ROWS}`);
  if (!Array.isArray(rows) || !rows.length) break;
  for (const r of rows) {
    const uiType = TYPE2UI.get(r.type_ar);
    const loc = CITY.get(r.city_id);
    if (!uiType || !loc) continue;
    const period = r.deal_ar === 'إيجار' ? (r.rent_period_ar ?? null) : null;
    const k = `${uiType}|${r.deal_ar}|${period ?? ''}|${loc.city}`;
    const e = grid.get(k) ?? { uiType, deal: r.deal_ar, period, city: loc.city, regionId: loc.regionId,
                               macro: COHORT.get(uiType)?.macro, hasOverlay: !!COHORT.get(uiType)?.scope2, n: 0 };
    e.n++;
    grid.set(k, e);
  }
  if (rows.length < PAGE_ROWS) break;
}
const cells = [...grid.values()];

// ── ledger staleness (stalest-first) ─────────────────────────────────────────────────────────────
const seen = new Map();
for (const r of await rpc('ops_qa_sweep_plan', { p_dimension: LEDGER_DIMENSION, p_limit: 100000 }) ?? [])
  seen.set(r.key, Number(r.staleness_days));

// Reserve part of the budget for filter-shape variation, the rest for plain cell coverage.
const shapeSlots = Math.min(SHAPES.length * 3, Math.floor(BUDGET * 0.25));
const chosen = planCells(cells, seen, BUDGET - shapeSlots);
const searches = chosen.map((c) => ({ ...c, tag: 'cell' }));
// A combined-deal probe on the stalest few cells — the third deal state (§40.2) is never optional.
for (const c of chosen.slice(0, Math.max(4, Math.floor(shapeSlots / 5))))
  searches.push({ ...c, tag: 'combined', combined: true, deal: null, period: null });
for (let i = 0; i < shapeSlots - Math.max(4, Math.floor(shapeSlots / 5)); i++)
  searches.push({ ...chosen[i % chosen.length], ...SHAPES[i % SHAPES.length], tag: SHAPES[i % SHAPES.length].tag });

const neverTested = cells.filter((c) => !seen.has(cohortKey(c))).length;
console.log(`CELLS POPULATED: ${cells.length}   never tested before this run: ${neverTested}`);
console.log(`BUDGET: ${BUDGET}   planned: ${searches.length} (${chosen.length} cells + ${searches.length - chosen.length} filter shapes)`);
const staleOfChosen = chosen.map((c) => seen.get(cohortKey(c))).filter((v) => v !== undefined);
console.log(`PLAN IS STALE-FIRST: ${chosen.filter((c) => !seen.has(cohortKey(c))).length} never-tested cells first, `
  + `then oldest ${staleOfChosen.length ? Math.max(...staleOfChosen).toFixed(1) : 0}d`);

// ── fire ─────────────────────────────────────────────────────────────────────────────────────────
const out = [];
const errors = [];
let cursor = 0, lastFire = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= searches.length) return;
    const s = searches[i];
    // No local gap: the shared pacer spaces every search at the fetch layer.
    const body = buildRequest(COHORT.get(s.uiType), s);
    const t0 = Date.now();
    let rows;
    try { rows = await rpc('location_search_candidates_ar', body); } catch (e) { errors.push(`${s.uiType}/${s.city}: ${e.message}`); continue; }
    const ms = Date.now() - t0;
    if (!Array.isArray(rows)) { errors.push(`${s.uiType}/${s.city}: ${JSON.stringify(rows).slice(0, 140)}`); continue; }
    const ids = rows.map((r) => `${r.source_table}:${r.listing_id}`);
    const total = Number(rows?.[0]?.total_count ?? 0) || rows.length;
    // INDEPENDENT ORACLE, on every search — the sweep's own PostgREST filter builder, a different
    // implementation from the RPC's SQL (and §41.15-hardened: it REFUSES rather than guessing when
    // a scope is not faithfully expressible). A count that nothing checked is not evidence.
    let db = null, refused = null;
    const f = dbFilterFromRequest(body, tax, cityCat);
    if (!f.comparable) refused = f.reason;
    else { db = await dbCount(f.filter); if (db == null) refused = 'db unreachable'; }
    out.push({ s, body, total, rows: rows.length, ids, dupes: ids.length - new Set(ids).size,
               hash: createHash('md5').update([...new Set(ids)].sort().join(',')).digest('hex'),
               full: total <= PAGE_LIMIT, ms, db, refused });
    if (db != null && db !== total)
      console.log(`  ✗ COUNT MISMATCH ${s.uiType}/${s.deal ?? 'both'}${s.period ? '/' + s.period : ''}/${s.city}`
        + ` [${s.tag}] rpc=${total} db=${db}`);
    if (out.length % 50 === 0) console.log(`  … ${out.length}/${searches.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ── write coverage back, so tomorrow is planned from what today really did ───────────────────────
const covered = new Set();
for (const r of out) covered.add(cohortKey(r.s));
for (const key of covered)
  await rpc('ops_qa_record_coverage', { p_dimension: LEDGER_DIMENSION, p_key: key, p_result: 'pass',
                                        p_notes: 'daily rpc coverage run' });

// ── the six separate numbers (owner, 2026-08-28) ─────────────────────────────────────────────────
const lat = out.map((r) => r.ms).sort((a, b) => a - b);
const zero = out.filter((r) => r.total === 0).length;
console.log(`
──────── DAILY RPC COVERAGE (heartbeat — NOT a major certification) ────────
PRODUCTION API SEARCHES:      ${out.length}
UNIQUE COHORTS COVERED:       ${covered.size}
STALE COHORTS REVISITED:      ${chosen.filter((c) => (seen.get(cohortKey(c)) ?? 0) >= 7).length}
NEVER-TESTED COHORTS REMAIN:  ${Math.max(0, neverTested - chosen.filter((c) => !seen.has(cohortKey(c))).length)}
ORACLE-CHECKED SEARCHES:      ${out.filter((r) => r.db != null).length}
COUNT MISMATCHES:             ${out.filter((r) => r.db != null && r.db !== r.total).length}
ORACLE REFUSED (not guessed): ${out.filter((r) => r.refused).length}
DUPLICATE IDS SERVED:         ${out.reduce((a, r) => a + r.dupes, 0)}
HONEST-ZERO SEARCHES:         ${zero}
HARNESS ERRORS:               ${errors.length}
LATENCY ms:                   p50 ${lat[Math.floor(lat.length * 0.5)]}  p95 ${lat[Math.floor(lat.length * 0.95)]}  max ${lat[lat.length - 1]}
PACED BACK FOR OTHER LOAD:    ${pacingStats().backedOff} time(s), ${pacingStats().paced} searches paced — count unchanged
(browser journeys and exact-set SQL differentials are reported by their own layers — never merged in)`);
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 15).join('\n'));

// The run is only useful if the oracle can check it; emit the §40.7 ledger blob for ops_qa_load_run.
const blob = out.filter((r) => r.full).map((r, i) => [
  `c${String(i + 1).padStart(4, '0')}`, r.total, r.hash, 't', r.s.uiType,
  r.body.p_deal ?? '', r.body.p_rent_period ?? '', r.s.city ?? '', '',
  r.body.p_region_ids?.[0] ?? '', r.s.areaMin ?? '', r.s.areaMax ?? '',
  (r.s.beds ?? []).join('~'), r.s.bedsMin ?? '', r.s.priceMin ?? '', r.s.priceMax ?? '',
  r.s.tag, r.rows, r.ms,
].join('|')).join('\n');
const outFile = process.env.QA_BLOB_OUT;
if (outFile) { (await import('node:fs')).writeFileSync(outFile, blob); console.log(`\nledger blob → ${outFile} (${out.filter((r) => r.full).length} full-comparison rows)`); }

// WHY THE RUN DOES NOT PUSH THIS ITSELF. `ops_qa_load_run` is granted to anon but is not
// SECURITY DEFINER, so the insert into ops_qa_search_run correctly fails RLS with the client-public
// key this harness holds. Making it definer would open a public bulk-write surface on an ops table
// purely for harness convenience — a security decision, not a testing one, and not this routine's
// to take unilaterally (docs/ops/AGENT_AUTHORITY.md RED list: weakening a safety gate).
// So the canonical ops_qa_diff adjudication is run by an operator holding service access:
//     select ops_qa_load_run($B$<blob>$B$, current_date);  then  select ops_qa_adjudicate(30);
// The inline oracle above already validates EVERY search on every run; ops_qa_diff is the second,
// independent confirmation of that verdict, not the only one.

const mismatches = out.filter((r) => r.db != null && r.db !== r.total);
process.exit(errors.length || mismatches.length ? 1 : 0);
