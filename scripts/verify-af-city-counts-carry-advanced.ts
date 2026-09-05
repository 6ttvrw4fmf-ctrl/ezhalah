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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const loc = readFileSync(join(root, 'src/data/locations.ts'), 'utf8');
const idx = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const remote = readFileSync(join(root, 'src/data/remote.ts'), 'utf8');

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
  'the deal-only fallback is AF-gated (no pre-AF count once answers exist)',
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

// ── Report ───────────────────────────────────────────────────────────────────────────────────────
for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length) {
  console.error(`\n❌ verify-af-city-counts-carry-advanced: ${problems.length} check(s) failed\n`);
  for (const p of problems) console.error(`  ❌ ${p}\n`);
  process.exit(1);
}
console.log(`\n✓ verify-af-city-counts-carry-advanced: ${ok.length} checks passed.`);
