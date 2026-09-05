// A FAILED SCOPE RESOLUTION IS NOT AN HONEST ZERO — executed, not read.
//
// THE DEFECT (P2, ops_incident hunt-2026-09-04:search:15). `resolveSearchScope()` in
// src/data/remote.ts returned the SAME `null` for two facts that are not the same fact:
//   * "this location genuinely resolves to nothing"  → the honest-zero screen, «try broadening»
//   * "resolve_district_cities failed"               → also the honest-zero screen
// The line even named the distinction — «RPC failure ≠ genuine zero matches» — and then discarded it,
// because `fetchListingsForQuery` maps a null scope to `listings: []`, i.e. a truthful-looking verdict
// about the user's search. And that RPC was the one data-layer call issued with NO timeout, so a
// stalled response left the search loader spinning forever instead of failing.
//
// THE FIX, in the file's own idioms: PROBE_FAILED (src/lib/afProbe.ts — «couldn't determine because
// the backend failed» ≠ «the source answered: nothing», already used by the AF count probes) plus
// bounded() (the timeout wrapper every other call in remote.ts already had). The caller then returns
// `listings: null`, which is the retryable-error posture it already uses for every backend failure.
//
// WHY THIS BARRIER EXISTS IN THIS FORM. The scope contract was previously guarded only by source-text
// tripwires, which read the null-returning line and its comment and passed every day the defect was
// live. This one RUNS the real `resolveSearchScope()` AND the real `fetchListingsForQuery()` — both
// lifted verbatim out of remote.ts, never re-typed ([[feedback_never-test-a-copy-of-production-code]])
// — against an injected failing/stalling RPC client, and asserts on what they return.
//
//   node --experimental-strip-types scripts/verify-scope-failure-is-not-an-honest-zero.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { isProbeFailure } from '../src/lib/afProbe.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/data/remote.ts');

// Read by the REAL `const RPC_TIMEOUT_MS` line as it is lifted, so the stall test does not sit here
// for the production 15s. Set before any lift.
process.env.EXPO_PUBLIC_RPC_TIMEOUT_MS = '300';
const STALL_BUDGET_MS = 2000;   // generous: a bounded call must settle FAR inside this (300ms)

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// STAND-INS, all inert. The client is the failure being injected; the rest are the location/table
// helpers the lifted functions close over, reduced to fixed values so the district-resolution branch
// under test is reached deterministically. None of them carries any of the logic being asserted:
// resolveSearchScope's district branch, its return values, bounded(), and fetchListingsForQuery's
// scope dispatch are all the REAL lifted source. PROBE_FAILED is imported real, so sentinel IDENTITY
// (not a look-alike object) is what gets compared.
const PRELUDE = `
import { PROBE_FAILED, isProbeFailure } from '${join(ROOT, 'src/lib/afProbe.ts')}';
type SearchQuery = any; type SearchScope = any; type Listing = any;
type FetchListingsResult = any; type SourceKind = any; type Macro = any;
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
const TABLE_SCOPE = { p_tables: ['aqar_residential_listings'], p_tables2: null, p_types2: null, isBroadCommercial: false };
const searchTableScope = (q: any) => (q.__noTables ? null : TABLE_SCOPE);
const arCity = (c: any) => c;
const cityFilterFor = (_l: any) => null;
const isCountryWideQuery = (_q: any) => false;
const rentPeriodParam = (_q: any) => null;
const REGION_TO_ID: any = {};
const regionIdsFor = (_lm: any) => null;
const impliedCategory = (_q: any) => 'Residential';
const QUERY_LIMIT = 100;
`;

type Lifted = {
  resolveSearchScope: (q: unknown) => Promise<unknown>;
  fetchListingsForQuery: (q: unknown, o?: unknown) => Promise<{ listings: unknown[] | null }>;
  setClient: (c: unknown) => void;
};

/** Lift the REAL declarations out of a copy of remote.ts (the real file, or a mutant of it). */
async function load(source: string): Promise<Lifted> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-scope-'));
  const file = join(dir, 'remote.ts');
  writeFileSync(file, source);
  return await liftSymbols(file, [
    { header: 'function dedupeInFlight<T>', endsWith: /^\}$/ },
    { header: 'const inFlightDistrictCities = ', endsWith: /;$/ },
    { header: 'const RPC_TIMEOUT_MS = ', endsWith: /;$/ },
    { header: 'async function bounded', endsWith: /^\}$/ },
    { header: 'export async function resolveSearchScope(', endsWith: /^\}$/ },
    { header: 'export async function fetchListingsForQuery(', endsWith: /^\}$/ },
  ], ['resolveSearchScope', 'fetchListingsForQuery', 'setClient'], PRELUDE) as unknown as Lifted;
}

// A district with no city named alongside it — the exact input that routes through
// resolve_district_cities. Distinct district names per scenario so the in-flight de-dup cache
// (keyed on the district list) never serves one scenario's answer to another.
const q = (districts: string[], extra: Record<string, unknown> = {}) =>
  ({ deal: 'Rent', category: 'Residential', location: '', districts, ...extra });

// What supabase-js actually hands back. It NEVER throws: a failed RPC RESOLVES with data null + error.
// The builder is a THENABLE (awaiting it fires the request) that also carries .abortSignal() — the
// shape that makes the timeout half testable: a bare `await builder` gets no signal and, when the
// backend stalls, never settles; only the .abortSignal() route bounded() takes can end it.
const client = (mode: 'error' | 'stall' | 'rows' | 'empty') => ({
  rpc: () => {
    const request = (signal?: AbortSignal) => {
      if (mode === 'error') return Promise.resolve({ data: null, error: { message: '500 upstream' } });
      if (mode === 'rows') return Promise.resolve({ data: [{ city_ar: 'الرياض', match_count: 900 }], error: null });
      if (mode === 'empty') return Promise.resolve({ data: [], error: null });
      // stall: settles ONLY if something aborts it — which is precisely what bounded() must do.
      return new Promise<never>((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    };
    return {
      abortSignal: (signal: AbortSignal) => request(signal),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => request().then(res, rej),
    };
  },
});

const HUNG = Symbol('hung');
const within = async <T>(p: Promise<T>, ms: number): Promise<T | typeof HUNG> => {
  let t: NodeJS.Timeout;
  const out = await Promise.race([p, new Promise<typeof HUNG>((r) => { t = setTimeout(() => r(HUNG), ms); })]);
  clearTimeout(t!);
  return out;
};

/** The invariants, as one runnable predicate — reused verbatim against every mutant below. */
async function probe(mod: Lifted) {
  mod.setClient(client('error'));
  const onError = await mod.resolveSearchScope(q(['العليا']));
  const fetchOnError = await mod.fetchListingsForQuery(q(['الملز']));

  mod.setClient(client('rows'));
  const onRows = await mod.resolveSearchScope(q(['النرجس'])) as { p_cities: string[] } | null;

  mod.setClient(client('empty'));
  const onEmpty = await mod.resolveSearchScope(q(['حي لا يوجد']));

  mod.setClient(client('error'));
  const unresolvable = await mod.fetchListingsForQuery(q([], { __noTables: true, location: 'nowhere' }));

  mod.setClient(client('stall'));
  const onStall = await within(mod.resolveSearchScope(q(['حي معلق'])), STALL_BUDGET_MS);

  return {
    errorIsSentinel: isProbeFailure(onError),
    errorIsNull: onError === null,
    fetchOnErrorIsRetryable: fetchOnError.listings === null,
    rowsResolveCity: !!onRows && !isProbeFailure(onRows) && JSON.stringify(onRows.p_cities) === JSON.stringify(['الرياض']),
    emptyRowsStillAScope: !!onEmpty && !isProbeFailure(onEmpty),
    unresolvableIsHonestZero: Array.isArray(unresolvable.listings) && unresolvable.listings.length === 0,
    stallSettled: onStall !== HUNG,
    stallIsFailure: onStall !== HUNG && isProbeFailure(onStall),
  };
}

const holds = (r: Awaited<ReturnType<typeof probe>>) =>
  r.errorIsSentinel && !r.errorIsNull && r.fetchOnErrorIsRetryable && r.rowsResolveCity
  && r.emptyRowsStillAScope && r.unresolvableIsHonestZero && r.stallSettled && r.stallIsFailure;

console.log('\nA backend failure must never be rendered as "there are no listings in this location"\n');

const realSrc = readFileSync(SRC, 'utf8');
const real = await probe(await load(realSrc));

check('a failed resolve_district_cities returns the PROBE_FAILED sentinel, not null',
  real.errorIsSentinel && !real.errorIsNull,
  'the failure is indistinguishable from an unresolvable location — every caller renders it as 0 results');
check('the search itself then takes the RETRYABLE-error path (listings: null), not the empty-result path',
  real.fetchOnErrorIsRetryable,
  'fetchListingsForQuery returned [] on a backend failure: the honest-zero screen with «broaden your search» advice');
check('an unresolvable location still returns the honest zero (listings: [])',
  real.unresolvableIsHonestZero,
  'the genuine-zero path changed — this fix is failure-path only');
check('a SUCCESSFUL district resolution still scopes to its city (success path unchanged)',
  real.rowsResolveCity);
check('a district that matches NOWHERE is still a scope, not a failure (zero rows ≠ error)',
  real.emptyRowsStillAScope,
  'an honest empty answer was promoted to a failure — that is the same bug pointing the other way');
check('a stalled resolve_district_cities settles instead of wedging the loader forever',
  real.stallSettled, `still pending after ${STALL_BUDGET_MS}ms — the call is unbounded again`);
check('and that stall is reported as a failure, not as a scope or a zero', real.stallIsFailure);

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

// A mutant that throws is also a mutant this barrier refuses — but the interesting ones below all
// return a wrong value rather than crashing, which is what the defect actually did.
const survives = async (mutant: string) => {
  try { return holds(await probe(await load(mutant))); } catch { return false; }
};

// M1 — the defect verbatim: the failure branch returns the honest-zero value again.
mustCatch('an RPC failure collapsed back into the honest-zero null',
  !await survives(mutate([/if \(districtCitiesError\) return PROBE_FAILED;/, 'if (districtCitiesError) return null;'])));

// M2 — the caller half: the sentinel is produced, and the caller renders it as an empty result set
// anyway. A distinction that reaches no call site is not a distinction.
mustCatch('a caller that renders the failure sentinel as an empty result set',
  !await survives(mutate([
    /^  if \(isProbeFailure\(scope\)\) return \{ listings: null, pageCandidates, pageTotal \};$/m,
    '  if (isProbeFailure(scope)) return { listings: [], pageCandidates, pageTotal };',
  ])));

// M3 — the timeout half: the RPC issued bare again, exactly as it was.
mustCatch('the district RPC issued with no timeout (a stall wedges the search loader)',
  !await survives(mutate([
    /const r = await bounded\(supabase!\.rpc\('resolve_district_cities', \{ p_districts: q\.districts \}\)\);/,
    "const r = await supabase!.rpc('resolve_district_cities', { p_districts: q.districts });",
  ])));

if (failures || mutFail) {
  console.error(`\n❌ ${failures} assertion failure(s), ${mutFail} blind mutation(s)`);
  process.exit(1);
}
console.log('\n✅ backend failure, stall, honest zero and success are four distinguishable outcomes');
