// "STILL PRODUCES p_beds_exact" WAS TRUE OF A BUILDER THAT HAD STOPPED RETURNING IT.
//
// THE BLIND GUARD (found 2026-09-22 by routine #10's mutant survival sweep, BARRIER_ENGINEER.md
// PART 4.8). verify-trending-carries-full-filter-state.ts guards the 2026-08-22 owner-reported
// defect — bedrooms / price / area silently not reaching Trending, measured at 15x on الرياض, 78x on
// جدة and 708x on مكة — with this loop:
//
//     for (const key of ['p_beds_exact', 'p_beds_min', 'p_price_min', …])
//       check(`rpcFilterParams still produces ${key}`, new RegExp(`\\b${key}\\b`).test(normalBuilder));
//
// `\bp_beds_exact\b` matches the LOCAL DECLARATION `const p_beds_exact = exact.length ? exact : null;`
// as happily as it matches the returned object. Measured by execution: deleting `p_beds_exact,` from
// rpcFilterParams's return statement — the exact defect that file exists to catch, and the exact
// mutation its own comment says was used to justify the loop — left it printing
// `PASS  rpcFilterParams still produces p_beds_exact` and exiting 0.
//
// It is a "produces" claim verified by MENTION. A key can be computed and then dropped on the way
// out, which is precisely how a narrowing predicate stops reaching a count surface.
//
// THIS FILE ASSERTS THE SAME CONTRACT BY EXECUTION. It LIFTS the real rpcFilterParams,
// rpcAdvancedFilterParams and rpcAllNarrowingParams out of src/data/remote.ts — never a hand-copied
// duplicate, [[feedback_never-test-a-copy-of-production-code]] — calls them with a query that sets
// every narrowing predicate, and reads the KEYS OF THE RETURNED OBJECT. A key that is computed but
// not returned is absent from that object, so the mention/return distinction disappears.
//
// Both directions of the omission rule are covered, because they pull opposite ways and a barrier
// that checked only one could be satisfied by breaking the other:
//   SET   → rpcAllNarrowingParams must CARRY the key (or Trending counts a wider set than search).
//   UNSET → it must OMIT the key rather than send an explicit null. The trending pool decides
//           "is the user narrowed?" by asking whether this object is empty, and — measured —
//           explicit nulls pushed top_cities_by_deal_ar into a statement timeout on an unfiltered
//           call, emptying the city suggestion list entirely.
//
// Run: node --experimental-strip-types scripts/verify-narrowing-builders-really-emit-their-keys.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/data/remote.ts');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

// STAND-INS for the helpers rpcFilterParams closes over. None of them is under test here: this file
// asserts which KEYS SURVIVE INTO THE RETURNED OBJECT, so the helpers are inputs, exactly as the
// caches are inputs in verify-count-pool-fallbacks-keep-the-table-scope.ts. `pnum` is NOT stubbed —
// it is lifted real, because it decides whether a price/area bound becomes a number or a null, which
// is the difference between a key being emitted and omitted.
const PRELUDE = `
type SearchQuery = any;
const cohortTypesAr = (_q: any) => ['شقة'];
const bedroomTokens = (q: any) => (q.__beds ?? []);
const agentPriceCapAnnual = (_q: any) => null;
const rentPeriodParam = (_q: any) => 'سنوي';
`;

type Lifted = {
  rpcFilterParams: (q: unknown) => Record<string, unknown>;
  rpcAdvancedFilterParams: (q: unknown) => Record<string, unknown>;
  rpcAllNarrowingParams: (q: unknown) => Record<string, unknown>;
};

async function load(source: string): Promise<Lifted> {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-narrowing-'));
  const file = join(dir, 'remote.ts');
  writeFileSync(file, source);
  return await liftSymbols(file, [
    { header: 'const pnum = ', endsWith: /;$/ },
    { header: 'const RPC_SORT_KEYS = ', endsWith: /;$/ },
    { header: 'function rpcFilterParams(', endsWith: /^\}$/ },
    { header: 'export function rpcAdvancedFilterParams(', endsWith: /^\}$/ },
    { header: 'export function rpcAllNarrowingParams(', endsWith: /^\}$/ },
  ], ['rpcFilterParams', 'rpcAdvancedFilterParams', 'rpcAllNarrowingParams'], PRELUDE) as unknown as Lifted;
}

/** The NORMAL narrowing keys the 2026-08-22 defect dropped. */
const NORMAL_KEYS = ['p_beds_exact', 'p_beds_min', 'p_price_min', 'p_price_max', 'p_area_min', 'p_area_max'];

/** A user who has answered every normal narrowing question. `__beds` feeds the stubbed tokeniser. */
const NARROWED = { __beds: ['3', '5'], priceMin: '70000', priceMax: '100000', areaMin: '120', areaMax: '180' };
/** The same user having chosen nothing — every narrowing key must then be OMITTED, not null. */
const UNNARROWED = { __beds: [] };

/**
 * THE VERDICT, pure so a mutant builder can be handed to it. Returns one line per narrowing key that
 * does not survive into the object a count surface actually sends.
 */
export function emissionProblems(mod: Lifted): string[] {
  const out: string[] = [];
  const narrowed = mod.rpcAllNarrowingParams(NARROWED);
  for (const k of NORMAL_KEYS) {
    if (!(k in narrowed)) {
      out.push(`${k} is NOT emitted by rpcAllNarrowingParams for a user who set it — Trending counts a wider set than search delivers (the 2026-08-22 defect)`);
    }
  }
  const unset = mod.rpcAllNarrowingParams(UNNARROWED);
  for (const k of NORMAL_KEYS) {
    if (k in unset) {
      out.push(`${k} is emitted as ${JSON.stringify(unset[k])} for a user who set NOTHING — an unset predicate must be OMITTED, or every search looks narrowed and the unfiltered city call times out`);
    }
  }
  return out;
}

const real = await load(readFileSync(SRC, 'utf8'));

// The builders really ran — without this, every assertion below could be vacuously true.
const narrowed = real.rpcAllNarrowingParams(NARROWED);
check('rpcAllNarrowingParams returned a non-empty object for a narrowed user (the probe can bite)',
  Object.keys(narrowed).length > 0, JSON.stringify(narrowed));

for (const k of NORMAL_KEYS) {
  check(`rpcAllNarrowingParams EMITS ${k} (read from the returned object, not matched in the source)`,
    k in narrowed, `emitted keys: ${Object.keys(narrowed).join(', ')}`);
}
check('…and an unset user gets NONE of them (omitted, never explicit null)',
  NORMAL_KEYS.every((k) => !(k in real.rpcAllNarrowingParams(UNNARROWED))),
  JSON.stringify(real.rpcAllNarrowingParams(UNNARROWED)));

// p_types and p_sort_by are deliberately stripped: every caller passes its own cohort array, and
// leaking p_sort_by into a count RPC 404'd both count calls with PGRST202 on 2026-07-30.
check('p_types and p_sort_by are still stripped from the all-narrowing object',
  !('p_types' in narrowed) && !('p_sort_by' in narrowed));

// The ADVANCED half must ride in the same object — the two-builder split is what made the original
// defect structural, and a surface that spreads this one may not have to remember the other.
const both = real.rpcAllNarrowingParams({ ...NARROWED, bathMin: 4, streetWidthMin: 25 });
check('the ADVANCED answers ride in the SAME object as the normal narrowing',
  'p_bath_min' in both && 'p_street_width_min' in both && 'p_beds_exact' in both,
  JSON.stringify(both));

check('this check runs in `npm test` (npmTestRuns, never a grep over package.json)',
  npmTestRuns(ROOT, 'verify-narrowing-builders-really-emit-their-keys'));

// ── MUTATION PROOFS: re-introduce the real defect in the real source, watch this barrier catch it ──
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
  return emissionProblems(await load(src.replace(find, replace))).length > 0;
}

// THE ONE THE OLD TEXT CHECK COULD NOT SEE: the key is still COMPUTED (so `\bp_beds_exact\b` still
// matches the source) but no longer RETURNED.
mustCatch('p_beds_exact computed but dropped from the return — the defect the source regex called PASS',
  await caughtAfter('    p_beds_exact,\n', ''));
mustCatch('p_price_max computed but dropped from the return',
  await caughtAfter('    p_price_max,\n', ''));
mustCatch('the whole normal half stops being spread into the all-narrowing object',
  await caughtAfter('  const { p_types: _types, p_sort_by: _sort, ...normal } =',
    '  const normal: Record<string, unknown> = {}; const { p_types: _t2, p_sort_by: _s2 } ='));
mustCatch('the omit-unset rule is inverted — explicit nulls are sent again (the statement-timeout defect)',
  await caughtAfter('    if (v === null || v === undefined) continue;', ''));

// NEGATIVE CONTROL: the shipped file is NOT flagged. A verdict that is red for everything is as
// useless as one that is green for everything, and this is what catches an over-broad repair.
mustCatch('…while the SHIPPED builders are NOT flagged (the verdict is not vacuously red)',
  emissionProblems(real).length === 0);

console.log(failures === 0
  ? '\nOK  every narrowing predicate the user sets survives into the object a count surface sends — proven by execution.'
  : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
