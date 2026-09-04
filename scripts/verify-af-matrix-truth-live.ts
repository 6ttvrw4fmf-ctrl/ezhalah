// ONE TRUTH ACROSS THE WHOLE CERTIFIED ADVANCED-FILTER MATRIX — the LIVE half.
//
// Same matrix as verify-af-matrix-truth.ts (built by scripts/lib/afMatrix.ts from the real pool),
// now measured against production RPCs and, independently, against search_listings_ar's CANONICAL
// columns through PostgREST's own filter engine. For EVERY certified (scope, mode, field, option)
// cell in one real city scope it asserts:
//
//   (1) COUNT TRUTH — the number the card would show (the real question's resolveOptions() run on
//       the real apartment_guided_counts_ar / property_age_option_counts_ar row) equals a PostgREST
//       count whose predicate is re-expressed from the option's MEANING (optionMeaning), never from
//       the RPC params and never by re-calling our own RPC. The «did not mention» caption equals the
//       NULL count, and options + unknown == the scope for every partitioning field.
//   (2) SELECTION = PREDICATE — the option's real apply() + rpcAdvancedFilterParams() send exactly
//       the meaning's params, and the results RPC given those params returns the same total.
//   (3) RESULTS SATISFY — every returned row is fetched back by ID and its canonical column(s)
//       satisfy the predicate (a NULL is a violation); for sets under the walk cap the exact ID set
//       is diffed against the oracle (missing/extra/duplicates = 0). Beyond the cap the first
//       WALK_CAP rows are verified and the cap is LOGGED, never silent.
//   (4) OR / AND — two options of a multi-select field return exactly the SQL-computed union
//       (directions) or intersection (amenities — R7.2.2: each chip is its own column); two
//       different fields return exactly the intersection.
//   (5) REMOVAL — the base predicate (what removing the option returns) equals the oracle's base.
//   (6) TRENDING CARRY — top_cities_by_deal_ar, called the way locations.ts calls it (the real
//       rpcAllNarrowingParams()), advertises for this city exactly the committed count.
//   The UNKNOWN partition (answered + known-not-matching + unknown == base) is asserted for every
//   option, so a NULL row can never be admitted by any answer without breaking the identity.
//
// INDEPENDENCE. The scope half of the querystring (city/deal/type/tables/category/period) comes from
// buildOracleQS — a separately mutation-tested translator. The PREDICATE half comes from
// optionMeaning(), a table keyed by option KEY that states the predicate on canonical columns
// directly, so the chain «option key → apply() → params → RPC → rows» is compared against
// «option key → column predicate → PostgREST» with no shared code between the two sides.
//
// SCOPE FIXTURE. Every cell is scoped to ONE city (AF_MATRIX_CITY, default الرياض) with the app's
// own table lists (RES_TABLES / COM_TABLES / resTables(), lifted from remote.ts) and the misfile
// mirror as p_tables2/p_types2 — the same shape verify-af-property-type-differential.ts uses. A
// city scope disables the clause's unlocated carve-out, so production_ready is the exact admission
// rule on both sides. Location resolution itself is Normal-tier and pinned elsewhere.
//
//   node --experimental-strip-types scripts/verify-af-matrix-truth-live.ts
//   AF_MATRIX_ONLY=Apartment,Villa   AF_MATRIX_MODES=Buy,RentAnnual   AF_MATRIX_WALK_CAP=2000
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { buildOracleQS } from './lib/afOracleFilter.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import {
  loadLifted, buildMatrix, recorder, allScopes, optionMeaning, fieldMeaning, paramsAcross, sortedJson, type Cell,
} from './lib/afMatrix.ts';
import { typeArForTypes } from '../src/data/propertyTypes.ts';
import { certifiedAmenityKeys } from '../src/lib/afCohorts.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: REST, key: KEY } = resolvePublicSupabase(process.env);
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CITY = process.env.AF_MATRIX_CITY || 'الرياض';
const WALK_CAP = Number(process.env.AF_MATRIX_WALK_CAP || 1000);
const ONLY = (process.env.AF_MATRIX_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const MODES_ONLY = (process.env.AF_MATRIX_MODES || '').split(',').map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = Number(process.env.AF_MATRIX_CONCURRENCY || 3);

let failures = 0, passes = 0;
const failed: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { passes++; return; }
  failures++; failed.push(label);
  console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const same = (a: unknown, b: unknown) => sortedJson(a) === sortedJson(b);

// ── HTTP, with retries (a production hiccup is not a predicate defect) ───────────────────────────
async function http(path: string, init: RequestInit & { rawHeaders?: boolean } = {}): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${REST}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> | undefined) } });
      if (r.status < 500 && r.status !== 429) return r;
      last = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}
async function rpc<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const r = await http(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json() as Promise<T>;
}
async function rpcTotal(body: Record<string, unknown>): Promise<number> {
  const rows = await rpc<{ total_count: number }[]>('location_search_candidates_ar', { ...body, p_per_platform: null, p_limit: 1, p_offset: 0 });
  return rows.length ? Number(rows[0].total_count) : 0;
}
async function restCount(qs: string): Promise<number> {
  const r = await http(`search_listings_ar?select=listing_id&${qs}`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok && r.status !== 416) throw new Error(`REST ${r.status} on ${qs.slice(0, 160)}: ${(await r.text()).slice(0, 200)}`);
  const cr = r.headers.get('content-range') || '';
  return cr.includes('/') ? Number(cr.split('/')[1]) : 0;
}
const key = (r: { source_table: string; listing_id: unknown }) => `${r.source_table}:${r.listing_id}`;
async function rpcIds(body: Record<string, unknown>, cap: number): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = []; let total = 0;
  for (let off = 0; off < cap; off += 1000) {
    const rows = await rpc<any[]>('location_search_candidates_ar', { ...body, p_per_platform: null, p_limit: Math.min(1000, cap - off), p_offset: off });
    if (off === 0) total = Number(rows[0]?.total_count ?? 0);
    rows.forEach((x) => ids.push(key(x)));
    if (rows.length < 1000 || ids.length >= total) break;
  }
  return { ids, total };
}
async function restIds(qs: string, cap: number): Promise<string[]> {
  const out: string[] = [];
  for (let off = 0; off < cap; off += 1000) {
    const r = await http(`search_listings_ar?select=source_table,listing_id&${qs}&order=source_table,listing_id`, { headers: { Range: `${off}-${off + 999}` } });
    if (r.status === 416) break;
    const rows = await r.json() as any[];
    rows.forEach((x) => out.push(key(x)));
    if (rows.length < 1000) break;
  }
  return out;
}
/** Canonical column values for the returned rows, fetched back by (source_table, listing_id). */
async function fetchCols(ids: string[], cols: string[]): Promise<Map<string, Record<string, unknown>>> {
  const byTable = new Map<string, string[]>();
  for (const id of ids) { const i = id.indexOf(':'); const t = id.slice(0, i); (byTable.get(t) ?? byTable.set(t, []).get(t)!).push(id.slice(i + 1)); }
  const out = new Map<string, Record<string, unknown>>();
  const jobs: Promise<void>[] = [];
  for (const [table, list] of byTable) {
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200).map((v) => (/^\d+$/.test(v) ? v : `"${v}"`)).join(',');
      jobs.push((async () => {
        const r = await http(`search_listings_ar?select=source_table,listing_id,${cols.join(',')}&source_table=eq.${encodeURIComponent(table)}&listing_id=in.(${encodeURIComponent(chunk)})`);
        if (!r.ok) throw new Error(`fetchCols ${r.status}: ${(await r.text()).slice(0, 200)}`);
        for (const row of await r.json() as any[]) out.set(key(row), row);
      })());
    }
  }
  await Promise.all(jobs);
  return out;
}

// ── reference data + the app's own table lists ───────────────────────────────────────────────────
const TYPE_MACROS: Record<string, string> = Object.fromEntries(
  (await (await http('known_type_ar?select=type_ar,macro')).json() as any[]).map((x) => [x.type_ar, x.macro]));
const tables = await liftSymbols(join(ROOT, 'src/data/remote.ts'),
  [{ header: 'const RES_TABLES', endsWith: /\];$/ }, { header: 'const COM_TABLES', endsWith: /\];$/ }, { header: 'function resTables' }],
  ['RES_TABLES', 'COM_TABLES', 'resTables'], 'type SearchQuery = any;') as
  { RES_TABLES: string[]; COM_TABLES: string[]; resTables: (q: SearchQuery) => string[] };

function scopeBody(cell: Cell): Record<string, unknown> {
  const typesAr = typeArForTypes(cell.scope.types) ?? [];
  const res = tables.resTables(cell.query);
  const com = tables.COM_TABLES;
  const commercial = cell.scope.category === 'Commercial';
  return {
    p_deal: cell.mode.p_deal, p_rent_period: cell.mode.p_rent_period, p_category: cell.scope.category,
    p_cities: [CITY], p_types: typesAr,
    p_tables: commercial ? com : res, p_tables2: commercial ? res : com, p_types2: typesAr,
  };
}

// ── the matrix ───────────────────────────────────────────────────────────────────────────────────
const L = await loadLifted(ROOT);
const rec = recorder();
const scopes = allScopes().filter((s) => !ONLY.length || ONLY.includes(s.label));
const cells = (await buildMatrix(L, { guided: rec.row, age: rec.row }, scopes))
  .filter((c) => c.fields.length && (!MODES_ONLY.length || MODES_ONLY.includes(c.mode.mode)));
const nOptions = cells.reduce((n, c) => n + c.fields.reduce((m, f) => m + f.options.length, 0), 0);
console.log(`\nAF matrix, LIVE in ${CITY}: ${cells.length} certified cells · ${cells.reduce((n, c) => n + c.fields.length, 0)} (cell, field) · ${nOptions} options · walk cap ${WALK_CAP}\n`);

let emptyCells = 0, cappedWalks = 0, unverifiable = 0, optionsChecked = 0, rowsVerified = 0, chatOnlyTokens = 0, trendingSkipped = 0;

async function verifyCell(cell: Cell) {
  const tag = `${cell.scope.kind === 'group' ? 'group ' : ''}${cell.scope.label}/${cell.mode.mode}`;
  const body0 = scopeBody(cell);
  const { qs: scopeQS, unhandled } = buildOracleQS(body0, { typeMacros: TYPE_MACROS });
  if (unhandled.length) { unverifiable++; check(`${tag}: the oracle can express this scope`, false, unhandled.join(' | ')); return; }

  // (5) base — what removing every option returns
  const [baseRpc, baseRest] = await Promise.all([rpcTotal(body0), restCount(scopeQS)]);
  check(`${tag}: base count RPC == oracle`, baseRpc === baseRest, `rpc=${baseRpc} oracle=${baseRest}`);
  if (baseRpc === 0 && baseRest === 0) { emptyCells++; console.log(`EMPTY ${tag} — no inventory in ${CITY}; ${cell.fields.length} field(s) not measurable here`); return; }

  const needsAge = cell.fields.some((f) => f.question.id === 'property_age');
  const [guidedRows, ageRows] = await Promise.all([
    rpc<any[]>('apartment_guided_counts_ar', body0),
    needsAge ? rpc<any[]>('property_age_option_counts_ar', body0) : Promise.resolve([null]),
  ]);
  const guided = guidedRows[0], age = ageRows[0];
  check(`${tag}: the count RPC answered`, !!guided, JSON.stringify(guidedRows).slice(0, 200));
  if (!guided) return;

  const firstOf: { field: string; key: string; rest: string; params: Record<string, unknown>; count: number }[] = [];
  for (const f of cell.fields) {
    const fid = f.question.id;
    const fm = fieldMeaning(fid);
    if (!fm) { check(`${tag}: ${fid} has a field meaning`, false); continue; }
    L.setCounts(guided, age);
    const res = await f.question.resolveOptions(cell.query);   // REAL numbers from the REAL row
    check(`${tag}/${fid}: the question's total is the scope`, res.total === baseRpc, `total=${String(res.total)} base=${baseRpc}`);
    let sum = 0;
    for (const o of res.options) {
      const m = optionMeaning(fid, o.key);
      if (!m) { check(`${tag}/${fid}=${o.key}: option has a meaning`, false); continue; }
      optionsChecked++;
      const chip = Number(o.count);
      sum += chip;
      const q1 = f.question.apply(cell.query, [o.key]);
      const params = L.rpcAdvancedFilterParams(q1);
      // (2) selection = predicate
      check(`${tag}/${fid}=${o.key}: selecting sends exactly the option's meaning`, same(params, m.params), `sent ${JSON.stringify(params)} meaning ${JSON.stringify(m.params)}`);
      const body1 = { ...body0, ...params };
      const [match, applied, notM, unk] = await Promise.all([
        restCount(`${scopeQS}&${m.rest}`), rpcTotal(body1), restCount(`${scopeQS}&${m.notMatching}`), restCount(`${scopeQS}&${m.unknown}`),
      ]);
      // (1) count truth: UI number == canonical truth == what the backend applies
      check(`${tag}/${fid}=${o.key}: card count == independent canonical count`, chip === match, `card=${chip} oracle=${match}`);
      check(`${tag}/${fid}=${o.key}: results total == card count`, applied === chip, `results=${applied} card=${chip}`);
      // UNKNOWN never passes: an exact partition, not a bound
      check(`${tag}/${fid}=${o.key}: answered + known-not-matching + unknown == base`, match + notM + unk === baseRest,
        `${match} + ${notM} + ${unk} = ${match + notM + unk}, base=${baseRest}`);
      // (3) every returned row satisfies the predicate on canonical columns
      if (applied > 0) {
        const [{ ids, total }, oracleIds] = await Promise.all([
          rpcIds(body1, WALK_CAP), applied <= WALK_CAP ? restIds(`${scopeQS}&${m.rest}`, WALK_CAP) : Promise.resolve(null),
        ]);
        const dupes = ids.length - new Set(ids).size;
        const rows = await fetchCols([...new Set(ids)], m.cols);
        const violators = [...new Set(ids)].filter((id) => !rows.has(id) || !m.satisfies(rows.get(id)!));
        rowsVerified += ids.length;
        check(`${tag}/${fid}=${o.key}: every returned row satisfies the predicate on canonical columns (${ids.length}${total > WALK_CAP ? ` of ${total}, capped` : ''})`,
          violators.length === 0 && dupes === 0,
          `violators=${violators.length} dupes=${dupes} first: ${violators.slice(0, 3).map((id) => `${id}=${JSON.stringify(rows.get(id) ?? null)}`).join(' ')}`);
        if (total <= WALK_CAP && oracleIds) {
          const rs = new Set(ids), os = new Set(oracleIds);
          const missing = oracleIds.filter((i) => !rs.has(i)), extra = ids.filter((i) => !os.has(i));
          check(`${tag}/${fid}=${o.key}: exact ID set == oracle`, missing.length === 0 && extra.length === 0,
            `missing=${missing.length} extra=${extra.length} (${missing.slice(0, 2)} / ${extra.slice(0, 2)})`);
        } else cappedWalks++;
      }
      if (!firstOf.some((x) => x.field === fid)) firstOf.push({ field: fid, key: o.key, rest: m.rest, params, count: chip });
      // (6) Trending carry — the first option of each field, the way locations.ts asks for it.
      // Not for bothDeals: that shape exists only on the agent path (the store never restores it,
      // so the Filter screen and its Trending pool can never hold it), and its results body reads
      // RES_TABLES only while top_cities_by_deal_ar reads every table — measured 2026-09-02 on
      // Apartment/bothDeals: base 20,853 vs dealCombined's 29,734, the monthly-only sources. A
      // comparison there would report the scope difference, not an AF carry defect. Logged, not silent.
      if (cell.mode.mode === 'bothDeals') {
        if (firstOf.length === 1 && firstOf[0].key === o.key) { trendingSkipped++; console.log(`skip  ${tag}: Trending check does not apply — bothDeals never reaches the Filter home (verify-af-matrix-truth.ts §8)`); }
      }
      else if (firstOf[firstOf.length - 1].key === o.key && firstOf[firstOf.length - 1].field === fid) {
        const args: Record<string, unknown> = { p_deal: cell.mode.p_deal };
        if (cell.mode.p_rent_period !== null) args.p_rent_period = cell.mode.p_rent_period;
        args.p_category = cell.scope.category;
        args.p_types = body0.p_types;
        Object.assign(args, L.rpcAllNarrowingParams(q1));
        // THE TABLE SCOPE, exactly as locations.ts now sends it (fix 2026-09-03). Trending used to go
        // out with no p_tables while the results body carried one, so it counted platform tables the
        // results RPC excludes — and this very check was what caught it, on `bathrooms=1`, the one
        // predicate wide enough to admit the five uncertified platforms live in search_listings_ar.
        // Taken from body0, the RESULTS body, so the two sides are compared on one scope by
        // construction: if the client ever stops sending it, the identity below breaks again.
        args.p_tables = body0.p_tables;
        if (body0.p_tables2) { args.p_tables2 = body0.p_tables2; args.p_types2 = body0.p_types2; }
        const rows = await rpc<any[]>('top_cities_by_deal_ar', args);
        const row = rows.find((r) => r.city_ar === CITY);
        check(`${tag}/${fid}=${o.key}: Trending advertises for ${CITY} exactly the committed count`,
          (row?.listing_count ?? 0) === applied, `trending=${row?.listing_count ?? '(no row)'} committed=${applied} af=${JSON.stringify(L.rpcAllNarrowingParams(q1))}`);
      }
    }
    // CHAT-ONLY AMENITY TOKENS (GAP 1, 2026-09-02). certifiedAmenityKeys() certifies eight rich tokens
    // (gym, pool, garden, balcony, laundry_room, optical_fibers, separate_*_meter) for the chat path
    // that the card never offers — no cnt_* column exists, so the runtime sweep never measures them.
    // They are still real predicates a user's sentence can commit, so the backend half is proved
    // here at COUNT level (results == canonical truth; NULL never admitted). Whether the card should
    // offer them is an owner decision, logged in the summary rather than hidden.
    if (fid === 'amenities') {
      const offered = new Set(res.options.map((o) => o.key));
      for (const tok of certifiedAmenityKeys(cell.query).filter((k) => !offered.has(k))) {
        const m = optionMeaning('amenities', tok);
        if (!m) { check(`${tag}/amenities(chat)=${tok}: certified token has a meaning`, false); continue; }
        chatOnlyTokens++;
        const params = L.rpcAdvancedFilterParams(f.question.apply(cell.query, [tok]));
        check(`${tag}/amenities(chat)=${tok}: the chat path sends exactly the token's meaning`, same(params, m.params), JSON.stringify(params));
        const [applied, match, notM, unk] = await Promise.all([
          rpcTotal({ ...body0, ...params }), restCount(`${scopeQS}&${m.rest}`), restCount(`${scopeQS}&${m.notMatching}`), restCount(`${scopeQS}&${m.unknown}`),
        ]);
        check(`${tag}/amenities(chat)=${tok}: results == independent canonical count`, applied === match, `results=${applied} oracle=${match}`);
        check(`${tag}/amenities(chat)=${tok}: answered + known-not-matching + unknown == base`, match + notM + unk === baseRest, `${match}+${notM}+${unk} vs ${baseRest}`);
      }
    }
    // caption + partition
    if (fm.partition && res.options.length) {
      const unknownFilter = optionMeaning(fid, res.options[0].key)!.unknown;
      const unkRest = await restCount(`${scopeQS}&${unknownFilter}`);
      check(`${tag}/${fid}: «did not mention» == NULL count`, Number(res.unknownCount) === unkRest, `caption=${String(res.unknownCount)} null=${unkRest}`);
      check(`${tag}/${fid}: options + unknown == scope`, sum + Number(res.unknownCount) === baseRpc, `${sum} + ${String(res.unknownCount)} vs ${baseRpc}`);
    }
    // (4) two options of ONE field
    if (f.question.selection === 'multi' && res.options.length >= 2) {
      const [a, b] = res.options;
      const ma = optionMeaning(fid, a.key)!, mb = optionMeaning(fid, b.key)!;
      const q2 = f.question.apply(cell.query, [a.key, b.key]);
      const p2 = L.rpcAdvancedFilterParams(q2);
      check(`${tag}/${fid}=[${a.key},${b.key}]: sends the ${fm.combine.toUpperCase()} of both`, same(p2, fm.paramsBoth(ma.params, mb.params)), JSON.stringify(p2));
      const [t2, r2] = await Promise.all([rpcTotal({ ...body0, ...p2 }), restCount(`${scopeQS}&${fm.restBoth(ma.rest, mb.rest)}`)]);
      const bound = fm.combine === 'or' ? t2 >= Math.max(Number(a.count), Number(b.count)) : t2 <= Math.min(Number(a.count), Number(b.count));
      check(`${tag}/${fid}=[${a.key},${b.key}]: results == SQL ${fm.combine === 'or' ? 'UNION' : 'INTERSECTION'}`, t2 === r2 && bound,
        `results=${t2} oracle=${r2} singles=${a.count}/${b.count}`);
    }
  }
  // (4) two DIFFERENT fields intersect
  if (firstOf.length >= 2) {
    const [A, B] = firstOf;
    const fa = cell.fields.find((f) => f.question.id === A.field)!, fb = cell.fields.find((f) => f.question.id === B.field)!;
    const qAB = fb.question.apply(fa.question.apply(cell.query, [A.key]), [B.key]);
    const pAB = L.rpcAdvancedFilterParams(qAB);
    check(`${tag}: ${A.field}=${A.key} ∧ ${B.field}=${B.key} sends both predicates`, same(pAB, paramsAcross(A.params, B.params)), JSON.stringify(pAB));
    const [tAB, rAB] = await Promise.all([rpcTotal({ ...body0, ...pAB }), restCount(`${scopeQS}&${A.rest}&${B.rest}`)]);
    check(`${tag}: ${A.field}=${A.key} ∧ ${B.field}=${B.key} results == SQL intersection`, tAB === rAB && tAB <= Math.min(A.count, B.count),
      `results=${tAB} oracle=${rAB} singles=${A.count}/${B.count}`);
  }
  console.log(`done  ${tag} · base ${baseRpc} · ${cell.fields.length} field(s)`);
}

// bounded concurrency — production's measured knee is 3 (SEARCH_MATCH_QA_ENGINEER.md §40.1)
const queue = [...cells];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) {
    try { await verifyCell(c); }
    catch (e: any) { check(`${c.scope.label}/${c.mode.mode}: cell completed without a harness error`, false, e.message); }
  }
}));

console.log(`\n${passes} checks passed · ${optionsChecked} options measured · ${chatOnlyTokens} chat-only amenity tokens measured at count level · ` +
  `${rowsVerified} returned rows verified on canonical columns · ${emptyCells} empty cell(s) in ${CITY} · ${cappedWalks} walk(s) capped at ${WALK_CAP} · ` +
  `${unverifiable} cell(s) the oracle could not express · ${trendingSkipped} bothDeals cell(s) SKIPPED the Trending check — reason: bothDeals is agent-only, sanitizeForFilterRestore drops it so the Filter home (the only Trending surface) can never hold it, and its results body reads RES_TABLES while the un-tabled Trending call spans the monthly-only sources (adjudicated 2026-09-02, pinned by verify-af-matrix-truth.ts §8)`);
if (failed.length) console.log(`\nFAILED:\n${failed.map((l) => `  • ${l}`).join('\n')}`);
console.log(failures === 0
  ? `\n✅ verify-af-matrix-truth-live: every certified option in ${CITY} shows, sends, applies, returns and carries one truth\n`
  : `\n✗ verify-af-matrix-truth-live: ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
