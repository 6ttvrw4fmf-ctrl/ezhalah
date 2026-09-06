// THE TRENDING CHIP'S NUMBER IS A CLAIM ABOUT A **SET**. NOTHING HAS EVER CHECKED THE SET.
//
// OWNER RULE, verbatim (2026-09-05): "Keep Trending under the same rule as Advanced Filter: exact
// eligible DB set, exact count, no widening, no lost state, no wrong cards." And: "displayed count =
// true eligible DB set = exact set produced when clicked, with all current search + AF state
// preserved and no widening."
//
// THE GAP THIS CLOSES. Every Trending barrier in this repo compares NUMBERS:
//   • verify-count-surfaces-share-the-results-purity-gate.ts — five scope-carrying surfaces, COUNTS.
//   • verify-trending-category-respects-table-scope.ts        — COUNT vs a table-suffix oracle.
//   • verify-trending-carries-full-filter-state.ts (+ -live)  — the params are threaded and honoured.
//   • verify-trending-live-four-way-truth.ts                  — DOM number → captured request →
//     RPC → an independent COUNT, through a real browser.
// A count is a lossy projection of a set. One dropped row and one added row cancel out perfectly:
// every one of the checks above stays green while the user is shown a listing that does not belong
// to their search and is denied one that does. This file is the only place that walks the CLICK to
// exhaustion, collects every (source_table, listing_id), and DIFFERENCES it against an independently
// derived set — missing, extra and duplicates named by id, not inferred from a total.
//
// WHAT IT WALKS, exactly the way a guest does: the anon publishable key (resolvePublicSupabase, the
// same RLS-respecting key that ships in the client bundle), top_cities_by_deal_ar for the advertised
// number, then location_search_candidates_ar paged by p_offset — the same mechanism «عرض المزيد»
// uses — under the scope object a click actually produces.
//
// ── THE FOUR SCOPES, AND WHY EACH ONE IS HERE ───────────────────────────────────────────────────
//   1. CLUSTERED (al_ahsa, discovered from loc_city_cluster — never hardcoded). loc_city_cluster
//      declares several city_ids to be ONE search entity, so clicking any member's name returns the
//      whole cluster's UNION while top_cities_by_deal_ar deliberately keeps one row per member. The
//      collapse lives in the DISPLAY layer, so this is the one scope where the number on screen is
//      not a number any RPC returned — it is applyClusterUnion()/collapseClustersForTrending()
//      arithmetic over several rows. ops_incident #32 lived exactly here.
//   2. PLAIN CITY (المدينة المنورة · فيلا · بيع). The ordinary path, with no cluster and no broad-
//      category rewriting — the control that says a green run is not an artefact of the exotic cases.
//   3. COMMERCIAL, BROAD (الخرج · فئة تجاري · بيع). The 2026-09-05 defect (ops_incident #31, chip 266
//      vs search 3,358, up to 96.3% short across the top six cities) was Commercial, and broad
//      Commercial is its own shape: scope A reads COMMERCIAL type_ar out of the RESIDENTIAL tables
//      and scope B reads the commercial tables — the two-armed predicate a category count is most
//      likely to get wrong. A mid-size city, not الرياض, on purpose (see the budget note below).
//   4. NARROWED (scope 2 + 5 bedrooms + a price floor). Proves narrowing does not WIDEN, and proves
//      it as a set relation rather than as an inequality between two totals: the narrowed set must
//      be a strict SUBSET of scope 2's already-walked set, with zero rows outside it. Bedrooms are
//      the exact predicate the 2026-08-22 defect silently dropped from Trending.
//
// ── THE INDEPENDENT ORACLE: WHAT IT SHARES, AND WHAT IT DOES NOT ────────────────────────────────
// The truth set is read STRAIGHT OUT OF search_listings_ar OVER POSTGREST, with the click's own
// resolved parameters translated by scripts/lib/afOracleFilter.ts — the module the AF live barriers
// already use, mutation-tested offline by verify-af-oracle-filter-translator.ts and pinned for
// coverage by verify-af-oracle-classifies-every-search-param.ts. It is NOT a hand-written copy of
// the RPC's predicate written for this file: AGENTS.md's "never test a copy of production code" is
// the whole reason this reuses the reviewed translator instead of inventing a third one.
//
//   NOT SHARED with location_search_candidates_ar: the SQL. PostgREST's own eq/in/gte/or filter
//   engine evaluates the predicate, row admission is decided by Postgres over the base table, and
//   the RPC's ordering, windowed total_count, platform round-robin, limit/offset and rotation key
//   are never involved. A defect in the RPC's WHERE clause cannot agree with this by construction,
//   which is the property a differential needs.
//
//   SHARED, and stated plainly rather than glossed:
//     • the base table (search_listings_ar) — that is the point; same data, two readings;
//     • RES_TABLES / COM_TABLES, lifted and EXECUTED out of src/data/remote.ts (liftSearchScope), so
//       both sides are handed the same table scope the client sends. A wrong table list would agree
//       with itself here — which is precisely what verify-searchable-scope-matches-inventory.ts
//       exists to catch, and is not this file's job;
//     • the reference data the RPC itself resolves through — known_type_ar (macro, for the category
//       purity gate), loc_catalog_city (city_id → city_ar) and loc_city_cluster (which ids are one
//       entity). Reading reference data is the route afOracleFilter already takes for p_category,
//       p_districts and p_directions, deliberately, because reproducing norm_district_tok() or the
//       cluster expansion in TypeScript would make the "independent" oracle depend on a guess about
//       our own SQL.
//   So: a SET/COUNT divergence, a widening, a lost row and a duplicate are all catchable here. A
//   RESOLVER that is uniformly wrong on both sides (a bad table list, a bad cluster row) is NOT —
//   other barriers own that, and this file does not pretend otherwise.
//
//   The cluster arm is the one place the translation is not one-for-one: the RPC widens a clicked
//   name through match_city_ids, while the translator emits city_ar=in.(…). The oracle is therefore
//   handed every member NAME of the clicked cluster (loc_city_cluster ⋈ loc_catalog_city) rather
//   than a re-implementation of composite_match_city_ids(). Measured on production 2026-09-05, all
//   three readings of the al_ahsa scope agree exactly (city_ar in the two names = city_id in the two
//   ids = match_city_ids overlapping them = 265), so the expansion is exact today; a future
//   divergence surfaces as a named set difference for a human to judge, never as a silent pass.
//
// ── BUDGET (incident #22: production has already been driven ~2.6x past its measured safe envelope) ─
// Bounded on purpose, and the bounds are printed on every run:
//   • FOUR scopes, chosen so each one's eligible set is a few hundred rows (~1,300 rows total).
//     الرياض broad Commercial — the city the incident was reported on — is 3,362 rows and is
//     deliberately NOT walked; الخرج exercises the identical two-armed predicate for 12% of the load.
//   • The click walk pages at CLICK_PAGE=250 (the client's own Load-More is the same p_offset
//     mechanism at 1,500; a smaller page is used here so the offset path is actually exercised
//     several times per scope instead of never) and stops at CLICK_ROW_CAP rows per scope.
//   • Over the cap, the walk becomes a PREFIX proof: extra and duplicates are still proven exactly,
//     `missing` is reported UNPROVEN, and the run says so. It never claims a full set proof it did
//     not perform.
//   • The oracle side is plain GETs (no RPC), capped at ORACLE_ROW_CAP; exceeding that fails closed.
//
// IT FAILS CLOSED. Every path that cannot MEASURE exits non-zero. A scope with no inventory is a
// FAILURE, not a quiet pass — coverage that evaporates when the data moves is not coverage.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-trending-set-equals-the-click-live.ts
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.

import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { liftSearchScope } from './lib/liftSearchScope.ts';
import { liftSymbols } from './lib/liftSymbols.ts';
import { buildOracleQS } from './lib/afOracleFilter.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

/** Paging bounds — printed on every run, so "what was actually walked" is never a guess. */
const CLICK_PAGE = 250;
const CLICK_ROW_CAP = 1500;
const ORACLE_PAGE = 1000;
const ORACLE_ROW_CAP = 6000;
/** One seed for the whole run: p_rotation_seed is an ORDER BY key, and holding it fixed keeps the
 *  RPC's total order stable across the pages of one walk exactly as the client's rotationSeed() does. */
const ROTATION_SEED = 20260905;

let failures = 0;
let rowsWalked = 0;
const failedLabels: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
  if (!ok) { failures++; failedLabels.push(label); }
};
/** A barrier that cannot measure must never report success. */
const die = (why: string): never => {
  console.log(`\n✗ CANNOT-MEASURE: ${why}`);
  process.exit(1);
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE PREDICATE THIS FILE EXISTS TO ENFORCE, as one pure function. The live path below calls THIS,
// and so do the mutation proofs — there is no second copy for the proofs to be right about.
// ────────────────────────────────────────────────────────────────────────────────────────────────

export type ClickWalk = {
  /** the RPC's own count(*) over() for this scope */
  total: number;
  /** every (source_table:listing_id) the walk returned, IN ORDER, duplicates included */
  ids: string[];
  /** true when the walk stopped at CLICK_ROW_CAP before reaching `total` */
  capped: boolean;
};

export type Verdict = {
  /** chip == the RPC's own total == the independent oracle's total */
  countsAgree: boolean;
  /** the walk returned exactly `total` distinct rows (meaningless, and reported UNPROVEN, if capped) */
  walkComplete: boolean;
  duplicates: string[];
  /** in the click, absent from truth — a WRONG CARD, and the widening direction */
  extra: string[];
  /** in truth, never returned by the click — a LOST LISTING. null = UNPROVEN (the walk was capped) */
  missing: string[] | null;
  capped: boolean;
};

/**
 * chip == |click set| == |truth set|, missing = extra = duplicates = 0.
 *
 * Deliberately takes the SETS, not their sizes: a dropped row and an added row cancel out in every
 * total, which is the entire reason this file exists.
 */
export function judgeClickAgainstTruth(
  chip: number, walk: ClickWalk, truth: Set<string>, truthTotal: number,
): Verdict {
  const times = new Map<string, number>();
  for (const id of walk.ids) times.set(id, (times.get(id) ?? 0) + 1);
  const distinct = new Set(walk.ids);
  return {
    countsAgree: chip === walk.total && walk.total === truthTotal,
    walkComplete: !walk.capped && distinct.size === walk.total,
    duplicates: [...times].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`),
    extra: [...distinct].filter((id) => !truth.has(id)),
    missing: walk.capped ? null : [...truth].filter((id) => !distinct.has(id)),
    capped: walk.capped,
  };
}

/** Green = the owner rule holds. A capped walk can still be green, but only on what it PROVED. */
export const isExact = (v: Verdict): boolean =>
  v.countsAgree && !v.duplicates.length && !v.extra.length
  && (v.capped ? true : v.walkComplete && v.missing !== null && v.missing.length === 0);

// ── MUTATION PROOFS — hermetic, run before any network call, both directions ─────────────────────
// Applied to judgeClickAgainstTruth/isExact themselves. Modelled on a real 540-row scope
// (المدينة المنورة · فيلا · بيع) so the numbers are the shape production actually produces.
{
  let blind = 0;
  const mustCatch = (label: string, caught: boolean) => {
    console.log(`  ${caught ? '✓' : '❌'} MUTATION ${caught ? 'caught' : 'SURVIVED'}: ${label}`);
    if (!caught) blind++;
  };
  const ids = Array.from({ length: 540 }, (_, i) => `aqar_residential_listings:${1000 + i}`);
  const truth = new Set(ids);
  const walk = (over: Partial<ClickWalk> = {}): ClickWalk => ({ total: 540, ids, capped: false, ...over });

  // NEGATIVE CONTROL FIRST — a genuinely correct scope must not be flagged. Without this every
  // mutation below is satisfiable by a predicate that always reports a defect.
  mustCatch('(negative control) a correct scope is NOT flagged — chip 540, 540 walked, 540 in truth',
    isExact(judgeClickAgainstTruth(540, walk(), truth, 540)));

  // THE CASE NO COUNT CHECK CAN SEE: one row dropped, one row added, every total still 540.
  {
    const swapped = [...ids.slice(0, 539), 'gathern_residential_listings:99999'];
    const v = judgeClickAgainstTruth(540, walk({ ids: swapped }), truth, 540);
    mustCatch('a dropped row and an added row that CANCEL OUT (all three totals still 540)',
      !isExact(v) && v.countsAgree && v.missing?.length === 1 && v.extra.length === 1);
  }

  // A duplicate id in the returned set — the same card twice, which offset paging can produce.
  {
    const dup = [...ids.slice(0, 539), ids[0]];
    const v = judgeClickAgainstTruth(540, walk({ ids: dup }), truth, 540);
    mustCatch('the same listing returned twice across pages (539 distinct, 540 rows)',
      !isExact(v) && v.duplicates.length === 1 && !v.walkComplete);
  }

  // WIDENING — the click returns everything true plus rows outside the scope.
  {
    const wide = [...ids, 'dealapp_commercial_listings:693812'];
    const v = judgeClickAgainstTruth(541, walk({ ids: wide, total: 541 }), truth, 540);
    mustCatch('a SUPERSET — the click widens past the eligible set (541 vs 540)',
      !isExact(v) && v.extra.length === 1);
  }

  // The chip advertising a number its own set does not have — ops_incident #31's exact shape.
  mustCatch('a chip that disagrees with its own set (the live 266-vs-3,358 shape, scaled)',
    !isExact(judgeClickAgainstTruth(266, walk(), truth, 540)));
  mustCatch('a chip that reads ONE cluster member instead of the union (177, not 177+88)',
    !isExact(judgeClickAgainstTruth(177, { total: 265, ids: [], capped: false }, new Set(), 265)));

  // A CAPPED walk proves the prefix and nothing more: extra is still caught, missing is UNPROVEN —
  // and a capped walk must never be used to claim the set is complete.
  {
    const prefix = ids.slice(0, 100);
    const v = judgeClickAgainstTruth(540, { total: 540, ids: prefix, capped: true }, truth, 540);
    mustCatch('a capped walk reports missing as UNPROVEN rather than as zero', v.missing === null);
    mustCatch('a capped walk still catches an EXTRA row inside the prefix it did walk',
      !isExact(judgeClickAgainstTruth(540, { total: 540, ids: [...prefix, 'x_residential_listings:1'], capped: true }, truth, 540)));
  }

  if (blind) { console.log(`\n✗ ${blind} mutation(s) survived — the predicate is blind to its own defect\n`); process.exit(1); }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE
// ────────────────────────────────────────────────────────────────────────────────────────────────

async function rpc(fn: string, params: Record<string, unknown>): Promise<any[]> {
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(params) })
    .catch((e) => die(`${fn} unreachable — ${(e as Error).message}`));
  if (!r.ok) die(`${fn} answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as any[];
}

async function rest<T = any>(qs: string, table = 'search_listings_ar'): Promise<T[]> {
  const r = await fetch(`${BASE}/rest/v1/${table}?${qs}`, { headers: H })
    .catch((e) => die(`${table} unreachable — ${(e as Error).message}`));
  if (!r.ok && r.status !== 206) die(`${table} answered ${r.status} on ${qs.slice(0, 200)}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T[];
}

async function restCount(qs: string, table = 'search_listings_ar'): Promise<number> {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=listing_id&${qs}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    .catch((e) => die(`${table} count unreachable — ${(e as Error).message}`));
  if (!r.ok && r.status !== 206 && r.status !== 416) die(`${table} count answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const cr = r.headers.get('content-range') ?? '';
  if (!cr.includes('/')) die(`${table} count returned no content-range — the total is unknowable`);
  return Number(cr.split('/')[1]);
}

console.log('\nTrending: the number on the chip is the exact SET the click delivers');
console.log(`  bounds — ${CLICK_PAGE}/page, ≤${CLICK_ROW_CAP} click rows per scope, ≤${ORACLE_ROW_CAP} oracle rows per scope\n`);

// ── the real client code, lifted and EXECUTED (never re-typed) ──────────────────────────────────
const S = await liftSearchScope(ROOT).catch((e) => die(`could not lift the table scope out of src/data/remote.ts — ${(e as Error).message}`));
// applyClusterUnion + collapseClustersForTrending ARE the display layer: for a clustered city the
// number a human reads is not a number any RPC returned, it is these two functions' arithmetic over
// several chip rows. Asserting against a re-typed sum would be asserting against a copy.
const L = (await liftSymbols(
  join(ROOT, 'src/data/locations.ts'),
  [{ header: 'export function applyClusterUnion(' }, { header: 'export function collapseClustersForTrending(' }],
  ['applyClusterUnion', 'collapseClustersForTrending'],
  'type CityOption = { cityId: number; cityAr: string; listingCount: number; clusterKey?: string };\n',
).catch((e) => die(`could not lift the Trending cluster display layer out of src/data/locations.ts — ${(e as Error).message}`))) as {
  applyClusterUnion: (o: any[], m: Map<number, string>) => any[];
  collapseClustersForTrending: (p: any[]) => any[];
};

const known = await rest<{ type_ar: string; macro: string }>('select=type_ar,macro', 'known_type_ar');
if (!known.length) die('known_type_ar returned nothing — the category purity gate is untranslatable');
const TYPE_MACROS = Object.fromEntries(known.map((k) => [k.type_ar, k.macro]));
const COM_ALL = [...new Set(known.filter((k) => k.macro === 'Commercial').map((k) => k.type_ar))];
// عمارة is excluded from the residential-table arm of a broad Commercial search: in a residential
// table it is a Residential Building, and including it would leak apartment blocks (searchTableScope).
const COM_RES = COM_ALL.filter((t) => t !== 'عمارة');

const catalog = await rest<{ city_id: number; city_ar: string }>('select=city_id,city_ar', 'loc_catalog_city');
if (!catalog.length) die('loc_catalog_city returned nothing — a city name cannot be resolved');
const CITY_NAME = new Map(catalog.map((c) => [Number(c.city_id), c.city_ar]));
const CITY_ID = new Map(catalog.map((c) => [c.city_ar, Number(c.city_id)]));

const clusterRows = await rest<{ city_id: number; cluster_key: string }>('select=city_id,cluster_key', 'loc_city_cluster');
const CLUSTER_OF = new Map<number, string>(clusterRows.map((c) => [Number(c.city_id), String(c.cluster_key)]));
const CLUSTER_MEMBERS = new Map<string, number[]>();
for (const c of clusterRows) CLUSTER_MEMBERS.set(c.cluster_key, [...(CLUSTER_MEMBERS.get(c.cluster_key) ?? []), Number(c.city_id)]);
check('loc_city_cluster declares at least one cluster to exercise', CLUSTER_MEMBERS.size > 0,
  'no clusters live — the clustered scope below cannot be built, and the one case where the displayed number is client-side arithmetic goes untested');
const FIRST_CLUSTER = [...CLUSTER_MEMBERS.keys()].sort()[0];

// ── the four scopes ─────────────────────────────────────────────────────────────────────────────
type Scope = {
  label: string;
  q: { deal: string; rentPeriod?: string };
  deal: string;
  period?: string;
  category: 'Residential' | 'Commercial';
  types: string[] | null;
  broad: boolean;
  /** a cluster_key (the click lands on its representative) or a literal city name */
  target: { cluster: string } | { city: string };
  /** everything beyond the base cohort — the narrowing that must not widen the set */
  narrowing?: Record<string, unknown>;
  /** this scope's set must be a strict subset of the named scope's already-walked set */
  subsetOf?: string;
};

const SCOPES: Scope[] = [
  { label: '1 CLUSTER', q: { deal: 'Rent', rentPeriod: 'annual' }, deal: 'إيجار', period: 'سنوي',
    category: 'Residential', types: ['شقة'], broad: false, target: { cluster: FIRST_CLUSTER } },
  { label: '2 PLAIN', q: { deal: 'Buy' }, deal: 'بيع',
    category: 'Residential', types: ['فيلا'], broad: false, target: { city: 'المدينة المنورة' } },
  { label: '3 COMMERCIAL (broad)', q: { deal: 'Buy' }, deal: 'بيع',
    category: 'Commercial', types: null, broad: true, target: { city: 'الخرج' } },
  { label: '4 NARROWED', q: { deal: 'Buy' }, deal: 'بيع',
    category: 'Residential', types: ['فيلا'], broad: false, target: { city: 'المدينة المنورة' },
    narrowing: { p_beds_exact: [5], p_price_min: 1_000_000 }, subsetOf: '2 PLAIN' },
];

/** searchTableScope()'s two shapes, as the purity-gate barrier already builds them. */
function tableScopeFor(s: Scope) {
  const RES = S.resTables(s.q), COM = S.comTables(s.q);
  return s.broad
    ? { p_tables: RES, p_tables2: COM, p_types2: COM_ALL }
    : { p_tables: RES, p_tables2: COM.filter((t) => !RES.includes(t)), p_types2: s.types };
}

/** The number the human reads, produced by the REAL display layer over the REAL chip rows. */
function displayedChip(chips: any[], memberIds: number[]): { count: number; label: string } | null {
  const pool = chips.map((c) => ({
    cityId: Number(c.city_id), cityAr: String(c.city_ar), listingCount: Number(c.listing_count),
  }));
  const collapsed = L.collapseClustersForTrending(L.applyClusterUnion(pool, CLUSTER_OF));
  const row = collapsed.find((o: any) => memberIds.includes(o.cityId));
  return row ? { count: row.listingCount, label: row.cityAr } : null;
}

async function walkClick(body: Record<string, unknown>): Promise<ClickWalk> {
  const ids: string[] = [];
  let total = -1;
  for (let offset = 0; ; offset += CLICK_PAGE) {
    const rows = await rpc('location_search_candidates_ar', { ...body, p_limit: CLICK_PAGE, p_offset: offset });
    if (total < 0) total = Number(rows[0]?.total_count ?? 0);
    for (const r of rows) ids.push(`${r.source_table}:${Number(r.listing_id)}`);
    rowsWalked += rows.length;
    if (!rows.length || ids.length >= total || ids.length >= CLICK_ROW_CAP) {
      return { total, ids, capped: ids.length >= CLICK_ROW_CAP && ids.length < total };
    }
  }
}

async function walkTruth(qs: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let offset = 0; offset < ORACLE_ROW_CAP; offset += ORACLE_PAGE) {
    // A total order on the unique key, so offset paging cannot skip or repeat a row.
    const rows = await rest<{ source_table: string; listing_id: number }>(
      `select=source_table,listing_id&${qs}&order=source_table.asc,listing_id.asc&limit=${ORACLE_PAGE}&offset=${offset}`,
    );
    for (const r of rows) out.add(`${r.source_table}:${Number(r.listing_id)}`);
    if (rows.length < ORACLE_PAGE) return out;
  }
  return die(`the independent truth set exceeds ORACLE_ROW_CAP=${ORACLE_ROW_CAP} — refusing to claim a set proof over a truncated oracle`);
}

const walkedSets = new Map<string, Set<string>>();
let uncappedScopes = 0;
const cappedScopes: string[] = [];

for (const s of SCOPES) {
  const scope = tableScopeFor(s);
  const cohort: Record<string, unknown> = {
    p_deal: s.deal, ...(s.period ? { p_rent_period: s.period } : {}),
    p_category: s.category, ...(s.types ? { p_types: s.types } : {}),
  };
  // rpcAllNarrowingParams(): every narrowing the user chose reaches Trending AND the click, or the
  // chip is describing a different set from the one the click returns (the 2026-08-22 defect).
  const chipArgs = { ...cohort, ...scope, ...(s.narrowing ?? {}) };

  const memberIds = 'cluster' in s.target
    ? (CLUSTER_MEMBERS.get(s.target.cluster) ?? [])
    : [CITY_ID.get(s.target.city) ?? -1];
  if (!memberIds.length || memberIds[0] < 0) { check(`${s.label}: the target city resolves in loc_catalog_city`, false, JSON.stringify(s.target)); continue; }

  const chips = await rpc('top_cities_by_deal_ar', chipArgs);
  const shown = displayedChip(chips, memberIds);
  if (!shown) { check(`${s.label}: Trending shows a chip for this scope at all`, false, `no row for city_id(s) ${memberIds.join('/')} in ${chips.length} chip(s) — a scope with no chip certifies nothing`); continue; }

  // The click: the collapsed row commits to ONE name (its representative), and that is what is sent.
  const clicked = shown.label;
  const clickBody = {
    ...cohort, ...(s.broad ? { p_types: COM_RES } : {}), ...scope, ...(s.narrowing ?? {}),
    p_cities: [clicked], p_per_platform: null, p_rotation_seed: ROTATION_SEED,
  };

  // The oracle sees the SAME body, with the clicked name expanded to every member of its cluster —
  // reference data (loc_city_cluster ⋈ loc_catalog_city), never a re-implementation of
  // composite_match_city_ids(). For a non-clustered city this is a one-element list, i.e. a no-op.
  const oracleCities = memberIds.map((id) => CITY_NAME.get(id)).filter(Boolean) as string[];
  const { qs, unhandled } = buildOracleQS({ ...clickBody, p_cities: oracleCities }, { typeMacros: TYPE_MACROS });
  if (unhandled.length) {
    check(`${s.label}: the independent oracle can express every predicate of this click`, false,
      `UNHANDLED: ${unhandled.join(' | ')} — refusing to certify a set the oracle cannot fully express`);
    continue;
  }

  const [walk, truthTotal] = await Promise.all([walkClick(clickBody), restCount(qs)]);
  const truth = await walkTruth(qs);
  const v = judgeClickAgainstTruth(shown.count, walk, truth, truthTotal);
  walkedSets.set(s.label, new Set(walk.ids));
  if (v.capped) cappedScopes.push(s.label); else uncappedScopes++;

  const where = 'cluster' in s.target ? `cluster ${s.target.cluster} → «${clicked}»` : `«${clicked}»`;
  const numbers = `chip=${shown.count} click=${walk.total} truth=${truthTotal} walked=${walk.ids.length} `
    + `missing=${v.missing === null ? 'UNPROVEN(capped)' : v.missing.length} extra=${v.extra.length} dup=${v.duplicates.length}`;
  console.log(`  ${s.label} · ${where} · ${s.category}${s.types ? `/${s.types.join('+')}` : ' (broad)'}/${s.deal}${s.period ? `/${s.period}` : ''}${s.narrowing ? ` + ${Object.keys(s.narrowing).join(',')}` : ''}`);
  console.log(`      ${numbers}`);

  check(`${s.label}: the scope has inventory (a chip of 0 certifies nothing)`, shown.count > 0,
    `the chip advertises ${shown.count} — pick a scope that exists, or this barrier is green over nothing`);
  check(`${s.label}: chip == the click's own total == the independent truth total`, v.countsAgree, numbers);
  if (!v.capped) check(`${s.label}: the walk returned exactly ${walk.total} distinct rows`, v.walkComplete, numbers);
  check(`${s.label}: no LOST listing — every row in truth is returned by the click`,
    v.missing === null || v.missing.length === 0,
    `${v.missing?.length} missing, e.g. ${(v.missing ?? []).slice(0, 5).join(', ')}`);
  check(`${s.label}: no WRONG CARD — the click returns nothing outside the eligible set (no widening)`,
    v.extra.length === 0, `${v.extra.length} extra, e.g. ${v.extra.slice(0, 5).join(', ')}`);
  check(`${s.label}: no listing returned twice across pages`, v.duplicates.length === 0, v.duplicates.slice(0, 5).join(', '));
  check(`${s.label}: the owner rule holds — displayed count = true eligible DB set = the click's exact set`,
    isExact(v), numbers);

  // NARROWING MUST NOT WIDEN, as a set relation between two sets this run actually walked — not as
  // an inequality between two totals, which a widened-but-smaller set would satisfy.
  if (s.subsetOf) {
    const parent = walkedSets.get(s.subsetOf);
    if (!parent) check(`${s.label}: its unnarrowed parent (${s.subsetOf}) was walked`, false, 'the parent scope did not complete — the subset relation is unmeasurable');
    else {
      const outside = [...walk.ids].filter((id) => !parent.has(id));
      check(`${s.label}: adding a predicate NARROWS — every row is also in ${s.subsetOf}'s set`,
        outside.length === 0, `${outside.length} row(s) appear only under the NARROWED search, e.g. ${outside.slice(0, 5).join(', ')}`);
      check(`${s.label}: …and it is a STRICT subset (the predicate actually bit)`,
        walk.ids.length < parent.size, `narrowed=${walk.ids.length} parent=${parent.size}`);
    }
  }
}

check('at least three scopes were proven as COMPLETE sets, not prefixes', uncappedScopes >= 3,
  `${uncappedScopes} complete, ${cappedScopes.length} capped (${cappedScopes.join(', ') || 'none'})`);

console.log(`\n  ${rowsWalked} click row(s) walked across ${SCOPES.length} scope(s)`
  + `${cappedScopes.length ? ` · UNPROVEN (prefix only, missing not measurable): ${cappedScopes.join(', ')}` : ''}`);
if (failures) console.log(`  failed: ${failedLabels.join(' | ')}`);
console.log(failures === 0
  ? '\n✓ verify-trending-set-equals-the-click-live: the chip, the click and independent DB truth are the SAME SET\n'
  : `\n✗ verify-trending-set-equals-the-click-live: ${failures} check(s) failed — Trending is describing a set the click does not deliver\n`);
process.exit(failures === 0 ? 0 : 1);
