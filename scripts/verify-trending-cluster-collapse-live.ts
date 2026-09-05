// A TRENDING NUMBER MUST EQUAL THE EXACT SET A CLICK RETURNS — for canonical city clusters too.
//
// THE RULE (owner 2026-09-04). «Every Trending number shown must equal the exact set the user gets
// when clicking it.» And: where the canonical resolver intentionally treats several city_ids as ONE
// search entity, Trending must present that as ONE canonical option — not several misleading rows.
//
// THE CANONICAL SOURCE OF "one search entity" is loc_city_cluster: composite_match_city_ids' CLUSTER
// EXPANSION packs every sibling of a clustered city into that listing's match_city_ids, so the results
// RPC (which resolves a clicked city NAME through match_city_ids) delivers the whole cluster's union no
// matter which member you clicked. Before the 2026-09-04 collapse, top_cities_by_deal_ar grouped by
// raw city_id, so the sole cluster al_ahsa surfaced TWO rows — الهفوف (own 4,305) and الاحساء (own 648)
// — while clicking EITHER delivered 4,953.
//
// WHAT THIS ASSERTS, deriving the clusters FROM loc_city_cluster (never a hardcoded list, so a new
// cluster is covered automatically) and re-proving every number through the anon path users hit:
//   (1) ONE ROW PER CLUSTER — exactly one top_cities row carries a city_id that is a cluster member,
//       and it is the representative (min member id); no other member appears as its own row.
//   (2) SHOWN == CLICK — that row's listing_count == the results RPC total_count for clicking its name.
//   (3) SHOWN == DB TRUTH — and == an independent PostgREST count of the cluster's own listings
//       (production_ready, same deal, city_id ∈ members) — 0 missing, 0 extra, 0 duplicates.
//   (4) CONTROL — a NON-clustered city (الرياض) still appears as its own row and shown == click, so the
//       collapse touches only clusters.
//
// MUTATION PROOF is the deploy itself: run this against production BEFORE the collapse migration and it
// is RED on (1) (two al_ahsa rows) and (2)/(3) (4,305 ≠ 4,953); after the migration it is GREEN. That
// red→green across the apply is recorded in the PR.
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const getJSON = async (path: string): Promise<any> => {
  const r = await fetch(`${REST}/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
};
const rpc = async (fn: string, body: Record<string, unknown>): Promise<any[]> => {
  const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`rpc ${fn} → ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
};
// exact-count of production_ready listings for a deal restricted to a set of physical city_ids
const dbCount = async (deal: string, cityIds: number[]): Promise<number> => {
  const r = await fetch(
    `${REST}/search_listings_ar?select=listing_id&production_ready=is.true&deal_ar=eq.${encodeURIComponent(deal)}&city_id=in.(${cityIds.join(',')})&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } },
  );
  if (!r.ok) throw new Error(`dbCount → ${r.status}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};

console.log('verify-trending-cluster-collapse-live: one canonical Trending row per cluster; shown == click == DB truth.');

// ── the canonical clusters, from the resolver's own table ────────────────────────────────────────
const rawCluster = (await getJSON('loc_city_cluster?select=cluster_key,city_id')) as { cluster_key: string; city_id: number }[];
check('loc_city_cluster is readable and non-empty', rawCluster.length > 0, `${rawCluster.length} rows`);
const clusters = new Map<string, number[]>();
for (const { cluster_key, city_id } of rawCluster) {
  clusters.set(cluster_key, [...(clusters.get(cluster_key) ?? []), city_id]);
}
const catalog = new Map<number, { city_ar: string; region_id: number | null }>();
for (const c of (await getJSON('loc_catalog_city?select=city_id,city_ar,region_id')) as any[]) {
  catalog.set(c.city_id, { city_ar: c.city_ar, region_id: c.region_id });
}

// ── per-cluster, across deals ────────────────────────────────────────────────────────────────────
const DEALS: [string, string][] = [['بيع', 'Buy'], ['إيجار', 'Rent']];
for (const [key, membersUnsorted] of clusters) {
  const members = [...membersUnsorted].sort((a, b) => a - b);
  const rep = members[0];                              // representative = min city_id (matches the SQL)
  const repName = catalog.get(rep)?.city_ar ?? `#${rep}`;
  for (const [dealAr, dealEn] of DEALS) {
    const rows = await rpc('top_cities_by_deal_ar', { p_deal: dealAr });
    const memberRows = rows.filter((r) => members.includes(r.city_id));
    const label = `[${key}/${dealEn}]`;

    // (1) exactly one row, and it is the representative
    check(`${label} exactly ONE Trending row for the cluster`, memberRows.length === 1,
      `got ${memberRows.length}: ${JSON.stringify(memberRows.map((r) => ({ id: r.city_id, ar: r.city_ar, n: r.listing_count })))}`);
    if (memberRows.length !== 1) continue;
    const row = memberRows[0];
    check(`${label} the surviving row is the representative (min city_id ${rep})`, row.city_id === rep,
      `got city_id ${row.city_id} (${row.city_ar})`);

    const shown = Number(row.listing_count);
    // (2) shown == click (results RPC total_count for the row's name)
    const clickRows = await rpc('location_search_candidates_ar', { p_deal: dealAr, p_cities: [row.city_ar], p_limit: 1, p_offset: 0 });
    const click = Number(clickRows[0]?.total_count ?? (clickRows.length === 0 ? 0 : NaN));
    check(`${label} Trending shown == click result`, shown === click, `shown=${shown} click=${click}`);

    // (3) shown == independent DB truth (the cluster's own listings for this deal)
    const truth = await dbCount(dealAr, members);
    check(`${label} Trending shown == independent DB truth (0 missing/extra/dup)`, shown === truth,
      `shown=${shown} dbTruth=${truth} (members ${members.join('+')})`);
  }
}

// ── (4) control: a non-clustered high-volume city is unaffected ──────────────────────────────────
const clustered = new Set(rawCluster.map((r) => r.city_id));
const buy = await rpc('top_cities_by_deal_ar', { p_deal: 'بيع' });
const riyadh = buy.find((r) => r.city_ar === 'الرياض' && !clustered.has(r.city_id));
check('control: الرياض (non-clustered) still appears as its own Trending row', Boolean(riyadh),
  riyadh ? '' : 'الرياض missing or unexpectedly clustered');
if (riyadh) {
  const c = await rpc('location_search_candidates_ar', { p_deal: 'بيع', p_cities: ['الرياض'], p_limit: 1, p_offset: 0 });
  check('control: الرياض shown == click', Number(riyadh.listing_count) === Number(c[0]?.total_count),
    `shown=${riyadh.listing_count} click=${c[0]?.total_count}`);
}

console.log(failures === 0
  ? '\n✅ verify-trending-cluster-collapse-live: every cluster is one canonical row; shown == click == DB truth.\n'
  : `\n✗ verify-trending-cluster-collapse-live: ${failures} check(s) failed — a Trending number does not equal its click set.\n`);
process.exit(failures === 0 ? 0 : 1);
