// THE CITY POOL LOAD NEVER STICKS — executed, not read (owner 2026-11-08).
//
// THE DEFECT. The owner opened the map, came back to Filter, tapped the city box: «الأكثر رواجًا الآن» showed the six
// built-in names with «…» and never a number, for the life of the tab. ensureCityFieldIndex() caches its in-flight
// promise per scope, and its 15 s timer only reaches the fetch. Two awaits sat outside it: the loc_city_cluster read
// (no timeout at all) and anything before the fetch starts. A stall there left the promise pending forever, every
// later focus re-awaited it, no request was ever sent again.
//
// THE FIX (owner: «make sure it never happens no matter what u click»). The cluster read carries an 8 s abort, and
// every attempt of the city AND district pool load races a deadline (retryStuck): a stuck attempt is abandoned and a
// fresh one starts BY ITSELF, so the open box gets real numbers with no tap. This RUNS the real ensureCityFieldIndex,
// ensureDistrictOptions, ensureClusterMap and retryStuck (lifted from src/data/locations.ts) against a client that
// stalls, and proves each mutant is caught.
//
//   node --experimental-strip-types scripts/verify-city-pool-load-never-sticks.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/data/locations.ts');

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}`);
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

// Inert stand-ins for what the lifted functions close over. The client is the injected failure.
const PRELUDE = `
type CityOption = any; type Deal = any; type Category = any; type AfParams = any; type PoolStatus = any;
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
const reportError = (_e: unknown, _c?: unknown, _o?: unknown) => {}; // src/lib/observability stub: the give-up report is pinned by verify-location-pool-failures-are-reported.ts
const CITY_FIELD_POOLS = new Map<string, any>();
const _cityFieldPromises = new Map<string, any>();
const _cityPoolFetchedAt = new Map<string, number>();
const _cityPoolStatus = new Map<string, any>();
const POOL_TTL_MS = 1800000;
const CITY_POOL_DEADLINE_MS = 200;
let _clusterMap: any = null;
let _clusterPromise: any = null;
const clusterMapLoaded = () => _clusterMap !== null;
const cityPoolKey = (...a: any[]) => JSON.stringify(a);
const dealAr = (d: any) => d;
const TABLE_SCOPE_KEYS: string[] = [];
const tableScopeOf = () => ({});
const applyClusterUnion = (o: any) => o;
const statusOf = (k: string) => _cityPoolStatus.get(k);
const _districtCache = new Map<string, any>();
const _districtFetchedAt = new Map<string, number>();
const _districtPromises = new Map<string, any>();
const _districtPoolStatus = new Map<string, any>();
const districtCacheKey = (...a: any[]) => JSON.stringify(a);
type DistrictOption = any;
`;
const SYMBOLS = [
  { header: 'export async function ensureClusterMap(', endsWith: /^\}$/ },
  { header: 'export async function ensureCityFieldIndex(', endsWith: /^\}$/ },
  { header: 'export function retryStuck<T>(', endsWith: /^\}$/ },
  { header: 'export async function ensureDistrictOptions(', endsWith: /^\}$/ },
];

async function lift(src: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-citypool-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, src);
  return liftSymbols(file, SYMBOLS, ['ensureCityFieldIndex', 'ensureDistrictOptions', 'setClient', 'statusOf'], PRELUDE) as Promise<any>;
}

// A thenable query that never settles unless its abort signal fires (then resolves { data:null, error }).
function stalled(onCall: () => void, honourAbort: boolean) {
  onCall();
  let signal: AbortSignal | null = null;
  const q: any = {
    abortSignal(s: AbortSignal) { signal = s; return q; },
    then(res: any) {
      if (honourAbort && signal) signal.addEventListener('abort', () => res({ data: null, error: { message: 'aborted' } }));
    },
  };
  return q;
}
const settlesWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

// The RPC stalls (ignoring its abort — a stall before the fetch) on the first `stallFirst` calls, then answers.
const CITY_ROWS = [{ city_id: 1, city_ar: 'الرياض', listing_count: 5, total_in_cohort: 5 }];
const DIST_ROWS = [{ district_ar: 'الملقا', listing_count: 3, match_values: ['الملقا'], total_in_city: 3 }];
function flaky(stallFirst: number, log: { calls: number }) {
  return {
    rpc: (name: string) => {
      log.calls++;
      if (log.calls <= stallFirst) return stalled(() => {}, false);
      const rows = name === 'top_cities_by_deal_ar' ? CITY_ROWS : DIST_ROWS;
      return { abortSignal() { return Promise.resolve({ data: rows, error: null }); } };
    },
    from: () => ({ select: () => Object.assign(Promise.resolve({ data: [], error: null }), { abortSignal() { return this; } }) }),
  };
}

// A: ONE call from the user; the first attempt sticks. The real rows must still arrive, by an automatic retry.
async function scenarioA(src: string): Promise<boolean> {
  const m = await lift(src);
  const log = { calls: 0 };
  m.setClient(flaky(1, log));
  const r = m.ensureCityFieldIndex('Buy').then((v: any[]) => v);
  const ok = await settlesWithin(r, 1500);
  return ok && (await r).length === 1 && log.calls === 2;
}
// A2: the same for the district list.
async function scenarioA2(src: string): Promise<boolean> {
  const m = await lift(src);
  const log = { calls: 0 };
  m.setClient(flaky(1, log));
  const r = m.ensureDistrictOptions(1, 'Buy', null).then((v: any[]) => v);
  const ok = await settlesWithin(r, 1500);
  return ok && (await r).length === 1;
}
// C: the network never answers at all. The load must still END (never a forever-wait) and the next focus refetches.
async function scenarioC(src: string): Promise<boolean> {
  const m = await lift(src);
  const log = { calls: 0 };
  m.setClient(flaky(1e9, log));
  const ended = await settlesWithin(m.ensureCityFieldIndex('Buy'), 2500);
  const before = log.calls;
  void m.ensureCityFieldIndex('Buy');
  return ended && log.calls === before + 1;
}
// B: the RPC answers; the cluster read stalls but honours its abort. Must settle with the real rows.
async function scenarioB(src: string): Promise<boolean> {
  const m = await lift(src);
  m.setClient({
    rpc: () => ({ abortSignal() { return Promise.resolve({ data: CITY_ROWS, error: null }); } }),
    from: () => ({ select: () => stalled(() => {}, true) }),
  });
  return settlesWithin(m.ensureCityFieldIndex('Buy'), 9500);
}

const real = readFileSync(SRC, 'utf8');
check('one tap, first load stuck → the city numbers still arrive by themselves', await scenarioA(real));
check('one tap, first load stuck → the district numbers still arrive by themselves', await scenarioA2(real));
check('network never answers → the load still ends and the next focus refetches', await scenarioC(real));
check('a stalled loc_city_cluster read cannot hold the city pool forever', await scenarioB(real));

// MUTANTS: undo each part of the fix and watch the check go red.
const noRetry = real.replace('if (left > 1) go(left - 1);', 'if (false) go(left - 1);');
mustCatch('no automatic retry (the user must tap again)', noRetry !== real && !(await scenarioA(noRetry)));
const noDeadline = real.replace(/      t = setTimeout\(\(\) => \{\n        if \(left > 1\)[\s\S]*?CITY_POOL_DEADLINE_MS\);\n/, '');
mustCatch('no deadline at all (the stuck promise stays cached forever)', noDeadline !== real && !(await scenarioC(noDeadline)));
const noDistrict = real.replace("const p: Promise<DistrictOption[]> = retryStuck(attempt, () => {", "const p: Promise<DistrictOption[]> = attempt(); (() => {");
mustCatch('the district list without the guard', noDistrict !== real && !(await scenarioA2(noDistrict)));
const noBoth = noDeadline.replace(".select('city_id,cluster_key').abortSignal(ac.signal)", ".select('city_id,cluster_key')");
mustCatch('no deadline and an unbounded cluster read', noBoth !== noDeadline && !(await scenarioB(noBoth)));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nverify-city-pool-load-never-sticks: all checks passed');
process.exit(0);
