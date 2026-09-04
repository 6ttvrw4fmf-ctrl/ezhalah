// LIVE regression barrier: A REGION+CITY SELECTION MUST RETURN EXACTLY THAT COMBINATION.
// Owner-approved 2026-08-26. Runs through the same anon key real clients use — a privileged
// connection could mask an RLS/permission difference (repo rule: verify via the anon key).
//
// THE INVARIANT (owner, 2026-08-26): "If a user selects a region and city, the results must
// correspond to that combination." Saudi place names repeat across regions legitimately, so a
// globally-unique-name rule is wrong: «القويعية» exists in منطقة الرياض (319 listings) AND in
// منطقة المدينة المنورة (8). Run #29 found the global-uniqueness rule in three implementations at
// once and nine live listings were unreachable by every Filter combination as a result.
//
// WHAT THIS PINS, and it is deliberately BOTH sides:
//   1. the production search RPC returns ONLY the selected region's rows for an ambiguous city;
//   2. ops_qa_search_differential — the QA oracle built to mirror that RPC's row gate — returns
//      the SAME count. An oracle that disagrees with the thing it checks is worse than no oracle:
//      it either raises false failures or masks real ones.
//   3. with NO region selected, both return the UNION (319 + 8 = 327), because that is the
//      correct answer to an unscoped question — not a silently-picked single region.
//
// WHY THERE IS NO CODE FIX HERE (2026-08-26). Both the RPC and the oracle resolve a city NAME
// globally (loc_catalog_city / _alias on city_norm) and then enforce the region separately on the
// row via `region_id = any(p_region_ids)`. That is safe, and it is why measured behaviour is
// already exact. mon_detect_city_resolution_ignores_region's structural limb flags any object that
// touches loc_catalog_city without loc_catalog_region, which is a lint that cannot tell "derives a
// canonical city from a name" (the real risk) from "filters on a client-supplied name with region
// enforced separately" (safe) — which is precisely why location_search_candidates_ar already sits
// in ops_city_resolution_exempt. Changing the oracle's CTE would make it DIVERGE from the RPC it
// exists to mirror. So the behaviour is pinned here instead, live, on real ambiguous cities.
//
// NOT wired into `npm test` (CI has no network/DB). Run after any change to
// location_search_candidates_ar or ops_qa_search_differential:
//   node --experimental-strip-types scripts/verify-region-scoped-city-live.ts

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// THE ORACLE REQUIRES A TABLE SCOPE, and getting it wrong fakes a defect.
// `s.source_table = any(p_tables)` evaluates to NULL (not TRUE) when p_tables is NULL, so an
// omitted scope silently returns 0. Worse, a merely INCOMPLETE scope under-counts and looks
// exactly like a real predicate disagreement: the first version of this file hardcoded the seven
// tables holding القويعية and reported "oracle 200 vs RPC 212" for البدائع (7 tables, including
// aqarcity and ramzalqasim) and "173 vs 187" for بيش (13 tables). Both were this test's bug.
//
// So the scope is DERIVED from the rows the search RPC actually returned. That makes the two sides
// answer the same question by construction, and any surviving disagreement is a genuine predicate
// difference rather than an artifact of a stale hand-maintained list that new platforms break.
function scopeOf(rows: any[]): string[] {
  return [...new Set(rows.map((r) => r.source_table).filter(Boolean))] as string[];
}

type Case = { city: string; regionId: number; regionAr: string; label: string };

// Measured live on 2026-08-26. Every one is a REAL ambiguous Saudi city name — the same name
// carrying listings in more than one region.
const CASES: Case[] = [
  { city: 'القويعية', regionId: 1,  regionAr: 'منطقة الرياض',          label: 'riyadh+quwaiiyah' },
  { city: 'القويعية', regionId: 3,  regionAr: 'منطقة المدينة المنورة', label: 'madinah+quwaiiyah' },
  { city: 'البدائع',  regionId: 4,  regionAr: 'منطقة القصيم',          label: 'qassim+badaie' },
  { city: 'البدائع',  regionId: 8,  regionAr: 'منطقة حائل',            label: 'hail+badaie' },
  { city: 'بيش',      regionId: 10, regionAr: 'منطقة جازان',           label: 'jazan+bish' },
  { city: 'بيش',      regionId: 6,  regionAr: 'منطقة عسير',            label: 'asir+bish' },
];

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string, d = '') => { failures++; console.error(`  FAIL ${m}${d ? `\n       ${d}` : ''}`); };

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Search RPC rows for a city, optionally scoped to a region. */
async function search(city: string, regionId: number | null): Promise<any[]> {
  return rpc('location_search_candidates_ar', {
    p_cities: [city], p_region_ids: regionId === null ? null : [regionId], p_limit: 1000, p_offset: 0,
  });
}

/** QA oracle count for the same question, over an explicitly supplied table scope. */
async function oracle(city: string, regionId: number | null, tables: string[]): Promise<number> {
  const rows = await rpc('ops_qa_search_differential', {
    p_tables: tables, p_types: null,
    p_cities: [city], p_region_ids: regionId === null ? null : [regionId],
  });
  return Number(rows?.[0]?.n ?? -1);
}

console.log('verify-region-scoped-city-live');

for (const c of CASES) {
  let rows: any[];
  try { rows = await search(c.city, c.regionId); }
  catch (e) { bad(`§1 ${c.label}: search RPC call failed`, String(e)); continue; }

  const total = Number(rows?.[0]?.total_count ?? -1);
  const offRegion = rows.filter((r) => r.region_ar !== c.regionAr).length;
  const offCity = rows.filter((r) => r.city_ar !== c.city).length;

  // THE CORE ASSERTION. Not "roughly right" — zero rows from any other region, ever.
  if (offRegion === 0) ok(`§1 ${c.label}: 0 off-region rows of ${rows.length} returned (total_count ${total})`);
  else bad(`§1 ${c.label}: ${offRegion} OFF-REGION rows`,
           `a user who picked ${c.regionAr} was shown listings from somewhere else`);

  if (offCity === 0) ok(`§1 ${c.label}: 0 off-city rows`);
  else bad(`§1 ${c.label}: ${offCity} OFF-CITY rows`);

  if (total > 0) ok(`§1 ${c.label}: non-empty (${total}) — the case still exercises real inventory`);
  else bad(`§1 ${c.label}: total_count ${total}`,
           'the corpus went empty, so this case proves nothing — repoint it at a live ambiguous city');

  // §2 the oracle must AGREE with the RPC, or it cannot be used to certify it.
  if (rows.length !== total) {
    bad(`§2 ${c.label}: returned ${rows.length} of ${total} rows`,
        'the scope is derived from the returned page, so a truncated page cannot be compared — raise p_limit');
    continue;
  }
  let n: number;
  try { n = await oracle(c.city, c.regionId, scopeOf(rows)); }
  catch (e) { bad(`§2 ${c.label}: oracle call failed`, String(e)); continue; }
  if (n === total) ok(`§2 ${c.label}: oracle agrees with the RPC (${n}, scope ${scopeOf(rows).length} tables)`);
  else bad(`§2 ${c.label}: oracle ${n} vs RPC ${total}`,
           'the QA oracle disagrees with production — it would raise false failures or mask real ones');
}

// §3 with NO region selected the answer is the UNION, not a silently-picked region.
{
  const city = 'القويعية';
  try {
    const all = await search(city, null);
    const allTotal = Number(all?.[0]?.total_count ?? -1);
    const r1 = Number((await search(city, 1))?.[0]?.total_count ?? -1);
    const r3 = Number((await search(city, 3))?.[0]?.total_count ?? -1);
    if (allTotal === r1 + r3) ok(`§3 no-region ${city} = union of its regions (${r1} + ${r3} = ${allTotal})`);
    else bad(`§3 no-region ${city}: ${allTotal} != ${r1} + ${r3}`,
             'an unscoped city question must return every region, never one guessed region');

    const nAll = await oracle(city, null, scopeOf(all));
    if (nAll === allTotal) ok(`§3 oracle agrees on the unscoped union (${nAll})`);
    else bad(`§3 oracle unscoped ${nAll} vs RPC ${allTotal}`);
  } catch (e) { bad('§3 union case failed', String(e)); }
}

// §4 self-check: the oracle's table scope is load-bearing. If a future edit lets p_tables default,
// an omitted scope returns 0 and §2 would "agree" with an empty RPC result by accident.
{
  try {
    const rows = await rpc('ops_qa_search_differential', {
      p_tables: null, p_types: null, p_cities: ['القويعية'], p_region_ids: [1],
    });
    const n = Number(rows?.[0]?.n ?? -1);
    if (n === 0) ok('§4 oracle with a NULL table scope returns 0 (documented trap, still true)');
    else bad(`§4 oracle NULL table scope returned ${n}`,
             'the documented NULL-scope behaviour changed; re-read the comment in this file');
  } catch (e) { bad('§4 null-scope probe failed', String(e)); }
}

if (failures > 0) {
  console.error(`\nverify-region-scoped-city-live: ${failures} FAILED`);
  process.exit(1);
}
console.log('verify-region-scoped-city-live: all checks passed');
