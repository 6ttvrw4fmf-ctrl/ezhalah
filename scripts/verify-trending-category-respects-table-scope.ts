// A CATEGORY COUNT MUST NEVER TRUST A TYPE STRING OVER THE TABLE THE ROW ACTUALLY LIVES IN.
//
// THE DEFECT (owner-reported, 2026-09-05). top_cities_by_deal_ar's p_category membership check
// read: `k.macro = p_category OR (k.macro = 'both' AND <table-suffix case>)`. The table-suffix
// check ran ONLY on the macro='both' branch — for a type whose macro is a single, specific
// category, the clause never verified which physical table the row lives in at all. شقة has
// macro='Residential', so a شقة-typed row sitting in a _commercial_listings table
// (dealapp_commercial_listings#693812, city_ar='مكة المكرمة') was admitted into the Residential
// cohort purely because its TYPE STRING said "Residential" — Trending advertised 556 for
// مكة المكرمة/شقة/إيجار/سنوي while location_search_candidates_ar (scoped by table suffix, the way
// the real client scopes it) and a table-suffix oracle both independently agreed on 555.
//
// This is the same CLASS as the 5-platform searchability bug from the same day
// (feedback_a-count-surface-must-share-the-results-scope): a count surface keeping its own,
// independent definition of scope membership (here: a type's macro) instead of sharing the one the
// results path actually enforces (here: the row's own table suffix). Fixed in
// 20260905045146_top_cities_category_check_must_verify_the_table_too.sql by requiring the
// table-suffix check UNCONDITIONALLY whenever p_category is Residential or Commercial.
//
// WHAT THIS BARRIER ASSERTS, kept GENERAL — not the one row, the whole class:
//
//   PART 1 — DISCOVERY, fleet-wide. known_type_ar's macro is read for every type; every row in
//   search_listings_ar whose type_ar has a SPECIFIC macro (not 'both') but sits in the
//   OPPOSITE-suffix table is a live instance of this bug class, wherever it exists today — not
//   hardcoded to شقة, dealapp, or مكة المكرمة. Reported by name even when the check passes, so a
//   fixed clause that quietly stopped discovering anything would be visible in the log, not silent.
//
//   PART 2a — FLEET-WIDE, for every DISTINCT (category, type) discovery hits — not per city, which
//   would multiply into hundreds of groups for a type like أرض تجارية that touches ~100+ cities:
//   Trending's SUM across every city (top_cities_by_deal_ar) must equal an INDEPENDENT oracle that
//   never calls top_cities_by_deal_ar and never reads known_type_ar — a direct count over
//   search_listings_ar filtered by the CORRECT table suffix for that category. This is the check
//   that catches a leak at ANY scale, including one far bigger than the reported row (see below).
//
//   PART 2b — for a bounded, deterministic SAMPLE (the worst-case city per discovered type, capped,
//   with the exact reported case — مكة المكرمة/شقة — forced in even if not the worst case): the
//   same comparison at city granularity, PLUS the specific mismatched row's id asserted ABSENT from
//   location_search_candidates_ar called the way the real client calls it (p_tables scoped to the
//   matching suffix) — proving Trending and Search agree at the ROW level, not just the total.
//
//   PART 3 — a sweep of ordinary scopes with NO known mismatch, proving the general invariant —
//   Trending count == Search count == the independent oracle — holds even where PART 1 finds
//   nothing today, so this barrier keeps teeth if the fleet's data ever stops exercising the bug.
//
// A FIRST DRAFT of this file grouped by (category, type, CITY) and ran the expensive per-city
// comparison for every group unconditionally. أرض تجارية (Commercial land) alone sits in
// aqar_residential_listings across ~100+ cities — 18,233 rows, entirely invisible to this barrier's
// original Makkah-only ancestor — so that draft fanned out into hundreds of groups, took minutes,
// and printed megabytes. The fleet-wide aggregate (2a) is what actually scales to catch a leak of
// that size; the bounded per-city sample (2b) is what proves the row-level mechanism, not the whole
// fleet one row at a time.
//
// IT FAILS CLOSED. Every path that cannot measure exits non-zero rather than reporting success.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-trending-category-respects-table-scope.ts
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.

import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { liftSearchScope } from './lib/liftSearchScope.ts';

const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
  if (!cond) failures++;
};
/** A barrier that cannot measure must never report success. */
const die = (why: string): never => {
  console.log(`\n✗ SKIP-FAIL: ${why}`);
  process.exit(1);
};

async function rpc(fn: string, args: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    .catch((e) => die(`${fn} unreachable — ${(e as Error).message}`));
  if (!res.ok) die(`${fn} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as any[];
}

async function restCount(qs: string, table = 'search_listings_ar'): Promise<number> {
  const r = await fetch(`${REST}/${table}?select=listing_id&${qs}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    .catch((e) => die(`restCount unreachable — ${(e as Error).message}`));
  if (!r.ok && r.status !== 416) die(`restCount ${r.status} on ${qs.slice(0, 200)}: ${(await r.text()).slice(0, 200)}`);
  const cr = r.headers.get('content-range') || '';
  return cr.includes('/') ? Number(cr.split('/')[1]) : 0;
}

async function restRows<T = any>(qs: string, table = 'search_listings_ar'): Promise<T[]> {
  const r = await fetch(`${REST}/${table}?${qs}`, { headers: H }).catch((e) => die(`restRows unreachable — ${(e as Error).message}`));
  if (!r.ok) die(`restRows ${r.status} on ${qs.slice(0, 200)}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T[];
}

const enc = (s: string) => encodeURIComponent(s);
const SUFFIX: Record<'Residential' | 'Commercial', string> = { Residential: 'residential', Commercial: 'commercial' };
const OPPOSITE: Record<'Residential' | 'Commercial', 'Residential' | 'Commercial'> = { Residential: 'Commercial', Commercial: 'Residential' };

/** THE CORE PREDICATE THIS BARRIER EXISTS TO CATCH, extracted as a real, standalone function rather
 *  than left inline — a row's type has a SPECIFIC macro, but the table it physically lives in is the
 *  OPPOSITE suffix. This is exactly what the live DISCOVERY query below asks the database (the query
 *  is the same SUFFIX/OPPOSITE maps, expressed as a Postgres `like` filter instead of a JS `endsWith`
 *  — not a re-typed copy of a different computation), so mutating THIS function is mutating the same
 *  logic the discovery step runs, not a decorative stand-in for it. */
function isCategoryTableMismatch(typeMacro: 'Residential' | 'Commercial', sourceTable: string): boolean {
  return sourceTable.endsWith(`_${SUFFIX[OPPOSITE[typeMacro]]}_listings`);
}

// MUTATION PROOF (hermetic — no network, runs on every invocation including offline lint/CI passes
// that never reach the live checks below). Applies the exact function above to inputs modelled
// directly on the real production row that started this file: dealapp_commercial_listings#693812,
// type_ar='شقة' (macro='Residential'), sitting in a _commercial_listings table.
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.log(`\n✗ MUTATION PROOF FAILED: ${label}`); process.exit(1); }
};
mustCatch('a Residential-macro type sitting in a _commercial_listings table is flagged as a mismatch (the exact reported shape: شقة in dealapp_commercial_listings)',
  isCategoryTableMismatch('Residential', 'dealapp_commercial_listings') === true);
mustCatch('a Commercial-macro type sitting in a _residential_listings table is flagged as a mismatch (the symmetric case: أرض تجارية in aqar_residential_listings)',
  isCategoryTableMismatch('Commercial', 'aqar_residential_listings') === true);
mustCatch('a Residential-macro type sitting in its OWN residential-suffix table is NOT flagged — the predicate must not cry wolf on ordinary, correctly-placed rows',
  isCategoryTableMismatch('Residential', 'dealapp_residential_listings') === false);
mustCatch('a Commercial-macro type sitting in its OWN commercial-suffix table is NOT flagged',
  isCategoryTableMismatch('Commercial', 'aqar_commercial_listings') === false);
// The mutation this predicate must die under: reverting to the pre-fix shape (macro alone decides
// membership, the table is never consulted) would make EVERY row "correctly placed" — nothing left to
// discover. A function that always returns false can never distinguish the fixed case from the
// mismatch it exists to find, so asserting BOTH the positive (mismatch caught) and negative (ordinary
// row left alone) cases above is what makes that regression impossible to pass silently.

console.log('\nTrending vs Search — a category count must respect the table the row actually lives in\n');

// ── the type->macro map, fleet-wide, never hardcoded ────────────────────────────────────────────
const typeRows = await restRows<{ type_ar: string; macro: string }>(`select=type_ar,macro`, 'known_type_ar');
if (!typeRows.length) die('known_type_ar returned no rows — cannot discover anything');
const specificTypes: Record<'Residential' | 'Commercial', string[]> = { Residential: [], Commercial: [] };
for (const t of typeRows) {
  if (t.macro === 'Residential' || t.macro === 'Commercial') specificTypes[t.macro].push(t.type_ar);
}
check('known_type_ar has specific-macro types on both sides',
  specificTypes.Residential.length > 0 && specificTypes.Commercial.length > 0,
  `Residential=${specificTypes.Residential.length} Commercial=${specificTypes.Commercial.length}`);

// ── PART 1 — DISCOVERY: any row whose type says one category but whose table says the other ─────
type Mismatch = { macro: 'Residential' | 'Commercial'; type_ar: string; source_table: string; listing_id: number; city_id: number; city_ar: string };
const mismatches: Mismatch[] = [];
for (const macro of ['Residential', 'Commercial'] as const) {
  const types = specificTypes[macro];
  if (!types.length) continue;
  const wrongSuffix = SUFFIX[OPPOSITE[macro]];
  const qs = `select=source_table,listing_id,city_id,city_ar,type_ar` +
    `&type_ar=in.(${types.map(enc).join(',')})` +
    `&source_table=like.*_${wrongSuffix}_listings` +
    `&production_ready=eq.true`;
  const rows = await restRows<{ source_table: string; listing_id: number; city_id: number; city_ar: string; type_ar: string }>(qs);
  for (const r of rows) mismatches.push({ macro, ...r });
}
console.log(`  discovered ${mismatches.length} live mismatch(ed) row(s): a specific-macro type sitting in the opposite-suffix table`);
const byTypeTable = new Map<string, number>();
for (const m of mismatches) {
  const k = `${m.macro}|${m.type_ar}|${m.source_table}`;
  byTypeTable.set(k, (byTypeTable.get(k) ?? 0) + 1);
}
for (const [k, n] of [...byTypeTable.entries()].sort((a, b) => b[1] - a[1])) {
  const [macro, type_ar, source_table] = k.split('|');
  console.log(`      ${macro} type «${type_ar}» in ${source_table}: ${n} row(s)`);
}

// The correct-suffix table lists come from the REAL exported RES_TABLES/COM_TABLES (lifted out of
// src/data/remote.ts, never re-typed here — see scripts/lib/liftSearchScope.ts), not from a REST
// rediscovery. A first draft tried `select=source_table&limit=1000` and took the Set() of whatever
// 1000 RAW ROWS (not distinct values) happened to sort first — on this fleet that was exactly TWO
// tables out of ~35, so p_tables silently excluded almost everything and Search read as 0 for scopes
// with tens of thousands of real rows. RES_TABLES/COM_TABLES are the same lists resTables()/
// comTables() derive from and the same ones location_search_candidates_ar is actually called with in
// production — sharing them is also just correct, not merely a workaround for the rediscovery bug.
const ROOT = join(import.meta.dirname, '..');
const lifted = await liftSearchScope(ROOT).catch((e) => die(`could not lift RES_TABLES/COM_TABLES out of src/data/remote.ts — ${(e as Error).message}`));
const tablesBySuffix: Record<'Residential' | 'Commercial', string[]> = {
  Residential: lifted.RES_TABLES as string[],
  Commercial: lifted.COM_TABLES as string[],
};

// The oracle's table set is the EXACT lifted RES_TABLES/COM_TABLES list, not a LIKE pattern — a
// retired platform can leave a stray production_ready row behind on a table that still ends in the
// right suffix but that Search no longer includes; sharing the same table SET (not just the same
// suffix) keeps the oracle from disagreeing with Search over that edge case.
const inTables = (tables: string[]) => `(${tables.map(enc).join(',')})`;

async function assertScope(label: string, macro: 'Residential' | 'Commercial', types: string[], city_ar: string, city_id: number, sampleRow?: Mismatch) {
  const oracleCount = await restCount(
    `city_id=eq.${city_id}&type_ar=in.(${types.map(enc).join(',')})&source_table=in.${inTables(tablesBySuffix[macro])}&production_ready=eq.true`
  );
  // p_tables on BOTH calls — matching how the real client calls Trending since PR #1647 ("Trending
  // must count the tables the results screen actually reads"). Omitting it here would silently test
  // an unrealistic calling convention and let Trending count tables Search can never reach at all
  // (retired platforms, anything outside RES_TABLES/COM_TABLES) — a different, real bug class this
  // barrier is not the one pinning, so it must not be misreported as this one.
  const trendingRows = await rpc('top_cities_by_deal_ar', { p_category: macro, p_types: types, p_tables: tablesBySuffix[macro] });
  const trendingRow = trendingRows.find((r) => r.city_id === city_id);
  const trendingCount = trendingRow ? Number(trendingRow.listing_count) : 0;
  // total_count, not array length: location_search_candidates_ar pages results, so .length silently
  // reads as the p_limit cap on any scope with more matches than that — read the RPC's own honest
  // total instead (p_limit:=1 keeps the round trip cheap; the total_count column is unaffected by it).
  const searchTotalRows = await rpc('location_search_candidates_ar', {
    p_category: macro, p_types: types, p_cities: [city_ar], p_tables: tablesBySuffix[macro], p_limit: 1,
  });
  const searchCount = searchTotalRows.length ? Number(searchTotalRows[0].total_count) : 0;

  check(`${label}: Trending == table-suffix oracle`, trendingCount === oracleCount, `trending=${trendingCount} oracle=${oracleCount}`);
  check(`${label}: Search == table-suffix oracle`, searchCount === oracleCount, `search=${searchCount} oracle=${oracleCount}`);
  check(`${label}: Trending == Search — the exact invariant this bug broke`, trendingCount === searchCount, `trending=${trendingCount} search=${searchCount}`);

  if (sampleRow) {
    // Direct and deterministic: Search can return a row ONLY from a table in p_tables. If the
    // mismatched row's own table is not in the correct-suffix list, no RPC call is needed to know
    // Search can never return it — asserting the structural reason is simpler than scanning a
    // (possibly huge, possibly paginated) result set for one id's absence.
    const excludedByTableScope = !tablesBySuffix[macro].includes(sampleRow.source_table);
    check(`${label}: the mismatched row's table (${sampleRow.source_table}) is outside the ${macro} search scope, so ${sampleRow.source_table}#${sampleRow.listing_id} can never reach a correctly-scoped Search`,
      excludedByTableScope, `${sampleRow.source_table} IS in tablesBySuffix.${macro} — it would be reachable`);
  }
}

// ── PART 2a — FLEET-WIDE AGGREGATE, one check per distinct discovered (macro, type_ar): cheap
//    (no per-city fan-out), and it is the check that would have caught the أرض تجارية-scale leak
//    (18,233 rows across the whole fleet) that a Makkah-only pin never would have. ─────────────────
const byType = new Map<string, { macro: 'Residential' | 'Commercial'; type_ar: string; rows: Mismatch[] }>();
for (const m of mismatches) {
  const key = `${m.macro}|${m.type_ar}`;
  if (!byType.has(key)) byType.set(key, { macro: m.macro, type_ar: m.type_ar, rows: [] });
  byType.get(key)!.rows.push(m);
}
for (const { macro, type_ar, rows } of byType.values()) {
  const oracleCount = await restCount(`type_ar=eq.${enc(type_ar)}&source_table=in.${inTables(tablesBySuffix[macro])}&production_ready=eq.true`);
  const trendingRows = await rpc('top_cities_by_deal_ar', { p_category: macro, p_types: [type_ar], p_tables: tablesBySuffix[macro] });
  const trendingSum = trendingRows.reduce((n, r) => n + Number(r.listing_count), 0);
  check(`FLEET-WIDE ${macro}/«${type_ar}»: Trending sum == table-suffix oracle (${rows.length} mismatched row(s) discovered)`,
    trendingSum === oracleCount,
    `trending_sum=${trendingSum} oracle=${oracleCount} — e.g. ${rows[0].source_table}#${rows[0].listing_id} (${rows[0].city_ar})`);
}
if (mismatches.length === 0) console.log('  (no live mismatch today — PART 2b/3 below still run the general invariant on ordinary scopes)');

// ── PART 2b — PER-CITY DEPTH, on a bounded, deterministic sample: the single worst-case city for
//    each discovered (macro, type_ar) — never every city, which is what made the first draft slow —
//    plus the exact reported case (Makkah/شقة) forced in even if it were not the worst case. ──────
//
// Clustered cities (loc_city_cluster — today just الهفوف/الاحساء) are excluded from candidacy here.
// This barrier tests category/table-scope agreement, not location semantics: Search widens a
// clustered city's results via match_city_ids while Trending still buckets on the scalar city_id (a
// SEPARATE, already-tracked defect — PR #1786/#1790, pending an owner display decision) — comparing
// a plain city_id oracle against a cluster-widened Search total for that city would fail on THAT
// gap, not on anything this file exists to catch, and would misattribute it. The fleet-wide check in
// PART 2a already covers every city, clustered or not, since it never buckets by city at all.
const clusteredCityIds = new Set(
  (await restRows<{ city_id: number }>('select=city_id', 'loc_city_cluster')).map((r) => r.city_id)
);
const worstCityPerType = [...byType.values()].map(({ macro, type_ar, rows }) => {
  const byCity = new Map<number, Mismatch[]>();
  for (const r of rows) byCity.set(r.city_id, [...(byCity.get(r.city_id) ?? []), r]);
  const ranked = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length);
  const pick = ranked.find(([cityId]) => !clusteredCityIds.has(cityId));
  if (!pick) return { macro, type_ar, skip: true as const, allClusteredN: ranked.reduce((n, [, r]) => n + r.length, 0) };
  const [city_id, cityRows] = pick;
  return { macro, type_ar, skip: false as const, city_id, city_ar: cityRows[0].city_ar, sample: cityRows[0], n: cityRows.length, skippedClustered: pick !== ranked[0] };
});
const SAMPLE_CAP = 25;
for (const g of worstCityPerType.slice(0, SAMPLE_CAP)) {
  if (g.skip) {
    console.log(`  (${g.macro}/«${g.type_ar}»: every one of its ${g.allClusteredN} mismatched row(s) sits in a clustered city — skipping the per-city depth check, not silently; the fleet-wide aggregate above already covers it)`);
    continue;
  }
  if (g.skippedClustered) console.log(`  (picked ${g.city_ar} over a clustered city for ${g.macro}/«${g.type_ar}»)`);
  await assertScope(`${g.macro}/«${g.type_ar}»/${g.city_ar} (${g.n} row(s) here)`, g.macro, [g.type_ar], g.city_ar, g.city_id, g.sample);
}
if (worstCityPerType.length > SAMPLE_CAP) console.log(`  (${worstCityPerType.length - SAMPLE_CAP} more discovered type(s) covered only by the fleet-wide aggregate above, not the per-row Search check)`);

const makkahAlreadySampled = worstCityPerType.slice(0, SAMPLE_CAP).some((g) => g.type_ar === 'شقة' && g.city_ar === 'مكة المكرمة');
if (!makkahAlreadySampled) {
  const makkah = mismatches.find((m) => m.type_ar === 'شقة' && m.city_ar === 'مكة المكرمة' && m.macro === 'Residential');
  if (makkah) {
    await assertScope('Residential/«شقة»/مكة المكرمة (the exact reported case, pinned explicitly)', 'Residential', ['شقة'], 'مكة المكرمة', makkah.city_id, makkah);
  } else {
    check('the exact reported case (مكة المكرمة/شقة, dealapp_commercial_listings#693812) is still discoverable live', false,
      'no matching mismatch found — either the source corrected it, or discovery regressed; either way this must not go silent');
  }
}

// ── PART 3 — the general invariant on ordinary scopes, independent of whether ANY mismatch exists ──
const SCOPES: { label: string; p_category: 'Residential' | 'Commercial'; p_types: string[]; city_ar: string }[] = [
  { label: 'Riyadh residential apartment', p_category: 'Residential', p_types: ['شقة'], city_ar: 'الرياض' },
  { label: 'Jeddah residential villa', p_category: 'Residential', p_types: ['فيلا'], city_ar: 'جدة' },
  { label: 'Dammam residential land', p_category: 'Residential', p_types: ['أرض سكنية'], city_ar: 'الدمام' },
  { label: 'Riyadh commercial office', p_category: 'Commercial', p_types: ['مكتب'], city_ar: 'الرياض' },
];
for (const s of SCOPES) {
  const cityRows = await restRows<{ city_id: number }>(`select=city_id&city_ar=eq.${enc(s.city_ar)}&limit=1`);
  if (!cityRows.length) { check(`${s.label}: city resolves in the catalog`, false, `no city_id for ${s.city_ar}`); continue; }
  await assertScope(s.label, s.p_category, s.p_types, s.city_ar, cityRows[0].city_id);
}

const sampledAtRowLevel = worstCityPerType.slice(0, SAMPLE_CAP).filter((g) => !g.skip).length;
console.log(`\n${failures === 0 ? '✓' : '✗'} verify-trending-category-respects-table-scope: ${mismatches.length} mismatched row(s) across ${byType.size} type(s) checked fleet-wide, ${sampledAtRowLevel} sampled at row-level, ${SCOPES.length} broad scope(s) swept, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
