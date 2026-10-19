// A WIDENING FALLBACK MAY DROP A PREDICATE. IT MAY NEVER DROP THE TABLE SCOPE — executed, not read.
//
// THE DEFECT (found 2026-09-21 by routine-8, ops_incident hunter-2026-09-21:incomplete_fix:
// city-pool-last-resort-drops-table-scope). Both Trending count pools in src/data/locations.ts call
// their RPC through a ladder of compat fallbacks: if the scoped call errors, retry with less. The
// DISTRICT ladder's last rung carries `...(scope ?? {})` and its comment states the rule —
//
//     "it drops the PERIOD, never the table scope. A widened period still describes a set the
//      search can deliver; a widened TABLE set does not … (Mirrors the city pool's rule that no
//      count beats a wrong one.)"
//
// — but the CITY pool had no such rule to mirror. Its last rung sent `{ p_deal: dealAr(deal) }`
// alone, dropping p_tables/p_tables2/p_types2. That is the 2026-09-03 الهفوف class verbatim
// (top_cities_by_deal_ar called with NO p_tables while the results RPC is called WITH it, which
// advertised 2,478 where search delivered 109), reintroduced inside an error path.
//
// WHY `!hasNarrowing` DID NOT PROTECT IT. That gate asks "did the user choose a predicate?" and, by
// construction, discounts the scope keys — correctly, since counting them would pin the gate true
// and disable every compat fallback. But p_category and p_types are not in `af` either
// (rpcAllNarrowingParams strips p_types; p_category belongs to resolveSearchScope), so the gate is
// FALSE for a user who picked a category and a property type and nothing else — precisely when the
// last rung fires. Measured on production 2026-09-21, the two calls that rung chooses between:
//     scoped (Rent / annual / Residential / شقة) → 25,581 listings across 107 cities
//     deal-only                                  → 82,704 listings across 204 cities
// a 3.2x over-promise across 97 cities that hold no matching apartment at all.
//
// WHY THIS BARRIER IS SHAPED LIKE THIS. The ladder was already covered by TWO barriers —
// verify-trending-carries-full-filter-state.ts and verify-af-city-counts-carry-advanced.ts — and
// both are source-TEXT tripwires that assert the `!hasNarrowing` gate EXISTS and that each rung
// carries it. Both passed for every day the defect was live, because the text they pin is the text
// that produces the gap. (Those two are #10's to repair; this one is the executing replacement for
// the invariant itself.) So this check LIFTS the real ensureCityFieldIndex and ensureDistrictOptions
// out of locations.ts — never a hand-copied duplicate, [[feedback_never-test-a-copy-of-production-code]]
// — RUNS them against a client whose every call RESOLVES { data: null, error } the way supabase-js
// really does, and asserts on the arguments each rung actually sent.
//
//   node --experimental-strip-types scripts/verify-count-pool-fallbacks-keep-the-table-scope.ts
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

// STAND-INS, all inert: the caches, keys and cluster helpers the two pools close over, reduced to
// fixed values. POOL_TTL_MS = 0 and a unique key per call together guarantee every probe walks the
// real ladder instead of being served a cached pool. None of them carries any logic under test —
// the ladders, TABLE_SCOPE_KEYS and tableScopeOf are all REAL lifted source.
const PRELUDE = `
type Deal = any; type Category = any; type CityOption = any; type DistrictOption = any;
type AfParams = Record<string, unknown>;
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
const POOL_TTL_MS = 0;
let _n = 0;
const cityPoolKey = (..._a: any[]) => 'city:' + (++_n);
const districtCacheKey = (..._a: any[]) => 'dist:' + (++_n);
const CITY_FIELD_POOLS = new Map<string, any>();
const _cityPoolFetchedAt = new Map<string, number>();
const _cityFieldPromises = new Map<string, any>();
const _cityPoolStatus = new Map<string, string>();
const _districtCache = new Map<string, any>();
const _districtFetchedAt = new Map<string, number>();
const _districtPromises = new Map<string, any>();
const _districtPoolStatus = new Map<string, string>();
const dealAr = (d: any) => (d === 'Rent' ? 'إيجار' : 'بيع');
const applyClusterUnion = (o: any) => o;
const ensureClusterMap = async () => new Map();
const clusterMapLoaded = () => true;
`;

type Rung = { fn: string; args: Record<string, unknown> };
type Lifted = {
  TABLE_SCOPE_KEYS: string[];
  tableScopeOf: (af: Record<string, unknown> | null) => Record<string, unknown>;
  ensureCityFieldIndex: (...a: unknown[]) => Promise<unknown>;
  ensureDistrictOptions: (...a: unknown[]) => Promise<unknown>;
  setClient: (c: unknown) => void;
};

/** Lift the REAL declarations out of a copy of locations.ts (the real file, or a mutant of it). */
async function load(source: string): Promise<Lifted> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-poolscope-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, source);
  return await liftSymbols(file, [
    { header: 'export const TABLE_SCOPE_KEYS = ', endsWith: /;$/ },
    { header: 'export function tableScopeOf(', endsWith: /^\}$/ },
    { header: 'export async function ensureCityFieldIndex(', endsWith: /^\}$/ },
    { header: 'export async function ensureDistrictOptions(', endsWith: /^\}$/ },
  ], ['TABLE_SCOPE_KEYS', 'tableScopeOf', 'ensureCityFieldIndex', 'ensureDistrictOptions', 'setClient'],
    PRELUDE) as unknown as Lifted;
}

// What supabase-js actually hands back: a failed RPC NEVER throws, it RESOLVES { data: null, error }.
// Every call fails, so the ladder walks to its last rung and every rung is captured.
const capturing = (calls: Rung[]) => ({
  rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args: { ...args } });
    const request = () => Promise.resolve({ data: null, error: { message: 'injected: every rung fails' } });
    return {
      abortSignal: () => request(),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => request().then(res, rej),
    };
  },
});

// A scope object shaped exactly as index.tsx builds it: searchTableScope(query) minus the local
// isBroadCommercial flag. Scope keys ONLY, so `hasNarrowing` is false and every compat rung is
// reachable — the state the defect lived in.
const SCOPE = { p_tables: ['aqar_residential_listings', 'wasalt_residential_listings'], p_tables2: null, p_types2: null };
const RENT = 'إيجار';

async function probe(mod: Lifted): Promise<{ city: Rung[]; district: Rung[] }> {
  const city: Rung[] = [];
  mod.setClient(capturing(city));
  await mod.ensureCityFieldIndex('Rent', 'سنوي', 'Residential', ['شقة'], { ...SCOPE });

  const district: Rung[] = [];
  mod.setClient(capturing(district));
  await mod.ensureDistrictOptions(1, 'Rent', 'Residential', 'سنوي', ['شقة'], { ...SCOPE });
  return { city, district };
}

/**
 * THE INVARIANT. Rung 1 is the scoped call the results RPC agrees with; every later rung is a
 * widening retry. A later rung may drop a PREDICATE (period, types, category) — it may never change
 * a TABLE-SCOPE key, because that key is the frame the count is taken in, not something the user
 * chose. Absent and null compare equal: every one of these RPC args defaults to NULL, so omitting a
 * key that was already null is not a change. Dropping a populated p_tables is.
 */
export function scopeDropProblems(rungs: Rung[], keys: string[], label: string): string[] {
  const out: string[] = [];
  if (rungs.length < 2) {
    return [`${label}: only ${rungs.length} rung(s) captured — the fallback ladder never ran, so nothing was proven`];
  }
  const first = rungs[0].args;
  for (let i = 1; i < rungs.length; i++) {
    for (const k of keys) {
      const was = JSON.stringify(first[k] ?? null);
      const now = JSON.stringify(rungs[i].args[k] ?? null);
      if (was !== now) out.push(`${label}: rung ${i + 1} of ${rungs.length} changed ${k}: ${was} -> ${now}`);
    }
  }
  return out;
}

const real = await load(readFileSync(SRC, 'utf8'));
const { city, district } = await probe(real);

// The ladders must actually have run to their last rung. Without this, deleting a rung would make
// every assertion below vacuously true — the "an empty run set is itself a failure" discipline.
check('the city ladder walked all four rungs (scoped -> noTypes -> noCat -> last-resort)',
  city.length === 4, `captured ${city.length}: ${city.map((c) => JSON.stringify(c.args)).join(' | ')}`);
check('the district ladder walked all three rungs (scoped -> noTypes -> last-resort)',
  district.length === 3, `captured ${district.length}`);
check('every captured city rung really is top_cities_by_deal_ar',
  city.every((c) => c.fn === 'top_cities_by_deal_ar'), city.map((c) => c.fn).join(','));
check('every captured district rung really is district_options_ar',
  district.every((d) => d.fn === 'district_options_ar'), district.map((d) => d.fn).join(','));

// The scope really was on rung 1 — otherwise "unchanged across rungs" would be a statement about
// nothing at all.
check('rung 1 of the city ladder carries the populated table scope',
  JSON.stringify(city[0]?.args.p_tables ?? null) === JSON.stringify(SCOPE.p_tables));
check('rung 1 of the district ladder carries the populated table scope',
  JSON.stringify(district[0]?.args.p_tables ?? null) === JSON.stringify(SCOPE.p_tables));

check('NO city rung drops or rewrites a table-scope key',
  scopeDropProblems(city, real.TABLE_SCOPE_KEYS, 'city').length === 0,
  scopeDropProblems(city, real.TABLE_SCOPE_KEYS, 'city').join('\n      '));
check('NO district rung drops or rewrites a table-scope key',
  scopeDropProblems(district, real.TABLE_SCOPE_KEYS, 'district').length === 0,
  scopeDropProblems(district, real.TABLE_SCOPE_KEYS, 'district').join('\n      '));

// The widening the ladder IS allowed to do still happens — this barrier must not be satisfiable by
// freezing the ladder, which would trade a wrong count for a blank field.
check('the city last-resort rung still drops the period (the widening it exists to perform)',
  city.length === 4 && (city[3].args.p_rent_period ?? null) === null && city[0].args.p_rent_period === 'سنوي');
check('the city last-resort rung still sends the deal',
  city.length === 4 && city[3].args.p_deal === RENT);

// ── MUTATION PROOFS: re-introduce each defect in the real source, watch this barrier catch it. ──
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  mutation caught: ${label}`); return; }
  failures++;
  console.error(`FAIL  mutation NOT caught: ${label}`);
};

async function caughtAfter(find: string, replace: string): Promise<boolean> {
  const src = readFileSync(SRC, 'utf8');
  if (!src.includes(find)) {
    failures++;
    console.error(`FAIL  mutation target missing from source (barrier is stale): ${find.slice(0, 70)}`);
    return false;
  }
  const mod = await load(src.replace(find, replace));
  const { city: c, district: d } = await probe(mod);
  return scopeDropProblems(c, mod.TABLE_SCOPE_KEYS, 'city').length > 0
    || scopeDropProblems(d, mod.TABLE_SCOPE_KEYS, 'district').length > 0;
}

mustCatch('the city last-resort rung reverted to the deal-only call (THE defect, 2026-09-21)',
  await caughtAfter("{ p_deal: dealAr(deal), ...tableScopeOf(af) }", "{ p_deal: dealAr(deal) }"));

mustCatch('the district last-resort rung stops carrying its scope (the same class, other pool)',
  await caughtAfter("p_category: category, ...(scope ?? {}) }", "p_category: category }"));

mustCatch('tableScopeOf() neutered to return nothing — the helper proven load-bearing, not decorative',
  await caughtAfter('for (const k of TABLE_SCOPE_KEYS) if (af && k in af) out[k] = (af as any)[k];', ''));

mustCatch('a rung that keeps the key but rewrites it to a WIDER table set',
  await caughtAfter("{ p_deal: dealAr(deal), ...tableScopeOf(af) }",
    "{ p_deal: dealAr(deal), p_tables: ['aqar_residential_listings'] }"));

console.log(failures === 0
  ? '\nOK  every count-pool fallback rung keeps the frame its first rung was taken in.'
  : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
