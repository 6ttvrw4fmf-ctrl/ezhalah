// TRENDING IS THE LOCATION BREAKDOWN OF THE USER'S EXACT ELIGIBLE SET — NOT A GENERIC SUGGESTION.
//
// OWNER RULE (2026-08-22). "If the user has selected category, group, property type, Buy/Rent,
// Annual/Monthly, bedrooms, price, area and any Advanced Filter answers, then ALL of that must be
// passed into Trending." The number beside a city must be «listings matching everything I picked, in
// that city» — so that count == the count the user lands on after clicking it.
//
// THE DEFECT THIS LOCKS OUT (found live on production by the owner, 2026-08-22). The city pool was
// handed rpcAdvancedFilterParams() — the ADVANCED half only — so bedrooms, price and area never
// reached top_cities_by_deal_ar. Measured on Apartment + Rent + Annual:
//     3 bedrooms                     الرياض shown 10,618 · truth 3,863
//     + 120-180 m² + 70k-100k        الرياض shown 10,618 · truth   705   (15x; جدة 78x; مكة 708x)
// Picking a bedroom count changed NOTHING on screen, and every request went out with
// p_beds_* / p_area_* / p_price_* all null. The user chose a city from those numbers and landed on a
// completely different result.
//
// WHY IT WAS STRUCTURAL, AND WHAT CHANGED. The params were split across two builders
// (rpcFilterParams = normal narrowing, rpcAdvancedFilterParams = advanced answers), so every count
// surface had to REMEMBER to spread both — and this one spread one. remote.ts now exposes
// rpcAllNarrowingParams() as the single "everything the user chose" definition; Trending spreads
// THAT, so a future filter reaches it for free.
//
// TWO KINDS OF CHECK, IN TWO FILES (split 2026-09-02 — see below):
//   A. SOURCE — THIS FILE, offline, in `npm test`. Trending must build from the all-inclusive
//      builder, and that builder must carry both halves. Catches "someone removed bedrooms from
//      Trending" (the owner's named mutation).
//   B. LIVE — scripts/verify-trending-filter-state-live.ts. The trending RPC must actually HONOUR
//      each predicate (a strictly smaller count), and a stacked query must equal an independently-
//      expressed PostgREST count. Catches a param that is sent but ignored, or renamed, which no
//      source check can see.
//
// Either alone is weak, so both still run — just not in the same place. §B drives PRODUCTION, and
// while it lived here it was auto-discovered into the REQUIRED `Full verification` check, so a
// production hiccup failed unrelated PRs (observed: red CI on head 79210cb, green locally twice at
// 50/50, green CI on the next head). AGENTS.md documents that exact anti-pattern for the migration-
// drift guard. §B now runs in .github/workflows/af-live-truth-check.yml alongside the other four
// live AF/Trending checks, named as its home in scripts/test-exclusions.txt.
//
//   node --experimental-strip-types scripts/verify-trending-carries-full-filter-state.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

console.log('\nTrending must carry EVERY filter the user has already chosen\n');

// ── A. SOURCE ───────────────────────────────────────────────────────────────────────────────────
const remote = strip(read('src/data/remote.ts'));
const index  = strip(read('src/app/index.tsx'));

const builder = remote.slice(remote.indexOf('export function rpcAllNarrowingParams'),
                             remote.indexOf('export function rpcAllNarrowingParams') + 600);
check('remote.ts exposes rpcAllNarrowingParams (the ONE "everything the user chose" definition)',
  builder.length > 0);
check('rpcAllNarrowingParams spreads the NORMAL narrowing (bedrooms / price / area)',
  /rpcFilterParams\(q\)/.test(builder),
  'without rpcFilterParams the builder loses p_beds_*, p_price_* and p_area_* — the exact 2026-08-22 defect');
check('rpcAllNarrowingParams spreads the ADVANCED answers',
  /rpcAdvancedFilterParams\(q\)/.test(builder));

// SPREADING IS NOT ENOUGH — the keys must actually SURVIVE. Proven by mutation: stripping
// p_beds_exact/p_beds_min inside rpcAllNarrowingParams left every check above green while bedrooms
// silently stopped reaching Trending, which is the original defect wearing a different hat. So the
// contract is pinned from both ends: the normal builder must PRODUCE each narrowing key, and the
// all-inclusive builder may drop ONLY the two keys it is documented to drop.
const normalBuilder = remote.slice(remote.indexOf('function rpcFilterParams'),
                                   remote.indexOf('function rpcCountFilterParams'));
for (const key of ['p_beds_exact', 'p_beds_min', 'p_price_min', 'p_price_max', 'p_area_min', 'p_area_max']) {
  check(`rpcFilterParams still produces ${key}`, new RegExp(`\\b${key}\\b`).test(normalBuilder),
    'the normal-narrowing builder feeds BOTH search and Trending — losing a key here loses it everywhere');
}
const dropped = (builder.match(/const \{([^}]*)\}\s*=\s*\n?\s*rpcFilterParams/)?.[1] ?? '')
  .split(',').map((x) => x.trim().split(':')[0].trim()).filter((x) => x && x !== '...normal');
// UNSET PREDICATES MUST BE OMITTED, NOT SENT AS NULL. Two things depend on it: the trending pool
// decides "is the user narrowed?" by asking whether this object is empty, and — measured — sending
// p_beds_*/p_price_*/p_area_* as explicit NULLs pushed top_cities_by_deal_ar into a statement
// timeout on an unfiltered call, emptying the city suggestion list entirely.
check('rpcAllNarrowingParams omits unset predicates (never sends explicit nulls)',
  /v === null \|\| v === undefined\) continue;/.test(builder)
  && /Array\.isArray\(v\) && v\.length === 0\) continue;/.test(builder),
  'an always-present null key makes every search look "narrowed" AND times the trending RPC out');

check('rpcAllNarrowingParams drops ONLY p_types and p_sort_by',
  dropped.length === 2 && dropped.includes('p_types') && dropped.includes('p_sort_by'),
  `it discards: ${dropped.join(', ') || '(nothing parsed)'} — any other key here is a predicate Trending will silently stop applying`);

check('the Trending city pool is built from rpcAllNarrowingParams',
  /rpcAllNarrowingParams\(query\)/.test(index),
  'Trending must not be handed the advanced-only builder again');
check('the Trending city pool no longer uses the advanced-ONLY builder',
  !/cityAfParams\s*=\s*useMemo\(\(\)\s*=>\s*rpcAdvancedFilterParams/.test(index)
  && !/rpcAdvancedFilterParams\(query\)/.test(index),
  'rpcAdvancedFilterParams(query) in index.tsx means the normal filters are being dropped again');

// The pool object must reach the RPC, and every widening fallback must be gated on "user is not
// narrowed" — a widened count under an active filter is the overstatement itself, delivered silently.
const locations = strip(read('src/data/locations.ts'));
check('the narrowing params are spread into the top_cities_by_deal_ar arguments',
  /Object\.assign\(args,\s*af\s*\?\?\s*\{\}\)/.test(locations));

// THE TABLE SCOPE IS PART OF "the set the user selected" (defect 2026-09-03). The results RPC is
// scoped to a table list; Trending sent none, so it counted every platform table in
// search_listings_ar while results read only RES_TABLES/COM_TABLES. Five platforms went live in the
// view without joining those lists and Trending began advertising inventory results cannot return —
// الهفوف/أرض سكنية/بيع advertised 2,478 against 109 delivered. The scope must come from the SAME
// function the results call uses; a second copy of the lists is exactly how this drifted.
// Pinned to the COMPOSITION, not to the name appearing somewhere in the file: `...cityTableScope`
// also occurs in the destructuring that produces it, so a looser regex stays green while the spread
// into cityAfRaw is deleted — the exact defect. (Mutation-proven: deleting the spread fails this.)
check('the Trending params carry the search TABLE scope, from searchTableScope(query)',
  /const cityAfRaw = \{ \.\.\.rpcAllNarrowingParams\(query\), \.\.\.cityTableScope \}/.test(index)
  && /= searchTableScope\(query\) \?\? \{\}/.test(index),
  'without p_tables, Trending counts platform tables the results RPC excludes');
check('searchTableScope is the SHARED resolver, not a second copy of the table lists',
  /export function searchTableScope/.test(strip(read('src/data/remote.ts')))
  && /const tableScope = searchTableScope\(q\);/.test(strip(read('src/data/remote.ts'))),
  'resolveSearchScope and Trending must read ONE definition — a copy is the drift class itself');
check('isBroadCommercial is stripped before the scope reaches the RPC',
  /isBroadCommercial: _cityScopeFlag/.test(index),
  'it is a local branch flag, not an RPC argument — PostgREST rejects the whole call (PGRST202)');

// The scope rides in the same `af` object the narrowing does, and it is present on EVERY call —
// including a completely unfiltered one. If it counted as narrowing, hasNarrowing would be pinned
// true and silently disable all three compat fallbacks above, blanking the city field for an
// unnarrowed user instead of widening. The scope is the FRAME of the count, not a predicate.
check('the table-scope keys do NOT count as user narrowing',
  /TABLE_SCOPE_KEYS = \['p_tables', 'p_tables2', 'p_types2'\]/.test(locations)
  && /hasNarrowing = Object\.keys\(af \?\? \{\}\)\.some\(\(k\) => !TABLE_SCOPE_KEYS\.includes\(k\)\)/.test(locations),
  'a scope key read as narrowing pins hasNarrowing true and kills every widening fallback');

// Scoped to the CITY pool builder: every fallback there WIDENS the scope (drops types/category/
// period), and a widened count under an active filter is the overstatement itself — delivered
// silently, because a fallback looks like a success. So each is gated on the user not being narrowed.
// (ensureDistrictOptions has its own fallbacks, but the district NUMBER the user sees comes from
// fetchDistrictEligibleCounts below, not from that pool, whenever any narrowing is active.)
const cityFn = locations.slice(locations.indexOf('export async function ensureCityFieldIndex'),
                               locations.indexOf('export function topCitiesByListings'));
const cityFallbacks = [...cityFn.matchAll(/if \(res\.error[^)]*\)/g)].map((m) => m[0]);
check('every widening fallback in the CITY pool is gated on the user NOT being narrowed',
  cityFallbacks.length >= 3 && cityFallbacks.every((f) => /!hasNarrowing/.test(f)),
  `found ${cityFallbacks.length}; ungated: ${cityFallbacks.filter((f) => !/!hasNarrowing/.test(f)).join(' | ') || '(none)'}`);

// DISTRICT side. The visible district number must likewise describe the user's exact set: it is
// fetched from the RESULTS RPC itself, and must carry BOTH halves of the params (2026-08-20: it
// carried neither advanced answers nor, before that, the normal ones — districts overstated ~8x).
const districtFn = remote.slice(remote.indexOf('export async function fetchDistrictEligibleCounts'),
                                remote.indexOf('export async function fetchDistrictEligibleCounts') + 1400);
check('district counts come from the results RPC (count and outcome cannot disagree)',
  /location_search_candidates_ar/.test(districtFn));
check('district counts carry the NORMAL narrowing (bedrooms / price / area)',
  /rpcCountFilterParams\(q\)/.test(districtFn));
// …AND THE FETCHED NUMBER MUST ACTUALLY BE THE ONE RENDERED. It was fetched correctly but consulted
// only to detect zero, so a narrowed search still displayed the wider deal/category SCOPE count:
// measured live with 3 beds + 120-180 m² + 70k-100k, حي النرجس advertised 1,064 while the whole city
// had 705 eligible listings — a district claiming more than its own city.
check('the trending district row RENDERS the live count, never the wider scope count under narrowing',
  /hasDistrictNarrowing[\s\S]{0,200}districtLiveCounts\?\.\[opt\.districtAr\] != null[\s\S]{0,120}: ''/.test(index),
  'a fetched-but-unrendered live count is the same lie as never fetching it; and under an active '
  + 'filter a MISSING live count must print nothing rather than the wider number '
  + '(tightened 2026-08-22 — see scripts/verify-district-counts-honest.ts)');
check('the typed district row applies the same rule',
  /const n = hasDistrictNarrowing \? live : \(live \?\? opt\.listingCount\);/.test(index),
  'both district surfaces must show the number the user will land on, or none at all');

check('district counts carry the ADVANCED answers',
  /rpcAdvancedFilterParams\(q\)/.test(districtFn));

// …and a change to ANY of those must invalidate the cached district numbers immediately.
for (const field of ['detail', 'priceMin', 'priceMax', 'areaMin', 'areaMax']) {
  check(`district count signature invalidates on query.${field}`,
    new RegExp(`districtNarrowingSig[\\s\\S]{0,900}query\\.${field}\\b`).test(index),
    'a filter change that does not enter the signature leaves the previous numbers on screen');
}
// The ADVANCED answers enter the same signature as a SPREAD of AF_PREDICATE_FIELDS (2026-09-01)
// rather than as hand-typed names. Naming `amenities` and `bathMin` here covered two of the eleven
// and left the other nine — and any future twelfth — free to drop out of the invalidation silently,
// which is the stale-number lie this file exists to catch. AF_PREDICATE_FIELDS is pinned field-for-
// field against the real rpcAdvancedFilterParams builder by verify-af-survives-filter-reentry.ts.
check('district count signature invalidates on EVERY advanced answer (AF_PREDICATE_FIELDS, spread)',
  /districtNarrowingSig[\s\S]{0,1400}\.\.\.AF_PREDICATE_FIELDS\.map\(\(f\) => query\[f\]\)/.test(index),
  'a hand-typed subset leaves every unnamed advanced answer out of the invalidation');


// ── THE TABLE SCOPE IS ONE LIST, PROVEN BY EXECUTION (2026-09-03) ────────────────────────────────
// The checks above pin that Trending SENDS the scope. These pin what the scope IS. Until today it
// was two hand-maintained 31-entry literals, RES_TABLES and COM_TABLES; five platforms were
// activated in production and joined neither, so 4,314 production_ready rows were returnable by no
// search while Trending counted them. Two lists is one list too many.
//
// Both are now a partition of ONE generated inventory by table-name suffix. These run the REAL
// functions (lifted out of remote.ts, never re-typed) rather than reading the source for a shape:
// a regex saying "RES_TABLES is a .filter(...)" stays green over a filter that returns the wrong
// set. The LIVE half — is the committed inventory still the DB's inventory — cannot be answered
// offline and lives in scripts/verify-searchable-scope-matches-inventory.ts.
type ScopeQ = { deal?: string; rentPeriod?: string; dealCombined?: boolean };
const scope = await liftSymbols(
  join(ROOT, 'src/data/remote.ts'),
  [
    { header: 'const SEARCHABLE_TABLES = [', endsWith: /\];$/ },
    { header: 'const MONTHLY_ONLY_TABLE = ', endsWith: /;$/ },
    { header: 'const RES_TABLES = ', endsWith: /;$/ },
    { header: 'const COM_TABLES = ', endsWith: /;$/ },
    { header: 'function monthlyInScope(' },
    { header: 'function monthlyOnly(' },
    { header: 'function resTables(' },
    { header: 'function comTables(' },
  ],
  ['SEARCHABLE_TABLES', 'RES_TABLES', 'COM_TABLES', 'resTables', 'comTables'],
  'type SearchQuery = { deal?: string; rentPeriod?: string; dealCombined?: boolean };\n',
);
const INVENTORY = scope.SEARCHABLE_TABLES as string[];
const resT = scope.resTables as (q: ScopeQ) => string[];
const comT = scope.comTables as (q: ScopeQ) => string[];
const isMonthlyOnlySrc = (t: string) => /^(gathern|aqarmonthly)_/.test(t);

check('the searchable inventory lifted and is plausibly the fleet', INVENTORY.length >= 50,
  `got ${INVENTORY.length} table(s)`);

// TOTALITY — every inventory table reachable in some mode, and no mode inventing one outside it.
// A table that falls out of every mode is the original bug wearing different clothes.
const widest = new Set([...resT({ dealCombined: true }), ...comT({ dealCombined: true })]);
check('every inventory table is reachable in at least one search mode',
  INVENTORY.every((t) => widest.has(t)),
  `${INVENTORY.filter((t) => !widest.has(t)).join(', ')} — in the inventory, returnable by NO search`);
check('no mode invents a table outside the inventory',
  [...widest].every((t) => INVENTORY.includes(t)),
  `${[...widest].filter((t) => !INVENTORY.includes(t)).join(', ')}`);

// DERIVATION — the two kinds must be a PARTITION of the inventory by suffix, not two curated lists.
// Executed, so a re-hardcoded pair that happens to be complete today still fails the moment the
// inventory line moves without it.
const suffix = (sfx: string) => INVENTORY.filter((t) => t.endsWith(sfx) && !isMonthlyOnlySrc(t)).sort();
check('RES_TABLES is exactly the inventory\'s non-monthly residential tables',
  JSON.stringify((scope.RES_TABLES as string[]).slice().sort()) === JSON.stringify(suffix('_residential_listings')),
  'the residential scope is no longer derived from the inventory — that is the drift class itself');
check('COM_TABLES is exactly the inventory\'s non-monthly commercial tables',
  JSON.stringify((scope.COM_TABLES as string[]).slice().sort()) === JSON.stringify(suffix('_commercial_listings')),
  'the commercial scope is no longer derived from the inventory — that is the drift class itself');

// THE MONTHLY-ONLY CONDITIONAL — a product rule (Gathern is rent-only and monthly-only; it must
// never appear in a Buy result, CLAUDE.md), so it is executed over every mode the Filter produces.
const monthlySources = INVENTORY.filter(isMonthlyOnlySrc).sort();
check('the inventory contains monthly-only sources to gate', monthlySources.length >= 2,
  `got ${monthlySources.join(', ') || '(none)'} — otherwise every gate assertion below is vacuous`);
for (const [label, q, wantMonthly] of [
  ['Buy', { deal: 'Buy' }, false],
  ['Rent · annual', { deal: 'Rent', rentPeriod: 'annual' }, false],
  ['Rent · no period', { deal: 'Rent' }, false],
  ['Rent · monthly', { deal: 'Rent', rentPeriod: 'monthly' }, true],
  ['Rent · both periods', { deal: 'Rent', rentPeriod: 'both' }, true],
  ['Buy+Rent combined', { dealCombined: true }, true],
] as Array<[string, ScopeQ, boolean]>) {
  const got = [...resT(q), ...comT(q)].filter(isMonthlyOnlySrc).sort();
  check(`${label} → monthly-only sources ${wantMonthly ? 'IN' : 'OUT'}`,
    JSON.stringify(got) === JSON.stringify(wantMonthly ? monthlySources : []),
    `got [${got.join(', ')}]`);
}


console.log(failures === 0
  ? '\n✓ Trending is built from the full filter state (live honouring: verify-trending-filter-state-live.ts)\n'
  : `\n✗ ${failures} check(s) FAILED — Trending is describing a different set than the user selected\n`);
process.exit(failures === 0 ? 0 : 1);
