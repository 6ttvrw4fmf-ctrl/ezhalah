// A TRENDING CITY CHIP MUST COUNT WHAT CLICKING IT RETURNS — INCLUDING THE ADVANCED ANSWERS.
//
// THE DEFECT (owner-approved fix, 2026-08-22). `top_cities_by_deal_ar` accepted only
// (p_deal, p_rent_period, p_category, p_types). It had NO advanced-filter parameters at all, so a
// city chip could never reflect an answered advanced question — the number shown and the number the
// user gets on click were different quantities BY CONSTRUCTION. This is the city half of the defect
// PR #822 fixed for districts, where the live overstatement measured 7.5x.
//
// The backend half is migration `top_cities_by_deal_ar_understands_advanced_filter`, which
// regenerates the RPC by concatenating `af_eligibility_clause()` — the same canonical predicate
// already inlined in the results RPC and af_eligible_count — so the three agree by construction.
// `mon_detect_af_count_surfaces_carry_af()` guards that half live.
//
// THIS FILE GUARDS THE CLIENT HALF, which the database cannot see:
//   1. every city-pool entry point accepts the advanced params (a REQUIRED argument, so TypeScript
//      refuses to compile a caller that forgets — the same compile-time barrier `types` already
//      uses; see [[cohortTypesAr]]);
//   2. the params are actually SENT on the RPC call;
//   3. they are part of the POOL CACHE KEY — without that, changing an answer serves the previously
//      cached pre-AF pool and the chip silently reverts to overstating;
//   4. the last-resort deal-only fallback is AF-gated — that fallback drops every advanced answer,
//      so on a pre-AF backend it would hand back exactly the overstated numbers, and silently,
//      because a fallback looks like success. Owner: "No pre-AF count is allowed once AF answers
//      exist." No count beats a wrong count;
//   5. index.tsx passes the params at every call site rather than at some of them.
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-af-city-counts-carry-advanced.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const root = process.cwd();
const loc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');
const idx = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');

/**
 * THE VERDICT, extracted as a PURE function of the three source files it reads (routine #10,
 * 2026-09-22, R1). It used to run inline over the real tree, which made the check unfalsifiable: a
 * predicate that had stopped discriminating would pass exactly as loudly as a healthy one, and this
 * file sat on the mutation-proof grandfather list — a barrier nobody had ever watched fail. Taking
 * the sources as ARGUMENTS is what lets the proofs at the bottom hand it a BROKEN COPY OF THE REAL
 * SHIPPED FILES rather than a fixture this barrier invented for itself.
 */
export function cityAfProblems(loc: string, idx: string, remote: string): { problems: string[]; ok: string[] } {
  const problems: string[] = [];
  const ok: string[] = [];
  const check = (cond: boolean, pass: string, fail: string) =>
    cond ? ok.push(pass) : problems.push(fail);




// ── 1. Entry points accept the advanced params ───────────────────────────────────────────────────
for (const [fn, re] of [
  ['ensureCityFieldIndex', /export async function ensureCityFieldIndex\([^)]*af: AfParams \| null/],
  ['topCitiesByListings', /export function topCitiesByListings\([^)]*af: AfParams \| null\)/],
  ['matchCitiesByText', /export function matchCitiesByText\([^)]*af: AfParams \| null\)/],
  ['cityPoolStatus', /export function cityPoolStatus\([^)]*af: AfParams \| null\)/],
] as const) {
  check(
    (re as RegExp).test(loc),
    `${fn}() accepts the advanced params`,
    `src/data/locations.ts: ${fn}() does not take an \`af: AfParams | null\` argument, so an answered ` +
      `advanced question cannot reach the city chip count and the chip overstates.`,
  );
}

// topCitiesByListings / matchCitiesByText / cityPoolStatus take it as a REQUIRED argument (no
// default), so a forgetful caller is a compile error rather than a silent pre-AF count.
for (const fn of ['topCitiesByListings', 'matchCitiesByText', 'cityPoolStatus']) {
  const m = loc.match(new RegExp(`export function ${fn}\\(([^)]*)\\)`));
  check(
    !!m && /af: AfParams \| null$/.test(m[1].trim()),
    `${fn}() takes the advanced params as a REQUIRED argument (compile-time barrier)`,
    `src/data/locations.ts: ${fn}()'s \`af\` argument is optional or missing. Make it required so a ` +
      `caller that forgets it fails to compile, exactly as \`types\` already does.`,
  );
}

// ── 2 + 3. Sent on the call, and part of the cache key ───────────────────────────────────────────
check(
  /Object\.assign\(args, af \?\? \{\}\)/.test(loc),
  'the advanced params are merged into the top_cities_by_deal_ar args',
  'src/data/locations.ts: the city RPC call does not merge `af` into its args — the chip count would ' +
    'stay pre-AF even though the RPC now accepts the parameters.',
);
check(
  /const cityPoolKey = \([^)]*af: AfParams \| null[^)]*\) =>[^;]*\$\{afKey\(af\)\}/.test(loc),
  'the advanced answers are part of the city-pool CACHE KEY (no stale pre-AF pool)',
  'src/data/locations.ts: cityPoolKey() does not fold `af` into the key. Changing an advanced answer ' +
    'would then serve the previously cached pre-AF pool and the chip silently reverts to overstating.',
);
check(
  /const afKey = \(af: AfParams \| null\)[\s\S]{0,300}?Object\.keys\(af\)\.sort\(\)/.test(loc),
  'the advanced cache key is order-stable (keys sorted)',
  'src/data/locations.ts: afKey() does not sort its keys, so the same two answers in a different ' +
    'order would produce two cache entries and a needless refetch (or a missed one).',
);

// ── 4. The last-resort fallback must not silently drop the advanced answers ──────────────────────
// The guard now asks "are any of these keys a PREDICATE the user chose?" rather than "is this object
// non-empty" (2026-09-03): `af` also carries the search's TABLE SCOPE, which is present on every call
// including a completely unfiltered one. A plain non-empty test would pin hasNarrowing true forever
// and silently disable every widening fallback below — a blank city field where a widened one
// belongs. Both halves are asserted: the guard exists, AND it discounts the scope keys.
check(
  /const hasNarrowing = Object\.keys\(af \?\? \{\}\)\.some\(\(k\) => !TABLE_SCOPE_KEYS\.includes\(k\)\)/.test(loc)
    && /TABLE_SCOPE_KEYS = \['p_tables', 'p_tables2', 'p_types2'\]/.test(loc),
  'the code knows whether any advanced answer is present',
  'src/data/locations.ts: no `hasNarrowing` guard — the fallback chain cannot tell a narrowed search from a plain one (renamed + widened 2026-08-22 to cover bedrooms/price/area too; scope keys discounted 2026-09-03).',
);
check(
  /if \(res\.error && periodTok !== null && !hasNarrowing\)/.test(loc),
  'the deal-only fallback is GATED on the user not being narrowed (this checks the gate, not the call)',
  'src/data/locations.ts: the last-resort `{ p_deal }` fallback still runs when advanced answers are ' +
    'present. That call drops every advanced answer, so it returns exactly the overstated numbers ' +
    'this fix removes — silently, because a fallback looks like success.',
);

// ── 5. Every call site passes them ───────────────────────────────────────────────────────────────
check(
  /rpcAllNarrowingParams\(query\)/.test(idx) && /const cityAfParams = useMemo\(\(\) => cityAfRaw/.test(idx),
  'index.tsx builds cityAfParams from the ONE shared builder — rpcAllNarrowingParams(), which spreads rpcAdvancedFilterParams()',
  'src/app/index.tsx: cityAfParams is not derived from the shared builder. A second, ' +
    'hand-written mapping is how the district and city surfaces drift apart.',
);
check(
  /rpcAdvancedFilterParams/.test(remote) && /export function rpcAdvancedFilterParams/.test(remote),
  'rpcAdvancedFilterParams() is still the shared exported definition',
  'src/data/remote.ts: rpcAdvancedFilterParams() is missing — the district and city count paths no ' +
    'longer share one definition of "what an advanced answer sends".',
);
// The memo must depend on the answers themselves, or a changed answer keeps the old object identity
// and therefore the old cache key.
// IDENTITY IS KEYED ON CONTENT, NOT A HAND-WRITTEN DEP LIST (2026-08-22). The enumeration below used
// to name each answer by hand — but a forgotten field is exactly how Trending lost bedrooms/price/
// area, so the list itself was the hazard. cityAfParams is now memoised on JSON.stringify of the
// params it just built, so its identity changes if and only if a real predicate changed: strictly
// stronger than any enumeration, and it cannot rot when a new filter is added.
check(
  /const cityAfSig = JSON\.stringify\(cityAfRaw\)/.test(idx)
  && /const cityAfParams = useMemo\(\(\) => cityAfRaw, \[cityAfSig\]\)/.test(idx),
  'cityAfParams identity is keyed on its own CONTENT signature (covers every predicate, present and future)',
  "src/app/index.tsx: cityAfParams is not memoised on its content signature, so a changed filter can "
    + 'reuse the previous object identity, the previous cache key, and the previous (wrong) counts.',
);
for (const [label, re] of [
  ['ensureCityFieldIndex', /ensureCityFieldIndex\(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams\)/],
  ['topCitiesByListings', /topCitiesByListings\(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams\)/],
  ['cityPoolStatus', /cityPoolStatus\(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams\)/],
  ['matchCitiesByText', /matchCitiesByText\(effDeal, rentPeriodTok, effCategory, [^,]+, cohortTypes, cityAfParams\)/],
] as const) {
  check(
    (re as RegExp).test(idx),
    `index.tsx passes cityAfParams to ${label}`,
    `src/app/index.tsx: at least one ${label}() call site omits cityAfParams.`,
  );
}
// No call site may be left on the old arity.
check(
  !/topCitiesByListings\(effDeal, rentPeriodTok, effCategory, 6, cohortTypes\)/.test(idx)
    && !/ensureCityFieldIndex\(effDeal, rentPeriodTok, effCategory, cohortTypes\)/.test(idx)
    && !/cityPoolStatus\(effDeal, rentPeriodTok, effCategory, cohortTypes\)/.test(idx),
  'no city call site is left on the pre-AF arity',
  'src/app/index.tsx: a city-pool call still uses the old signature without cityAfParams — that one ' +
    'screen would keep showing pre-AF counts while the others are correct.',
);

  return { problems, ok };
}

const { problems, ok } = cityAfProblems(loc, idx, remote);

// Checks that are facts about the ENVIRONMENT, not about the three sources, so they live outside
// the pure verdict and are appended to its result.
const checkTop = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// THE CLAIM THIS CHECK USED TO MAKE WAS BIGGER THAN ITS PREDICATE (ops_incident #385).
//
// It passed as "the deal-only fallback is AF-gated (no pre-AF count once answers exist)" — a
// statement about what the fallback DELIVERS. The regex above only sees that a gate is written; it
// never runs the ladder, so it cannot see what the gated call SENDS. On 2026-09-21 that last rung
// sent `{ p_deal }` alone, dropping p_tables/p_tables2/p_types2, and this file stayed GREEN for
// every day the defect was live. `!hasNarrowing` does not protect it either: p_category and p_types
// live outside `af`, so the gate is FALSE for a user who picked a category and a property type and
// nothing else — precisely when the last rung fires.
//
// The PASS text above is now scoped to what it actually proves. The delivery invariant is proven by
// EXECUTION in verify-count-pool-fallbacks-keep-the-table-scope.ts, and that citation is ENFORCED
// rather than written down: a named-but-absent guard is the PART 1.11 defect, and it would leave
// this file's gate assertion as the only cover over the ladder again.
checkTop(
  existsSync(join(root, 'scripts/verify-count-pool-fallbacks-keep-the-table-scope.ts'))
    && npmTestRuns(root, 'verify-count-pool-fallbacks-keep-the-table-scope'),
  'the ARGS-level companion that this file CANNOT see still exists and still runs',
  'scripts/verify-count-pool-fallbacks-keep-the-table-scope.ts is the only check that EXECUTES the ' +
    'city/district fallback ladders and asserts the args each rung sends. Without it, every fallback ' +
    'assertion in this file is a source-TEXT tripwire over a path nothing runs (ops_incident #385).',
);


// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
// Every defect below is re-introduced into a copy of the REAL shipped source and the verdict is
// asked again. Without these, a cityAfProblems() that returned [] would pass everything above and
// this file would be decoration — which is exactly what its place on the grandfather list meant.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  ✓ catches: ${label}`); return; }
  mutFail++;
  console.error(`  ❌ BLIND to: ${label}`);
};
/** Mutate the REAL file and re-run the real verdict. A missing target means the barrier is stale. */
const afterEdit = (which: 'loc' | 'idx', find: string, replace: string): boolean => {
  const src = which === 'loc' ? loc : idx;
  if (!src.includes(find)) {
    mutFail++;
    console.error(`  ❌ mutation target missing from source (barrier is stale): ${find.slice(0, 60)}`);
    return false;
  }
  const mutated = src.replace(find, replace);
  return cityAfProblems(which === 'loc' ? mutated : loc, which === 'idx' ? mutated : idx, remote)
    .problems.length > 0;
};

console.log('\nMutation proofs\n');

mustCatch('the advanced params stop being merged into the city RPC args (the chip reverts to pre-AF counts)',
  afterEdit('loc', 'Object.assign(args, af ?? {})', 'Object.assign(args, {})'));
mustCatch('the advanced answers drop out of the city-pool CACHE KEY (a changed answer serves the stale pre-AF pool)',
  afterEdit('loc', '${afKey(af)}', '${\'\'}'));
mustCatch('the last-resort deal-only fallback loses its gate (a pre-AF count served silently, because a fallback looks like success)',
  afterEdit('loc', 'if (res.error && periodTok !== null && !hasNarrowing)', 'if (res.error && periodTok !== null)'));
mustCatch('hasNarrowing stops discounting the table-scope keys (pins the gate TRUE and kills every widening fallback)',
  afterEdit('loc', 'Object.keys(af ?? {}).some((k) => !TABLE_SCOPE_KEYS.includes(k))', 'Object.keys(af ?? {}).length > 0'));
mustCatch('a city call site is left on the pre-AF arity (one screen keeps overstating while the others are correct)',
  afterEdit('idx', 'cityPoolStatus(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams)',
    'cityPoolStatus(effDeal, rentPeriodTok, effCategory, cohortTypes)'));
mustCatch('cityAfParams stops being memoised on its CONTENT signature (a changed filter reuses the old identity, key and counts)',
  afterEdit('idx', 'const cityAfParams = useMemo(() => cityAfRaw, [cityAfSig])',
    'const cityAfParams = useMemo(() => cityAfRaw, [])'));
mustCatch('…while the SHIPPED tree is NOT flagged (the verdict is not vacuously red, which would be just as useless)',
  cityAfProblems(loc, idx, remote).problems.length === 0);

// ── Report ───────────────────────────────────────────────────────────────────────────────────────
for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length) {
  console.error(`\n❌ verify-af-city-counts-carry-advanced: ${problems.length} check(s) failed\n`);
  for (const p of problems) console.error(`  ❌ ${p}\n`);
  process.exit(1);
}
if (mutFail > 0) {
  console.error(`\n❌ verify-af-city-counts-carry-advanced: ${mutFail} mutation(s) SURVIVED — the verdict cannot catch a defect it claims to cover.`);
  process.exit(1);
}
console.log(`\n✓ verify-af-city-counts-carry-advanced: ${ok.length} checks passed, ${7} mutations caught.`);
