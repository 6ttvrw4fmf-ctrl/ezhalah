// TRENDING SHOWS ONE CANONICAL ROW PER CITY CLUSTER, WITHOUT BREAKING AUTOCOMPLETE — the client layer.
//
// THE RULE (owner 2026-09-04). A Trending number must equal the exact set clicking it returns; where
// the canonical resolver treats several city_ids as ONE search entity (loc_city_cluster), Trending
// presents ONE canonical option — but normal city search/autocomplete must still let users select
// EVERY member (الاحساء AND الهفوف), and a non-clustered twin (الهفوف/Riyadh, city_id 501) stays
// separate. The shared RPC/catalog must not change (collapsing top_cities_by_deal_ar removed الاحساء
// from the tap-only autocomplete pool — reverted). So the collapse lives in the DISPLAY layer:
// applyClusterUnion() bakes the union count into the pool; collapseClustersForTrending() dedups the
// Trending view to the representative; matchCitiesByText() keeps every member.
//
// This EXECUTES the real lifted pure functions (never a copy) and pins the call sites by shape.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'src/data/locations.ts'), 'utf8');

const lifted = await liftSymbols(
  join(ROOT, 'src/data/locations.ts'),
  [
    { header: 'export function applyClusterUnion' },
    { header: 'export function collapseClustersForTrending' },
  ],
  ['applyClusterUnion', 'collapseClustersForTrending'],
  'type CityOption = any;',
);
const applyClusterUnion = lifted.applyClusterUnion as (opts: any[], m: Map<number, string>) => any[];
const collapseClustersForTrending = lifted.collapseClustersForTrending as (pool: any[]) => any[];

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
};

// A realistic pool: al_ahsa cluster {الهفوف 12 (4305), الاحساء 3677 (648)}, plus non-clustered
// الرياض (3, 39000) and الهفوف/Riyadh (501, 5) which shares a NAME but not the cluster.
const opt = (cityId: number, cityAr: string, regionId: number, listingCount: number) =>
  ({ cityId, cityAr, regionId, regionAr: null, listingCount, totalInCohort: 100000 });
const rawPool = [
  opt(3, 'الرياض', 1, 39000),
  opt(12, 'الهفوف', 5, 4305),
  opt(3677, 'الاحساء', 5, 648),
  opt(501, 'الهفوف', 1, 5),
];
const clusterMap = new Map<number, string>([[12, 'al_ahsa'], [3677, 'al_ahsa']]);
const UNION = 4305 + 648; // 4953

// ── applyClusterUnion: both members carry the union; non-clustered untouched; tagged ─────────────
const pool = applyClusterUnion(rawPool, clusterMap);
const byId = (id: number) => pool.find((o) => o.cityId === id)!;
check('applyClusterUnion: الهفوف(12) count == union', byId(12).listingCount === UNION, `${byId(12).listingCount}`);
check('applyClusterUnion: الاحساء(3677) count == union', byId(3677).listingCount === UNION, `${byId(3677).listingCount}`);
check('applyClusterUnion: both members tagged al_ahsa', byId(12).clusterKey === 'al_ahsa' && byId(3677).clusterKey === 'al_ahsa');
check('applyClusterUnion: الرياض(3) untouched', byId(3).listingCount === 39000 && byId(3).clusterKey === undefined);
check('applyClusterUnion: الهفوف/Riyadh(501) untouched (not in cluster) — the twin stays separate',
  byId(501).listingCount === 5 && byId(501).clusterKey === undefined);
check('AUTOCOMPLETE preserves EVERY member: both الاحساء and الهفوف remain in the pool',
  pool.some((o) => o.cityId === 12) && pool.some((o) => o.cityId === 3677),
  'a member dropped from the pool would be unselectable by typing');

// ── collapseClustersForTrending: one row per cluster (representative), no duplicate ──────────────
const trending = collapseClustersForTrending(pool);
const ahsaRows = trending.filter((o) => o.clusterKey === 'al_ahsa');
check('TRENDING: exactly ONE al_ahsa row (no duplicate cluster rows)', ahsaRows.length === 1,
  `${ahsaRows.length}: ${JSON.stringify(ahsaRows.map((o) => ({ id: o.cityId, ar: o.cityAr, n: o.listingCount })))}`);
check('TRENDING: the surviving row is the representative (min city_id 12 = الهفوف)',
  ahsaRows[0]?.cityId === 12, `got ${ahsaRows[0]?.cityId}`);
check('TRENDING: its count == the union it clicks to', ahsaRows[0]?.listingCount === UNION, `${ahsaRows[0]?.listingCount}`);
check('TRENDING: الاحساء(3677) is NOT a second row', !trending.some((o) => o.cityId === 3677));
check('TRENDING: الهفوف/Riyadh(501) remains a separate row (not merged into the cluster)',
  trending.some((o) => o.cityId === 501));
check('TRENDING: الرياض still present and ranked first (re-sorted by the union count)',
  trending[0]?.cityId === 3);

// ── call-site shape: the two surfaces are wired to the two functions ─────────────────────────────
const strip = (t: string) => t;
check('topCitiesByListings collapses clusters (uses collapseClustersForTrending)',
  /collapseClustersForTrending\(pool\)/.test(strip(src)));
{
  const mStart = src.indexOf('export function matchCitiesByText');
  const mBody = src.slice(mStart, src.indexOf('\n}', mStart));
  check('matchCitiesByText reads the pool directly (every member stays selectable in autocomplete)',
    mStart >= 0 && /CITY_FIELD_POOLS\.get\(cityPoolKey/.test(mBody));
  check('matchCitiesByText does NOT collapse clusters (only Trending does)',
    !mBody.includes('collapseClustersForTrending'));
}
check('the pool is built with the cluster union baked in (applyClusterUnion at pool-build)',
  /const opts = applyClusterUnion\(rawOpts, await ensureClusterMap\(\)\)/.test(strip(src)));


// ── EXECUTABLE MUTATION PROOFS — the barrier's own invariants, evaluated on deliberately broken
// inputs, MUST come out violated (else the corresponding check above cannot catch the bug). The
// external red→green across a source mutation is recorded in the PR; these keep the proof in-file.
const mustCatch = (label: string, invariantHeldOnBrokenInput: boolean) => {
  check(`MUTATION ${label} — the check catches it`, invariantHeldOnBrokenInput === false,
    "the invariant held on a deliberately broken input, so the check cannot catch this bug");
};
// Broken input A: the pool was NOT union-counted (members keep their own counts) → «count == union» is violated.
const noUnionPool = rawPool.map((o) => ({ ...o, clusterKey: clusterMap.get(o.cityId) }));
mustCatch('no-union pool → member count != click union', noUnionPool.find((o) => o.cityId === 12)!.listingCount === UNION);
// Broken input B: an un-collapsed pool → TWO al_ahsa rows (the duplicate-cluster-row bug).
mustCatch('un-collapsed pool → duplicate cluster rows', pool.filter((o) => o.clusterKey === 'al_ahsa').length === 1);
// Broken input C: a collapse that dropped a member from the pool → autocomplete loses الاحساء (the reverted regression).
mustCatch('member dropped from pool → not selectable', pool.filter((o) => o.cityId === 3677).length === 0);

console.log(failed
  ? `\n✗ verify-trending-cluster-collapse-client: ${failed} check(s) failed.\n`
  : '\n✅ verify-trending-cluster-collapse-client: one Trending row per cluster; every member stays selectable; shown == click.\n');
process.exit(failed ? 1 : 0);
