/* eslint-disable no-console */
// SHADOW PROOF for FIX A (residential misfile recovery, owner 2026-07-10). Verifies over the REAL
// supabase-js / PostgREST transport (anon key) that the residential scope B in remote.ts recovers the
// residential listings misfiled into *_commercial_listings tables, WITHOUT changing Commercial results.
//
// It replicates remote.ts's exact scope/param construction for country-wide queries (buildScopeParams),
// so the params it sends to location_search_candidates_ar are byte-for-byte what the app sends. It then:
//   1) broad Residential (Buy / Rent / Both): NEW total_count − OLD total_count == expected delta;
//   2) enumerates the recovered set and confirms it is EXACTLY the 292 by source_table+type_ar;
//   3) client-visibility: fetches each recovered row's RAW property_type/transaction_type and runs the
//      app's real normalizeType → confirms every recovered row is macro-Residential and survives the
//      per-deal transaction_type filter (the true user-facing recovery count);
//   4) purity: ZERO عمارة (Commercial-Building) rows from commercial tables leak into Residential;
//   5) Commercial byte-identical: buildScopeParams for a broad-Commercial query is IDENTICAL pre/post fix,
//      and the broad-Commercial walk still satisfies distinct==total_count, 0 dupes;
//   6) specific Residential (Villa/Apartment/House/Room): each now reaches its misfiled COM-table rows;
//   7) disjointness: full-walk of residential scenarios has 0 duplicate (source_table,listing_id).
//
// Run: node_modules/.bin/tsx --env-file=.env scripts/verify-residential-misfile-recovery.ts
import { createClient } from '@supabase/supabase-js';
import { CLEAN_MACRO, CLEAN_TO_TYPE_AR, typeArForTypes, typeArForSelection, queryForTypes, queryForSelection, normalizeType, type SourceKind, type CleanQuery } from '../src/data/propertyTypes';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY!;
const sb = createClient(url, key);

// ── type_ar label sets, derived from propertyTypes (single source of truth) ──
const RESIDENTIAL_TYPE_AR_ALL = Array.from(new Set(Object.keys(CLEAN_MACRO).filter((c) => CLEAN_MACRO[c] === 'Residential').flatMap((c) => CLEAN_TO_TYPE_AR[c] ?? [])));
const RESIDENTIAL_TYPE_AR_COM = RESIDENTIAL_TYPE_AR_ALL.filter((t) => t !== 'عمارة');
const COMMERCIAL_TYPE_AR_ALL = Array.from(new Set(Object.keys(CLEAN_MACRO).filter((c) => CLEAN_MACRO[c] === 'Commercial').flatMap((c) => CLEAN_TO_TYPE_AR[c] ?? [])));
const COMMERCIAL_TYPE_AR_COM = COMMERCIAL_TYPE_AR_ALL;
const COMMERCIAL_TYPE_AR_RES = COMMERCIAL_TYPE_AR_ALL.filter((t) => t !== 'عمارة');

const PREFIXES = ['aqar','wasalt','aldarim','aqargate','alhoshan','hajer','sanadak','eastabha','aqarcity','raghdan','eaqartabuk','satel','sadin','toor','mustqr','ramzalqasim','fursaghyr','jazwtn','mizlaj','muktamel','aqaratikom','awal','alkhaas','abeea','jurash','alnokhba','dealapp','erapulse','nowaisiry','october','souq24'];
const RES_TABLES = PREFIXES.map((p) => `${p}_residential_listings`);
const COM_TABLES = PREFIXES.map((p) => `${p}_commercial_listings`);

// ── faithful replica of remote.ts scope/param logic (country-wide, no q.sources) ──
type Q = { category: 'Residential' | 'Commercial'; type?: string | null; types?: string[] | null; typeGroup?: string | null; deal?: 'Buy' | 'Rent'; bothDeals?: boolean };
const effectiveTypes = (q: Q): string[] => (q.types && q.types.length ? q.types : (q.type ? [q.type] : []));
function effectiveCleanQuery(q: Q): CleanQuery | null {
  const t = effectiveTypes(q);
  if (t.length) return queryForTypes(t);
  if (q.typeGroup) return queryForSelection(q.typeGroup);
  return null;
}
function kindsFor(q: Q): SourceKind[] {
  const cq = effectiveCleanQuery(q);
  if (cq) return cq.kinds;
  return q.category === 'Commercial' ? ['com'] : ['res'];
}
function tablesFor(q: Q): string[] {
  const kinds = kindsFor(q);
  const t: string[] = [];
  if (kinds.includes('res')) t.push(...RES_TABLES);
  if (kinds.includes('com')) t.push(...COM_TABLES);
  const cq = effectiveCleanQuery(q);
  if (cq?.extraTables) for (const tb of cq.extraTables) if (!t.includes(tb)) t.push(tb);
  return t;
}
const rpcPTypes = (q: Q): string[] | null => { const sel = effectiveTypes(q); return sel.length ? typeArForTypes(sel) : (q.typeGroup ? typeArForSelection(q.typeGroup) : null); };

type ScopeParams = { p_tables: string[]; p_types: string[] | null; p_tables2: string[] | null; p_types2: string[] | null };
// withFix=false → the PRE-FIX behavior (no residential scope B). withFix=true → the shipped FIX A.
function buildScopeParams(q: Q, withFix: boolean): ScopeParams {
  const tables = tablesFor(q);
  const isBroadCommercial = q.category === 'Commercial' && !q.type && !(q.types && q.types.length) && !q.typeGroup;
  const isBroadResidential = q.category === 'Residential' && !q.type && !(q.types && q.types.length) && !q.typeGroup;
  const mainTables = isBroadCommercial ? RES_TABLES /* resTables(q) country-wide, non-monthly */ : tables;
  let p_types = rpcPTypes(q);
  if (isBroadCommercial) p_types = COMMERCIAL_TYPE_AR_RES;
  const resSel = effectiveTypes(q);
  const resSelectedTypeAr = resSel.length ? typeArForTypes(resSel) : (q.typeGroup ? typeArForSelection(q.typeGroup) : null);
  const resMisfileTypes = isBroadResidential ? RESIDENTIAL_TYPE_AR_COM : (resSelectedTypeAr ? resSelectedTypeAr.filter((t) => RESIDENTIAL_TYPE_AR_COM.includes(t)) : []);
  const resScopeBTables = COM_TABLES.filter((t) => !mainTables.includes(t));
  const attachResScopeB = withFix && q.category === 'Residential' && !isBroadCommercial && resMisfileTypes.length > 0 && resScopeBTables.length > 0;
  let p_tables2: string[] | null = null, p_types2: string[] | null = null;
  if (isBroadCommercial) { p_tables2 = tables; p_types2 = COMMERCIAL_TYPE_AR_COM; }
  else if (attachResScopeB) { p_tables2 = resScopeBTables; p_types2 = resMisfileTypes; }
  return { p_tables: mainTables, p_types, p_tables2, p_types2 };
}

type Row = { source_table: string; listing_id: number; total_count: number };
async function rpc(params: Record<string, unknown>): Promise<Row[]> {
  const { data, error } = await sb.rpc('location_search_candidates_ar', params);
  if (error) throw new Error(`RPC error: ${error.message}`);
  return (data ?? []) as Row[];
}
const dealParam = (deal: 'Buy' | 'Rent' | 'Both'): string | null => (deal === 'Both' ? null : deal === 'Buy' ? 'بيع' : 'إيجار');

async function headlineTotal(q: Q, deal: 'Buy' | 'Rent' | 'Both', withFix: boolean): Promise<number> {
  const sp = buildScopeParams(q, withFix);
  const rows = await rpc({ ...sp, p_deal: dealParam(deal), p_per_platform: null, p_limit: 1, p_offset: 0 });
  return rows.length ? Number(rows[0].total_count) : 0;
}

// Full walk with the app's page cadence (page0=1500, then 500), dedup by source_table:listing_id.
async function walk(q: Q, deal: 'Buy' | 'Rent' | 'Both', withFix: boolean): Promise<{ total: number; distinct: number; dupes: number; ids: Set<string>; pages: number }> {
  const sp = buildScopeParams(q, withFix);
  const base = { ...sp, p_deal: dealParam(deal), p_per_platform: null } as Record<string, unknown>;
  const PAGE0 = 1500, MORE = 2000; // app's real first page (1500), then larger pages to keep the walk fast; offset paging is what's under test
  const seen = new Set<string>();
  let dupes = 0, pages = 0, offset = 0, total = -1;
  let rows = await rpc({ ...base, p_limit: PAGE0, p_offset: 0 });
  pages++;
  total = rows.length ? Number(rows[0].total_count) : 0;
  for (const r of rows) { const k = `${r.source_table}:${r.listing_id}`; if (seen.has(k)) dupes++; else seen.add(k); }
  offset = rows.length; let hasMore = rows.length >= PAGE0;
  while (hasMore) {
    rows = await rpc({ ...base, p_limit: MORE, p_offset: offset });
    pages++;
    for (const r of rows) { const k = `${r.source_table}:${r.listing_id}`; if (seen.has(k)) dupes++; else seen.add(k); }
    offset += rows.length; hasMore = rows.length >= MORE;
    if (rows.length === 0) break;
    if (pages > 1000) throw new Error('runaway paging');
  }
  return { total, distinct: seen.size, dupes, ids: seen, pages };
}

// The recovered set straight from search_listings_ar over the real transport (source of the breakdown).
async function fetchRecovered(): Promise<Array<{ source_table: string; listing_id: number; type_ar: string; deal_ar: string }>> {
  const out: Array<{ source_table: string; listing_id: number; type_ar: string; deal_ar: string }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('search_listings_ar')
      .select('source_table, listing_id, type_ar, deal_ar')
      .in('source_table', COM_TABLES).in('type_ar', RESIDENTIAL_TYPE_AR_COM)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as any[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
async function fetchAmarahInCom(): Promise<Set<string>> {
  const s = new Set<string>();
  const { data, error } = await sb.from('search_listings_ar').select('source_table, listing_id').in('source_table', COM_TABLES).eq('type_ar', 'عمارة');
  if (error) throw new Error(error.message);
  for (const r of (data as any[])) s.add(`${r.source_table}:${r.listing_id}`);
  return s;
}

const tally = (rows: Array<{ type_ar: string }>): Record<string, number> => rows.reduce((m, r) => { m[r.type_ar] = (m[r.type_ar] ?? 0) + 1; return m; }, {} as Record<string, number>);
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Order-insensitive equality for {label:count} maps (JSON.stringify is key-order-sensitive).
const mapEq = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

(async () => {
  console.log('═══════ RESIDENTIAL MISFILE RECOVERY — SHADOW PROOF (real supabase-js transport) ═══════\n');
  const results: Array<{ name: string; ok: boolean }> = [];
  const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

  const broadRes: Q = { category: 'Residential' };

  // ── 1) Broad Residential headline delta (RPC total_count), Buy / Rent / Both ──
  console.log('▶ 1. Broad Residential headline (OLD scope-A-only vs NEW scope-A+B):');
  const expectRpcDelta: Record<string, number> = { Buy: 186, Rent: 106, Both: 292 };
  for (const deal of ['Buy', 'Rent', 'Both'] as const) {
    const oldT = await headlineTotal(broadRes, deal, false);
    const newT = await headlineTotal(broadRes, deal, true);
    const delta = newT - oldT;
    check(`broadResidential.${deal}: delta=${delta} (old=${oldT} new=${newT}), expected +${expectRpcDelta[deal]}`, delta === expectRpcDelta[deal]);
  }

  // ── 2) Recovered set == exactly the 292, by source_table+type_ar ──
  console.log('\n▶ 2. Recovered set enumeration (search_listings_ar, real transport):');
  const recovered = await fetchRecovered();
  const recoveredIds = new Set(recovered.map((r) => `${r.source_table}:${r.listing_id}`));
  const byType = tally(recovered);
  const expectByType = { 'أرض سكنية': 163, 'مزرعة': 102, 'استراحة': 13, 'شقة': 7, 'فيلا': 4, 'بيت': 2, 'غرفة': 1 };
  check(`recovered total == 292 (got ${recovered.length})`, recovered.length === 292);
  check(`recovered by type_ar matches expected breakdown`, mapEq(byType, expectByType), JSON.stringify(byType));

  // Cross-check: the NEW broad-Residential (Both) FULL walk contains all recovered ids, is dupe-free, and
  // its distinct==total_count; its total exceeds the OLD total by exactly 292. (OLD scope A reads only
  // RES_TABLES, so it can contain none of the COM-table recovered ids — verified structurally + numerically.)
  console.log('\n▶ 3. NEW broad-Residential(Both) FULL walk (largest residential set) — disjointness + coverage:');
  const oldTotalBoth = await headlineTotal(broadRes, 'Both', false);
  const newWalkBoth = await walk(broadRes, 'Both', true);
  const containsAll = [...recoveredIds].every((id) => newWalkBoth.ids.has(id));
  const allRecoveredAreCom = recovered.every((r) => COM_TABLES.includes(r.source_table));
  check(`NEW walk distinct == total_count (${newWalkBoth.distinct}==${newWalkBoth.total}), 0 dupes (${newWalkBoth.dupes}), pages=${newWalkBoth.pages}`, newWalkBoth.distinct === newWalkBoth.total && newWalkBoth.dupes === 0);
  check(`NEW walk contains ALL 292 recovered ids`, containsAll);
  check(`all recovered ids are COM-table rows ⇒ unreachable by OLD scope A (RES_TABLES only)`, allRecoveredAreCom);
  check(`NEW total − OLD total == 292 (${newWalkBoth.total} − ${oldTotalBoth} = ${newWalkBoth.total - oldTotalBoth})`, newWalkBoth.total - oldTotalBoth === 292);

  // ── 4) Client-visibility: raw property_type/transaction_type + real normalizeType ──
  console.log('\n▶ 4. Client-visibility of recovered rows (real normalizeType over raw rows):');
  const byTable = new Map<string, number[]>();
  for (const r of recovered) { const a = byTable.get(r.source_table) ?? []; a.push(r.listing_id); byTable.set(r.source_table, a); }
  const raw = new Map<string, { property_type: string; transaction_type: string; active: boolean }>();
  for (const [tbl, ids] of byTable) {
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await sb.from(tbl).select('id, property_type, transaction_type, active').in('id', ids.slice(i, i + 300));
      if (error) throw new Error(`${tbl}: ${error.message}`);
      for (const row of (data as any[])) raw.set(`${tbl}:${row.id}`, { property_type: row.property_type, transaction_type: row.transaction_type, active: row.active });
    }
  }
  let macroResAll = 0, notResidential: string[] = [];
  const visibleByDeal = { Buy: 0, Rent: 0, Both: 0 };
  for (const r of recovered) {
    const rr = raw.get(`${r.source_table}:${r.listing_id}`);
    if (!rr) { notResidential.push(`${r.source_table}:${r.listing_id}(missing-raw)`); continue; }
    const norm = normalizeType(rr.property_type, 'com'); // COM table → kind 'com', exactly as fetchRawByIds does
    if (norm.macro === 'Residential') macroResAll++; else notResidential.push(`${r.source_table}:${r.listing_id}(${rr.property_type}→${norm.macro})`);
    // Full app pipeline for a deal D: RPC pre-filters candidates by deal_ar==D_ar (Both→no filter), THEN
    // keptFiltersReq filters active=true AND transaction_type==D (Both→no txn filter), THEN matchesType
    // keeps macro=Residential. So per-deal visibility gates on BOTH deal_ar (candidate set) and txn_type.
    if (rr.active && norm.macro === 'Residential') {
      visibleByDeal.Both++;
      if (r.deal_ar === 'بيع' && rr.transaction_type === 'Buy') visibleByDeal.Buy++;
      if (r.deal_ar === 'إيجار' && rr.transaction_type === 'Rent') visibleByDeal.Rent++;
    }
  }
  check(`ALL 292 recovered rows normalize to macro=Residential from a COM table (got ${macroResAll}/292)`, macroResAll === 292, notResidential.slice(0, 5).join(', '));
  check(`client-visible per deal — Buy=${visibleByDeal.Buy}, Rent=${visibleByDeal.Rent}, Both=${visibleByDeal.Both} (RPC-cand Rent=106; 1 row deal_ar=إيجار/txn=Buy fails the Rent txn filter, visible only via Both)`, visibleByDeal.Buy === 186 && visibleByDeal.Rent === 105 && visibleByDeal.Both === 292);

  // ── 5) Purity: no عمارة (Commercial Building) from COM tables in the recovered/Residential set ──
  console.log('\n▶ 5. Commercial-Building (عمارة) purity:');
  const amarah = await fetchAmarahInCom();
  const leak = [...amarah].filter((id) => recoveredIds.has(id) || newWalkBoth.ids.has(id));
  check(`عمارة-in-COM count = ${amarah.size}; ZERO appear in recovered or NEW broad-Residential set (leaks=${leak.length})`, leak.length === 0);

  // ── 6) Commercial byte-identical: params unchanged pre/post fix + walk invariant ──
  console.log('\n▶ 6. Commercial path byte-identical:');
  const broadCom: Q = { category: 'Commercial' };
  const comOld = buildScopeParams(broadCom, false);
  const comNew = buildScopeParams(broadCom, true);
  check(`broad-Commercial scope params identical pre/post fix`, eq(comOld, comNew), JSON.stringify(comNew.p_tables2 ? { t2: comNew.p_tables2.length } : {}));
  check(`broad-Commercial has NO residential scope-B injection (p_types2 = commercial incl عمارة)`, eq(comNew.p_types2, COMMERCIAL_TYPE_AR_COM) && eq(comNew.p_types, COMMERCIAL_TYPE_AR_RES));
  // Also a specific Commercial type must be untouched.
  const specCom: Q = { category: 'Commercial', type: 'Office' };
  check(`specific-Commercial(Office) params identical pre/post fix`, eq(buildScopeParams(specCom, false), buildScopeParams(specCom, true)));
  const comWalk = await walk(broadCom, 'Buy', true);
  check(`broad-Commercial(Buy) walk invariant: distinct==total_count (${comWalk.distinct}==${comWalk.total}), 0 dupes (${comWalk.dupes})`, comWalk.distinct === comWalk.total && comWalk.dupes === 0);

  // ── 7) Specific residential types now reach their misfiled COM rows ──
  console.log('\n▶ 7. Specific residential types reach misfiled COM rows (NEW − OLD total_count, Both deals):');
  // fullWalk=true only for the small types (House/Room) to also confirm disjointness at the specific level;
  // the huge types (Villa/Apartment) prove reachability via the headline delta (disjointness already shown
  // structurally + on the 152k Both walk above).
  const specExpect: Array<[string, number, boolean]> = [['Villa', 4, false], ['Apartment', 7, false], ['House', 2, true], ['Room', 1, true]];
  for (const [ty, exp, fullWalk] of specExpect) {
    const q: Q = { category: 'Residential', type: ty };
    const oldT = await headlineTotal(q, 'Both', false);
    const newT = await headlineTotal(q, 'Both', true);
    if (fullWalk) {
      const w = await walk(q, 'Both', true);
      check(`specific ${ty}: delta=${newT - oldT} expected +${exp}; walk distinct==total (${w.distinct}==${w.total}) 0 dupes (${w.dupes})`, (newT - oldT) === exp && w.distinct === w.total && w.dupes === 0);
    } else {
      check(`specific ${ty}: delta=${newT - oldT} expected +${exp} (old=${oldT} new=${newT})`, (newT - oldT) === exp);
    }
  }
  // Control: a kinds:BOTH residential type (Residential Land) already reaches COM tables ⇒ NO scope B ⇒ delta 0.
  const rl: Q = { category: 'Residential', type: 'Residential Land' };
  const rlOld = await headlineTotal(rl, 'Both', false);
  const rlNew = await headlineTotal(rl, 'Both', true);
  check(`control: Residential Land (kinds:BOTH) delta == 0 (scope A already covers COM) — got ${rlNew - rlOld}`, rlNew - rlOld === 0);

  const allOk = results.every((r) => r.ok);
  console.log(`\n═══════ ${allOk ? '✅ ALL PASS' : '❌ FAILURES PRESENT'} (${results.filter((r) => r.ok).length}/${results.length}) ═══════`);
  console.log('___JSON_RESULT_START___');
  console.log(JSON.stringify({ allOk, results }));
  console.log('___JSON_RESULT_END___');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
