// TRENDING'S THREE CACHES MUST NOT REMEMBER A FAILURE, AND MUST NOT FORGET A SUCCESS — executed.
//
// Two defects in src/data/locations.ts, both found 2026-09-18 (routine #5), both invisible to every
// source-text guard over the same lines because both are control flow, not spelling.
//
// DEFECT A — ops_incident #268. `ensureClusterMap()` read loc_city_cluster by destructuring ONLY
// `data` and then `(data as any[]) ?? []`. supabase-js NEVER throws, so a 500/offline/aborted select
// simply RESOLVES `{data:null,error}`: the loop ran zero times and the resulting EMPTY map was written
// to the `_clusterMap` memo, which is consulted first on every later call. One transient blip at boot
// therefore turned cluster collapse off for the entire session, with no retry after the network came
// back. That is not cosmetic: with no map, applyClusterUnion() is a no-op, so الاحساء advertises its
// own member count (3,677) while composite_match_city_ids' server-side cluster expansion returns the
// whole union (4,953) when the user clicks it — the COUNT→CLICK mismatch of PART 2/PART 3 and barrier
// item #24 — and Trending lists الاحساء and الهفوف as two rows for one search entity.
//
// DEFECT B — POOL_TTL_MS was INERT on BOTH Trending pools. `_cityFieldPromises` / `_districtPromises`
// exist to dedupe CONCURRENT callers; every failure path deleted the entry, but the SUCCESS path did
// not. `if (inflight) return inflight` sits BELOW the TTL check and has no expiry of its own, so once
// the 30-minute clock lapsed the stale-cache check fell through and then handed back that very same
// resolved promise. The pool could never be refetched for the life of the tab. The owner added that
// TTL on 2026-09-11 so a long-lived session is never more than ~one sync_search_listings_ar cycle
// behind; it had never once taken effect. Barrier items #19 and #20 (city/district count stale).
//
// WHY THIS FORM. The existing guard naming ensureClusterMap,
// scripts/verify-trending-cluster-collapse-client.ts:91, is a source-TEXT regex pinning the CALL-SITE
// SPELLING — it passed on every day both defects were live (the incident-#136 class). This one RUNS
// the real declarations, lifted verbatim out of locations.ts and never re-typed
// ([[feedback_never-test-a-copy-of-production-code]]), against an injected client that RESOLVES
// {data:null,error} the way supabase-js really does, and asserts on the state they leave behind.
//
//   node --experimental-strip-types scripts/verify-trending-pool-caches-recover.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/data/locations.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// The ONLY stand-ins: the injected Supabase client (the failure being simulated) and type aliases.
// Types are erased at runtime, so every alias here is inert — no logic is substituted for production's.
const PRELUDE = `
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
type Deal = any; type Category = any; type AfParams = any;
type CityOption = any; type DistrictOption = any; type PoolStatus = any;
`;

type Lifted = {
  ensureClusterMap: () => Promise<Map<number, string>>;
  clusterMapLoaded: () => boolean;
  applyClusterUnion: (opts: any[], m: Map<number, string>) => any[];
  ensureCityFieldIndex: (deal: any, periodTok?: any, category?: any, types?: any, af?: any) => Promise<any[]>;
  ensureDistrictOptions: (cityId: number, deal: any, category?: any, periodTok?: any, types?: any, scope?: any) => Promise<any[]>;
  CITY_FIELD_POOLS: Map<string, any[]>;
  _cityPoolFetchedAt: Map<string, number>;
  _districtFetchedAt: Map<string, number>;
  setClient: (c: unknown) => void;
};

/** Lift the REAL declarations out of a copy of locations.ts (the real file, or a mutant of it). */
async function load(source: string): Promise<Lifted> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-trendcache-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, source);
  // A single-line declaration ends on its OWN line — and some carry a trailing `// comment`, so a
  // bare /;$/ overshoots into the NEXT declaration and lifts it twice (a loud duplicate-identifier
  // parse error, never a silent wrong lift).
  const LINE = /;\s*(\/\/.*)?$/;
  return await liftSymbols(file, [
    { header: 'function dealAr(', endsWith: /^\}$/ },
    { header: 'const pmKey', endsWith: LINE },
    { header: 'const typesKey', endsWith: LINE },
    { header: 'const afKey', endsWith: /^\};$/ },
    { header: 'const cityPoolKey', endsWith: LINE },
    { header: 'const CITY_FIELD_POOLS', endsWith: LINE },
    { header: 'const _cityFieldPromises', endsWith: LINE },
    { header: 'const POOL_TTL_MS', endsWith: LINE },
    { header: 'const _cityPoolFetchedAt', endsWith: LINE },
    { header: 'const _cityPoolStatus', endsWith: LINE },
    { header: 'const _districtPoolStatus', endsWith: LINE },
    { header: 'let _clusterMap', endsWith: LINE },
    { header: 'let _clusterPromise', endsWith: LINE },
    // A one-liner: it ends on its OWN line, so the terminator must match that line, not a column-0
    // `}` (which would slurp the whole of ensureClusterMap below it into this slice).
    { header: 'export function clusterMapLoaded(', endsWith: /\}$/ },
    { header: 'export async function ensureClusterMap(', endsWith: /^\}$/ },
    { header: 'export function applyClusterUnion(', endsWith: /^\}$/ },
    { header: 'export async function ensureCityFieldIndex(', endsWith: /^\}$/ },
    { header: 'const _districtCache', endsWith: LINE },
    { header: 'const _districtPromises', endsWith: LINE },
    { header: 'const _districtFetchedAt', endsWith: LINE },
    { header: 'const districtCacheKey', endsWith: LINE },
    { header: 'export async function ensureDistrictOptions(', endsWith: /^\}$/ },
  ], [
    'ensureClusterMap', 'clusterMapLoaded', 'applyClusterUnion', 'ensureCityFieldIndex',
    'ensureDistrictOptions', 'CITY_FIELD_POOLS', '_cityPoolFetchedAt', '_districtFetchedAt', 'setClient',
  ], PRELUDE) as unknown as Lifted;
}

// ── what production actually hands back ───────────────────────────────────────────────────────────
// The real al_ahsa cluster: الهفوف (12) and الاحساء (3677) are ONE search entity, union 4,953.
const CLUSTER_ROWS = [
  { city_id: 12, cluster_key: 'al_ahsa' },
  { city_id: 3677, cluster_key: 'al_ahsa' },
];
const CITY_ROWS = [
  { city_id: 12, city_ar: 'الهفوف', region_id: 4, region_ar: 'الشرقية', listing_count: 1276, total_in_cohort: 90000 },
  { city_id: 3677, city_ar: 'الاحساء', region_id: 4, region_ar: 'الشرقية', listing_count: 3677, total_in_cohort: 90000 },
  { city_id: 1, city_ar: 'الرياض', region_id: 1, region_ar: 'الرياض', listing_count: 40000, total_in_cohort: 90000 },
];
const DISTRICT_ROWS = [
  { district_ar: 'الصفا', match_values: ['الصفا'], listing_count: 304, total_in_city: 4953 },
];

type Log = { cluster: number; rpc: number };
/** `ok` decides whether loc_city_cluster reads succeed; the RPCs always succeed. */
const client = (log: Log, ok: { clusters: boolean }) => ({
  from: () => ({
    select: () => {
      log.cluster++;
      return ok.clusters
        ? Promise.resolve({ data: CLUSTER_ROWS, error: null })
        : Promise.resolve({ data: null, error: { message: 'FetchError: network request failed' } });
    },
  }),
  rpc: (name: string) => ({
    abortSignal: () => {
      log.rpc++;
      return Promise.resolve({ data: name === 'top_cities_by_deal_ar' ? CITY_ROWS : DISTRICT_ROWS, error: null });
    },
  }),
});

/** Every invariant this barrier makes, as one runnable probe — reused verbatim against each mutant. */
async function probe(mod: Lifted) {
  const log: Log = { cluster: 0, rpc: 0 };
  const ok = { clusters: false };
  mod.setClient(client(log, ok));

  // ── A. the cluster read fails ──────────────────────────────────────────────────────────────────
  const mapAfterFailure = await mod.ensureClusterMap();
  const afterFailure = {
    memoised: mod.clusterMapLoaded(),
    size: mapAfterFailure.size,
    reads: log.cluster,
    // The user-visible consequence: with no map, الاحساء keeps its member count while the click
    // returns the union. applyClusterUnion is the pure function that would have fixed the count.
    ahsaCount: mod.applyClusterUnion(
      CITY_ROWS.map((r) => ({ cityId: r.city_id, listingCount: r.listing_count })), mapAfterFailure,
    ).find((o: any) => o.cityId === 3677)?.listingCount,
  };

  // ── B. a city pool built while clusters were unreadable is SERVED but not PINNED ───────────────
  const poolDuringOutage = await mod.ensureCityFieldIndex('Buy');
  const duringOutage = {
    served: poolDuringOutage.length,
    pinned: mod._cityPoolFetchedAt.size > 0,
    rpcs: log.rpc,
  };

  // ── C. the network recovers: the very next call must go back for the clusters AND rebuild ──────
  ok.clusters = true;
  const poolAfterRecovery = await mod.ensureCityFieldIndex('Buy');
  const ahsa = poolAfterRecovery.find((o: any) => o.cityId === 3677);
  const afterRecovery = {
    memoised: mod.clusterMapLoaded(),
    clusterReads: log.cluster,
    ahsaCount: ahsa?.listingCount,
    ahsaKey: ahsa?.clusterKey,
    pinned: mod._cityPoolFetchedAt.size > 0,
  };

  // ── D. a healthy pool is cached: a third call inside POOL_TTL_MS must not refetch ──────────────
  const rpcsBeforeCached = log.rpc;
  await mod.ensureCityFieldIndex('Buy');
  const cachedCallRpcs = log.rpc - rpcsBeforeCached;

  // ── E. …but the TTL is REAL: expire the clock and the next call must go back to the network ────
  for (const k of mod._cityPoolFetchedAt.keys()) mod._cityPoolFetchedAt.set(k, Date.now() - 31 * 60 * 1000);
  const rpcsBeforeStale = log.rpc;
  await mod.ensureCityFieldIndex('Buy');
  const staleCallRpcs = log.rpc - rpcsBeforeStale;

  // ── F. the district pool shares the cache shape, so it must share the TTL ──────────────────────
  await mod.ensureDistrictOptions(3677, 'Buy');
  const rpcsBeforeDistrictCached = log.rpc;
  await mod.ensureDistrictOptions(3677, 'Buy');
  const districtCachedRpcs = log.rpc - rpcsBeforeDistrictCached;
  for (const k of mod._districtFetchedAt.keys()) mod._districtFetchedAt.set(k, Date.now() - 31 * 60 * 1000);
  const rpcsBeforeDistrictStale = log.rpc;
  await mod.ensureDistrictOptions(3677, 'Buy');
  const districtStaleRpcs = log.rpc - rpcsBeforeDistrictStale;

  return {
    afterFailure, duringOutage, afterRecovery,
    cachedCallRpcs, staleCallRpcs, districtCachedRpcs, districtStaleRpcs,
  };
}

/** Every assertion below, as a single boolean — so a mutant can be held to exactly the same bar. */
const holds = (r: Awaited<ReturnType<typeof probe>>) =>
  r.afterFailure.memoised === false
  && r.afterFailure.size === 0
  && r.afterFailure.reads === 1
  && r.afterFailure.ahsaCount === 3677
  && r.duringOutage.served === 3
  && r.duringOutage.pinned === false
  && r.afterRecovery.memoised === true
  && r.afterRecovery.clusterReads === 3
  && r.afterRecovery.ahsaCount === 4953
  && r.afterRecovery.ahsaKey === 'al_ahsa'
  && r.afterRecovery.pinned === true
  && r.cachedCallRpcs === 0
  && r.staleCallRpcs === 1
  && r.districtCachedRpcs === 0
  && r.districtStaleRpcs === 1;

console.log('\nTrending caches: a failed read is never memoised, and a settled one never outlives its TTL\n');

const realSrc = readFileSync(SRC, 'utf8');
const real = await probe(await load(realSrc));

check('a failed loc_city_cluster read is NOT memoised as the cluster map',
  real.afterFailure.memoised === false,
  'the empty map was written to _clusterMap — cluster collapse is now off for the whole session');
check('the failing read really was attempted (the test is not vacuous)', real.afterFailure.reads === 1,
  `${real.afterFailure.reads} read(s) — if 0, no failure was ever simulated and every check above is empty`);
check('clusters stay an ENHANCEMENT: the failed call still returns a usable (empty) map',
  real.afterFailure.size === 0, 'a failure must degrade to an uncollapsed pool, never blank Trending');
check('the count→click mismatch is real while the map is missing (what the user would have seen)',
  real.afterFailure.ahsaCount === 3677,
  `الاحساء advertised ${real.afterFailure.ahsaCount}; the click returns the 4,953 union`);
check('a pool built during the outage is still SERVED', real.duringOutage.served === 3,
  'Trending went blank instead of degrading to uncollapsed rows');
check('…but that pool is NOT pinned as fresh', real.duringOutage.pinned === false,
  'the freshness clock was set on a pool carrying no cluster unions — the mismatch is now held for POOL_TTL_MS');
// Three reads, and the count is the point: the direct call in A, the pool build in B (which retried
// because A's failure was not memoised), and the rebuild in C. A memoised failure collapses this to 1.
check('EVERY call after a failure re-reads loc_city_cluster', real.afterRecovery.clusterReads === 3,
  `${real.afterRecovery.clusterReads} read(s), expected 3 — at 1, one transient blip has disabled cluster collapse for the entire page session`);
check('the recovered pool carries the cluster UNION, so shown == clicked',
  real.afterRecovery.ahsaCount === 4953 && real.afterRecovery.ahsaKey === 'al_ahsa',
  `الاحساء=${real.afterRecovery.ahsaCount} key=${real.afterRecovery.ahsaKey}`);
check('a pool that really carries its unions IS pinned', real.afterRecovery.pinned === true);
check('a healthy pool inside POOL_TTL_MS does not refetch', real.cachedCallRpcs === 0,
  'the cache stopped working — every focus now costs an RPC');
check('POOL_TTL_MS is REAL for city Trending: a lapsed clock refetches', real.staleCallRpcs === 1,
  'the settled promise was returned instead — city counts can never refresh for the life of the tab');
check('a healthy district pool inside POOL_TTL_MS does not refetch', real.districtCachedRpcs === 0);
check('POOL_TTL_MS is REAL for district Trending: a lapsed clock refetches', real.districtStaleRpcs === 1,
  'the settled promise was returned instead — district counts can never refresh for the life of the tab');

// ── mutation proofs: rebuild each defect out of the REAL source and watch this barrier fail ───────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const mutate = (...edits: [RegExp, string][]) => {
  let mutant = realSrc;
  for (const [find, replace] of edits) {
    const next = mutant.replace(find, replace);
    if (next === mutant) throw new Error(`mutation did not apply: ${find} — this proof is no longer testing anything`);
    mutant = next;
  }
  return mutant;
};

// M1 — DEFECT A exactly as it shipped: memoise whatever the read produced, failure included.
mustCatch('a failed cluster read memoised as an empty map (ops_incident #268)',
  !holds(await probe(await load(mutate([/^    if \(read\) _clusterMap = m;$/m, '    _clusterMap = m;'])))));

// M2 — the half-fix: notice the failure but leave the dead promise parked, so nothing retries.
mustCatch('a cluster failure that is never retried (dead _clusterPromise kept)',
  !holds(await probe(await load(mutate([/^    _clusterPromise = null;$/m, '    /* not reset */;'])))));

// M3 — the `?? []` that hid the error in the first place: a null `data` read as zero rows.
mustCatch('a null data response read as a genuine empty cluster table',
  !holds(await probe(await load(mutate([
    /^        if \(error \|\| !data\) throw new Error\(.*\n/m, '',
  ], [/^        for \(const r of \(data as any\[\]\)\)/m, '        for (const r of ((data as any[]) ?? []))'])))));

// M4 — DEFECT B, city half: keep the settled promise, and POOL_TTL_MS goes inert again.
mustCatch('a settled city pool promise left in the dedupe map (POOL_TTL_MS inert)',
  !holds(await probe(await load(mutate([/^        _cityFieldPromises\.delete\(key\);$/m, '        /* kept */;'])))));

// M5 — DEFECT B, district half: the same, for district Trending.
mustCatch('a settled district pool promise left in the dedupe map (POOL_TTL_MS inert)',
  !holds(await probe(await load(mutate([/^        _districtPromises\.delete\(key\);$/m, '        /* kept */;'])))));

// M6 — pinning an unclustered pool as fresh: the count→click mismatch is then held for the full TTL.
mustCatch('a cluster-less pool pinned as fresh',
  !holds(await probe(await load(mutate([
    /^        if \(clusterMapLoaded\(\)\) _cityPoolFetchedAt\.set\(key, Date\.now\(\)\);$/m,
    '        _cityPoolFetchedAt.set(key, Date.now());',
  ])))));

// M7 — the opposite direction: never memoising a SUCCESS would re-read the cluster table forever.
mustCatch('a successful cluster read that is not recorded (re-read on every call)',
  !holds(await probe(await load(mutate([/^    if \(read\) _clusterMap = m;$/m, '    if (false) _clusterMap = m;'])))));

if (failures || mutFail) {
  console.error(`\n❌ ${failures} assertion failure(s), ${mutFail} blind mutation(s)`);
  process.exit(1);
}
console.log('\n✅ Trending caches recover: a failed read stays UNKNOWN and is retried; a settled one expires on time');
