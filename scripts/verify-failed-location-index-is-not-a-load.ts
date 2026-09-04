// A FAILED LOCATION-INDEX FETCH IS NOT A LOAD — executed, not read.
//
// THE DEFECT (P1, ops_incident hunt-2026-09-04:search:14). `ensureLocationIndex()` in
// src/data/locations.ts loads the live district/city index ONCE per page session. Its success line,
// `_liveLoaded = true;`, sat OUTSIDE the `if (data)` block, and supabase-js NEVER throws on a failed
// request (`shouldThrowOnError` is false; the promise is caught internally) — a 500/offline/aborted
// GET simply resolves `{ data: null, error }`. So a FAILURE ran the success line, the `catch` whose
// own comment exists so a failed load can retry was unreachable for that call, and the live index
// stayed empty for the entire session with no retry. Downstream, a region search over an empty
// LIVE_CITIES resolves to no cities and the user is told "there are no listings in this location"
// for a region holding 32,203 of them. Our outage, rendered as their honest zero.
//
// WHY THIS BARRIER EXISTS IN THIS FORM. The pre-existing guard for this function,
// scripts/verify-location-index-source.ts, is a source-text tripwire: it pins the TABLE NAME and the
// COLUMN SHAPE and passed every day the defect was live, because the defect was in control flow, not
// in the text it reads. This one RUNS the real `ensureLocationIndex()` — lifted verbatim out of
// locations.ts, never re-typed ([[feedback_never-test-a-copy-of-production-code]]) — against an
// injected failing client, and asserts on the state it leaves behind.
//
//   node --experimental-strip-types scripts/verify-failed-location-index-is-not-a-load.ts
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

// The ONLY stand-ins: the injected Supabase client (the failure being simulated) and the two memo
// caches ensureLocationIndex invalidates. Neither carries logic — `_cityKeys`/`_invMemo` are a null
// and a WeakMap in production too, and nothing in this test reads them.
const PRELUDE = `
let supabase: any = null;
const setClient = (c: any) => { supabase = c; };
let _cityKeys: any = null;
let _invMemo: any = new WeakMap();
`;

type Lifted = {
  ensureLocationIndex: () => Promise<void>;
  LIVE_CITIES: { city: string; region: string; n: number }[];
  _liveLoaded: boolean;
  _livePromise: Promise<void> | null;
  setClient: (c: unknown) => void;
};

/** Lift the REAL declarations out of a copy of locations.ts (the real file, or a mutant of it). */
async function load(source: string): Promise<Lifted> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-locidx-'));
  const file = join(dir, 'locations.ts');
  writeFileSync(file, source);
  return await liftSymbols(file, [
    { header: 'type LiveDistrict = ', endsWith: /;$/ },
    { header: 'type LiveCity = ', endsWith: /;$/ },
    { header: 'let LIVE_DISTRICTS', endsWith: /;$/ },
    { header: 'let LIVE_CITIES', endsWith: /;$/ },
    { header: 'let _liveLoaded', endsWith: /;$/ },
    { header: 'let _livePromise', endsWith: /;$/ },
    { header: 'export async function ensureLocationIndex(', endsWith: /^\}$/ },
  ], ['ensureLocationIndex', 'LIVE_CITIES', '_liveLoaded', '_livePromise', 'setClient'], PRELUDE) as unknown as Lifted;
}

// What production actually hands back. A failed select resolves — it does not throw — with data null
// and an error; a good one resolves with rows. `n` is the listing count per (city, district) row.
const ROWS = [
  { city: 'Abha', district: 'Al Sad', region: 'Asir', n: 12000 },
  { city: 'Khamis Mushait', district: 'Al Musa', region: 'Asir', n: 20203 },
];
type Call = { calls: number };
const failingClient = (log: Call) => ({
  from: () => ({ select: () => ({ abortSignal: () => { log.calls++; return Promise.resolve({ data: null, error: { message: 'FetchError: network request failed' } }); } }) }),
});
const goodClient = (log: Call) => ({
  from: () => ({ select: () => ({ abortSignal: () => { log.calls++; return Promise.resolve({ data: ROWS, error: null }); } }) }),
});

/** The invariants, as one runnable predicate — reused verbatim against every mutant below. */
async function probe(mod: Lifted) {
  const log: Call = { calls: 0 };
  mod.setClient(failingClient(log));
  await mod.ensureLocationIndex();
  const afterFailure = {
    markedLoaded: mod._liveLoaded,
    promiseParked: mod._livePromise !== null,
    cities: mod.LIVE_CITIES.length,
    calls: log.calls,
  };
  // The user-visible half: the very next call must actually go back to the network and fill the index.
  mod.setClient(goodClient(log));
  await mod.ensureLocationIndex();
  const afterRetry = { cities: mod.LIVE_CITIES.length, loaded: mod._liveLoaded, calls: log.calls };
  // A settled success must NOT re-fetch — the failure fix must not turn a once-per-session load into
  // a per-call one.
  await mod.ensureLocationIndex();
  return { afterFailure, afterRetry, callsAfterThird: log.calls };
}

/** Every assertion this barrier makes, as a single boolean — so a mutant can be held to it. */
const holds = (r: Awaited<ReturnType<typeof probe>>) =>
  r.afterFailure.markedLoaded === false
  && r.afterFailure.promiseParked === false
  && r.afterFailure.cities === 0
  && r.afterFailure.calls === 1
  && r.afterRetry.calls === 2
  && r.afterRetry.cities === 2
  && r.afterRetry.loaded === true
  && r.callsAfterThird === 2;

console.log('\nA failed location-index fetch must never be recorded as a successful load\n');

const realSrc = readFileSync(SRC, 'utf8');
const real = await probe(await load(realSrc));

check('a failed fetch does NOT mark the index loaded', real.afterFailure.markedLoaded === false,
  '_liveLoaded was set true on a failure — the whole session now believes the empty index is the real one');
check('a failed fetch parks nothing: _livePromise is nulled so the next call retries',
  real.afterFailure.promiseParked === false,
  'the dead promise is still cached — every later caller awaits a load that already failed');
check('a failed fetch leaves the index empty rather than half-filled', real.afterFailure.cities === 0);
check('the failing fetch really was attempted (the test is not vacuous)', real.afterFailure.calls === 1,
  `${real.afterFailure.calls} request(s) — if 0, no failure was ever simulated and every check above is empty`);
check('the NEXT call refetches after a failure', real.afterRetry.calls === 2,
  'no second request was made: one transient blip empties the location index for the whole page session');
check('the retry fills the live index (a region search can resolve its cities again)',
  real.afterRetry.cities === 2 && real.afterRetry.loaded === true,
  `LIVE_CITIES=${real.afterRetry.cities}, _liveLoaded=${real.afterRetry.loaded}`);
check('a SUCCESSFUL load still happens exactly once per session', real.callsAfterThird === 2,
  'the third call refetched — the success path was changed, this fix is failure-path only');

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

// M1 — the pre-fix source, reconstructed exactly: drop the failure guard AND put back the `if (data)`
// it replaced, so a `{data:null,error}` response skips the fill block and walks into `_liveLoaded =
// true`. Both halves are needed: without the guard alone, `data.filter(...)` would throw on null and
// land in the catch by accident — an accident is not a barrier, and the original code did not have it.
mustCatch('a failed fetch recorded as a successful empty load (the original defect)',
  !holds(await probe(await load(mutate(
    [/^\s*if \(error \|\| !data\) throw new Error\(.*\n/m, ''],
    [/^      \{$/m, '      if (data) {'],
  )))));

// M2 — the half-fix: notice the failure but leave the dead promise cached, so nothing ever retries.
mustCatch('a failure that is never retried (dead _livePromise kept)',
  !holds(await probe(await load(mutate([/^      _livePromise = null;$/m, '      /* not reset */;'])))));

// M3 — the opposite direction: a success that also fails to record itself would refetch forever.
mustCatch('a successful load that is not recorded (refetch on every call)',
  !holds(await probe(await load(mutate([/^      _liveLoaded = true;$/m, '      _liveLoaded = false;'])))));

if (failures || mutFail) {
  console.error(`\n❌ ${failures} assertion failure(s), ${mutFail} blind mutation(s)`);
  process.exit(1);
}
console.log('\n✅ a failed location-index fetch stays UNKNOWN: not loaded, not cached, retried on the next call');
