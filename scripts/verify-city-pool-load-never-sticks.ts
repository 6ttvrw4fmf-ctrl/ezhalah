// THE CITY POOL LOAD NEVER STICKS — executed, not read (owner 2026-11-08).
//
// THE DEFECT. The owner opened the map, came back to Filter, tapped the city box: «الأكثر رواجًا الآن» showed the six
// built-in names with «…» and never a number, for the life of the tab. ensureCityFieldIndex() caches its in-flight
// promise per scope, and its 15 s timer only reaches the fetch. Two awaits sat outside it: the loc_city_cluster read
// (no timeout at all) and anything before the fetch starts. A stall there left the promise pending forever, every
// later focus re-awaited it, no request was ever sent again.
//
// THE FIX. The cluster read carries an 8 s abort, and the whole load races a hard deadline that evicts the stuck
// promise so the next focus starts fresh. This RUNS the real ensureCityFieldIndex + ensureClusterMap (lifted from
// src/data/locations.ts) against a client that never answers, and proves both mutants are caught.
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
`;
const SYMBOLS = [
  { header: 'export async function ensureClusterMap(', endsWith: /^\}$/ },
  { header: 'export async function ensureCityFieldIndex(', endsWith: /^\}$/ },
];

async function lift(src: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-citypool-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, src);
  return liftSymbols(file, SYMBOLS, ['ensureCityFieldIndex', 'setClient', 'statusOf'], PRELUDE) as Promise<any>;
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

// Scenario A: the RPC never answers and ignores its abort (a stall before the fetch). Must settle, then refetch.
async function scenarioA(src: string): Promise<boolean> {
  const m = await lift(src);
  let calls = 0;
  m.setClient({ rpc: () => stalled(() => calls++, false), from: () => ({ select: () => stalled(() => {}, false) }) });
  const first = await settlesWithin(m.ensureCityFieldIndex('Buy'), 1500);
  void m.ensureCityFieldIndex('Buy');
  return first && calls === 2;
}
// Scenario B: the RPC answers; the cluster read stalls but honours its abort. Must settle (via the 8 s bound or the
// deadline) and hand back the real rows, never hang.
async function scenarioB(src: string): Promise<boolean> {
  const m = await lift(src);
  const rows = [{ city_id: 1, city_ar: 'الرياض', listing_count: 5, total_in_cohort: 5 }];
  m.setClient({
    rpc: () => ({ abortSignal() { return Promise.resolve({ data: rows, error: null }); } }),
    from: () => ({ select: () => stalled(() => {}, true) }),
  });
  return settlesWithin(m.ensureCityFieldIndex('Buy'), 9500);
}

const real = readFileSync(SRC, 'utf8');
check('a load that never settles is dropped at the deadline and the next focus refetches', await scenarioA(real));
check('a stalled loc_city_cluster read cannot hold the city pool forever', await scenarioB(real));

// MUTANTS: undo each half of the fix and watch the check go red.
const noDeadline = real.replace(/const p: Promise<CityOption\[\]> = Promise\.race\(\[\n    load,[\s\S]*?\n  \]\);/, 'const p: Promise<CityOption[]> = load;');
mustCatch('no hard deadline (the stuck promise stays cached)', noDeadline !== real && !(await scenarioA(noDeadline)));
const noBoth = noDeadline.replace(".select('city_id,cluster_key').abortSignal(ac.signal)", ".select('city_id,cluster_key')");
mustCatch('no deadline and an unbounded cluster read', noBoth !== noDeadline && !(await scenarioB(noBoth)));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nverify-city-pool-load-never-sticks: all checks passed');
process.exit(0);
