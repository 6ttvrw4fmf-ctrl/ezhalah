// MATCH FIRST — no post-match stage may introduce an ineligible listing (owner rule, 2026-09-04).
//
// The eligible set is decided ONCE, by matching. Everything that happens to the result list after
// that — diversity, platform round-robin, natural spread, rotation, sorting, ranking, pagination —
// may reorder it and may show a page of it, and may NEVER add a member the match did not produce.
// "Never widen the search to satisfy diversity" is the owner's phrasing; the machine-checkable form
// is a set relation:
//
//     for every post-match stage S:  ids(S(input)) ⊆ ids(input),  and no duplicates
//     and for a PERMUTATION stage:   ids(S(input)) === ids(input)
//
// Every one of these stages already satisfies that today. This guard exists for a different reason:
// nothing ENUMERATED them. The invariant was asserted per-stage, ad hoc, by whichever barrier
// happened to be written when that stage landed — so a NEW stage added tomorrow (a photo
// preference that drops photoless rows, a rotation that pulls in a filler card, a "you might also
// like" splice) would be completely unguarded, and the first sign of it would be a user seeing a
// listing that does not match their filters.
//
// So this barrier has two halves and needs both:
//
//   EXECUTION — every registered stage is RUN against a synthetic list and its output compared to
//     its input BY ID. Not a source-text tripwire. The five defects of 2026-09-04 all had a barrier
//     over the exact line and all of those barriers were green the whole time the defect was live
//     (AGENTS.md, "A FAILED FETCH IS NOT AN EMPTY ANSWER"), because reading a line is not running it.
//
//   DISCOVERY — the result-path modules are scanned for the SHAPE of a post-match stage: a function
//     taking an array and returning the same array type (`X[] → X[]`). Every one found must be in
//     the registry. A new stage is therefore red until someone registers it and states which kind it
//     is, which is the only direction this can safely fail in.
//
// A builder is not a stage: `pool(rows: Row[]): Listing[]` CONSTRUCTS listings from raw rows and
// changes type, so it is outside the `X[] → X[]` shape by construction rather than by exemption.
//
// Run: node --experimental-strip-types scripts/verify-match-first-stages-are-order-only.ts

import { readFileSync } from 'node:fs';
import { join as __join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { liftSymbols } from './lib/liftSymbols.ts';

const REPO_ROOT = __join(import.meta.dirname, '..');
const SEARCH = __join(REPO_ROOT, 'src/data/search.ts');
const DIVERSITY = __join(REPO_ROOT, 'src/lib/platformDiversity.ts');

const ok: string[] = [];
const problems: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// PERMUTATION = the set must come back identical (reorder only).
// SUBSET      = the stage is allowed to show fewer (a page, a cap) but never more, and never a
//               member that was not in the input.
type Kind = 'permutation' | 'subset';
type Stage = { name: string; kind: Kind; why: string };

const REGISTRY: Stage[] = [
  { name: 'sortListings',      kind: 'permutation', why: 'objective sorts reorder; a sort that loses or gains a row is a defect' },
  { name: 'diversifyByRegion', kind: 'permutation', why: 'round-robin across regions — interleave, never select' },
  { name: 'diversifyBySource', kind: 'permutation', why: 'round-robin across platforms; the owner rule is diversity NEVER invents inventory' },
  { name: 'naturalSpread',     kind: 'permutation', why: 'greedy de-cluster: "never skip, cap, or reserve a slot"' },
  { name: 'shuffle',           kind: 'permutation', why: 'a shuffle that drops an element is the classic Fisher-Yates off-by-one' },
  { name: 'rankResults',       kind: 'permutation', why: 'tiers by relevance and concatenates every tier back — its `cap` is the BUDGET, not a result count, so it must return the identical set' },
  { name: 'interleaveRanked',  kind: 'permutation', why: 'platform interleave in the server ordering path' },
  { name: 'orderByScope',      kind: 'permutation', why: 'THE diversity stage; already proven order-only by verify-platform-diversity check 11, pinned here as part of the enumerated set' },
];

// ── DISCOVERY: is the registry complete? ──────────────────────────────────────────────────────
// A post-match stage has the shape `(…: X[], …): X[]`. Anything matching that in the result path
// and not registered is an unguarded stage.
// TWO SHAPES, AND PARAMS MAY CONTAIN PARENTHESES (widened 2026-09-04 by routine #10).
//
// The first version matched only `function name(…)` with a parameter list containing NO `)`, which
// made the DISCOVERY half — the entire reason this barrier says it exists ("a NEW stage added
// tomorrow … would be completely unguarded") — blind to the two most likely ways a new stage gets
// written here:
//   * an arrow const: `export const preferListingsWithPhotos = (rows: Listing[]): Listing[] => {`
//     was invisible, and that is this codebase's dominant declaration style;
//   * a callback parameter: `[^)]*` cannot cross the `)` in `key: (x: T) => string`, so the REAL,
//     ALREADY-REGISTERED `naturalSpread<T>(items: T[], key: (x: T) => string): T[]` was never
//     discovered either. Measured: discovery reported 7 stages for a registry of 8, and the
//     `found.length >= 7` floor was sitting exactly on that hole rather than exposing it.
// Widened and re-measured: discovery now finds all 8 registered stages and no unregistered ones, so
// the floor rises to the real number.
const FN_SHAPE = /^(?:export )?function ([A-Za-z_]\w*)(?:<[^>]*>)?\((.*)\)\s*:\s*([A-Za-z_]\w*(?:<[^>]*>)?\[\])\s*\{/;
const ARROW_SHAPE = /^(?:export )?const ([A-Za-z_]\w*)\s*=\s*(?:<[^>]*>)?\((.*)\)\s*:\s*([A-Za-z_]\w*(?:<[^>]*>)?\[\])\s*=>/;
const SHAPES = [FN_SHAPE, ARROW_SHAPE];

/** The declared name of a post-match stage on this line, or null. Pure, so a mutant can be fed in. */
export function stageOnLine(line: string): string | null {
  for (const re of SHAPES) {
    const m = re.exec(line);
    if (!m) continue;
    const [, name, params, ret] = m;
    // The first parameter must be an array of the SAME type the function returns. `string[]` helper
    // builders (budgetLines, notes, …) take a query, not a list, so they never match. Split on the
    // top-level comma only, so a callback parameter does not truncate the first type.
    const firstParamType = (params.split(/,(?![^(]*\))/)[0] ?? '').split(':').slice(1).join(':').trim();
    if (firstParamType === ret) return name;
  }
  return null;
}

const found: string[] = [];
for (const file of [SEARCH, DIVERSITY]) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const name = stageOnLine(line);
    if (name) found.push(name);
  }
}

const registered = new Set(REGISTRY.map((s) => s.name));
const unregistered = found.filter((n) => !registered.has(n));
check(unregistered.length === 0,
  `every X[] → X[] stage in the result path is registered (${found.length} found)`,
  `UNREGISTERED post-match stage(s): ${unregistered.join(', ')} — a stage that transforms the ` +
  `result list must declare whether it is a permutation or a subset, and be proven never to ` +
  `introduce a listing the match did not produce. Add it to REGISTRY in this file.`);

check(found.length >= REGISTRY.length,
  `discovery still sees the whole result path (${found.length} stages, registry holds ${REGISTRY.length})`,
  `discovery found only ${found.length} of ${REGISTRY.length} registered stages — the scan has stopped ` +
  `matching (a reformat, a moved file, or a signature style change) and this guard is now partly blind`);

// ── EXECUTION: run each stage and compare sets by id ──────────────────────────────────────────
const PRELUDE = `
type Listing = Record<string, any>;
type SearchQuery = Record<string, any>;
type SortKey = string;
const CITY_TO_REGION: Record<string, string> = {};
const listingPriceValue = (p: any) => Number(p) || 0;
const exactSizeTarget = (_q: any) => null;
const priceOf = (l: any) => l.priceValue ?? 0;
// The sort/ranking key and the annual-rent reconstruction it is built from (2026-09-06). Shimmed for
// the same reason priceOf and byValue are: this file's object is the SET relation
// ids(S(input)) ⊆ ids(input), which no price key can change. Their real semantics are executed by
// scripts/verify-rent-price-basis-is-the-rpc-basis.ts.
const rentAnnualValue = (l: any) => l.priceValue ?? 0;
const sortPriceOf = (l: any) => priceOf(l);
const ppm = (l: any) => l.ppm ?? 0;
const recency = (l: any) => l.rec ?? 0;
const byValue = (f: (l: any) => number, dir: number) => (a: any, b: any) => (f(a) - f(b)) * dir;
function interleave<T>(groups: T[][]): T[] {
  const out: T[] = []; let i = 0; let any = true;
  while (any) { any = false; for (const g of groups) { if (i < g.length) { out.push(g[i]); any = true; } } i++; }
  return out;
}
`;

const lifted = await liftSymbols(SEARCH, [
  { header: 'function sortListings(' },
  { header: 'function diversifyByRegion(' },
  { header: 'function diversifyBySource(' },
  { header: 'function shuffle<T>(' },
  { header: 'function naturalSpread<T>(' },
  { header: 'function closenessBonus(' },
  { header: 'function rankResults(' },
], ['sortListings', 'diversifyByRegion', 'diversifyBySource', 'shuffle', 'naturalSpread', 'rankResults'], PRELUDE);

const diversity = await import(DIVERSITY);

// A synthetic result set with distinct ids across several platforms, regions and cities — enough
// structure that every stage has something real to reorder.
//
// EVERY FIELD THE DIVERSITY KEYS READ IS POPULATED (2026-09-18, routine #10, ops_incident #273).
// It used to carry only source/region/city/price, and the ranked stages were fed
// `{ l, keys: [l.source] }`. `rankedKey()` reads cleanType, rentPeriod, deal and district, and
// `listingHasPhoto()` reads `photos` — all absent, so every one of those keys folded to the single
// group '∅' and the nested diversity levels NEVER ENGAGED even on the path the harness did call.
// A set-preservation proof over a stage whose recursion never recurses proves the base case only.
// Photos are deliberately present on some rows and absent on others: a leaf preference that is
// uniform across the input cannot reorder anything, and so cannot drop anything either.
const SAMPLE = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  source: ['aqar', 'wasalt', 'gathern', 'dealapp'][i % 4],
  regionAr: ['الرياض', 'مكة', 'الشرقية'][i % 3],
  city: ['الرياض', 'جدة', 'الدمام'][i % 3],
  district: ['العليا', 'النرجس', 'الملقا', 'الياسمين'][i % 4],
  cleanType: ['شقة', 'فيلا', 'استوديو', 'دور'][i % 4],
  rentPeriod: ['monthly', 'annual', null][i % 3],
  deal: i % 2 === 0 ? 'Rent' : 'Buy',
  photos: i % 3 === 0 ? [] : [`https://example.invalid/${i}.jpg`],
  area: 100 + i, beds: (i % 5) + 1, priceValue: 1000 * (i + 1), ppm: 10 + i, rec: i,
  price: String(1000 * (i + 1)),
}));

// The ranked-row shape the two platformDiversity stages actually consume in production
// (src/data/remote.ts:1746 hands them rows carrying platform/city/region/district/rank).
const RANKED = SAMPLE.map((l, i) => ({
  l,
  platform: l.source,
  city: l.city,
  region: l.regionAr,
  district: l.district,
  rank: i,
  source_table: l.source,
}));

const ids = (xs: readonly { id: number }[]) => xs.map((x) => x.id);
const setOf = (xs: readonly { id: number }[]) => new Set(ids(xs));

/** The invariant, as a predicate — reused by the mutation proofs below. */
function violates(kind: Kind, input: readonly { id: number }[], output: readonly { id: number }[]): string | null {
  const inSet = setOf(input);
  const outIds = ids(output);
  const added = outIds.filter((id) => !inSet.has(id));
  if (added.length) return `INTRODUCED ineligible listing id(s) ${added.join(', ')}`;
  if (new Set(outIds).size !== outIds.length) return 'DUPLICATED a listing';
  if (kind === 'permutation' && outIds.length !== input.length) {
    return `dropped ${input.length - outIds.length} listing(s) — a permutation stage must return the identical set`;
  }
  return null;
}

// ── THE INVOCATION TABLE ──────────────────────────────────────────────────────────────────────
// The arguments are DATA, not a switch body, for one reason: a check that hand-writes a call
// cannot see that the call has fallen behind the function. Expressed as a table, the arguments can
// be COUNTED, and the ARITY COVERAGE check below compares them against the real declared signature.
//
// How this was earned (ops_incident #273, routine #8 → routine #10, 2026-09-18). The previous
// switch invoked `orderByScope(rows, 'city')` — two arguments against a five-parameter signature.
// `preferPhotos: true` is passed on EVERY production search (src/data/remote.ts:1746), and the
// branch it opens is a re-sort at the diversity leaf. So the MATCH FIRST proof — the barrier over
// an owner-locked permanent rule — had never once executed the code path production always takes.
// MEASURED, not reasoned: a mutant that made that leaf DROP photoless listings (`filter` before
// `sort`) left this guard, verify-platform-diversity.ts, and the entire `npm run test:all` suite
// GREEN. `interleaveRanked` carried the identical gap, unnamed by the incident: 3 declared
// parameters, 2 passed, so `opts` was never supplied there either.
type Invocation = { label: string; args: unknown[] };

// Ranked stages consume and return RankedRow[]; identity lives at `row.l.id`.
const unwrapRanked = (out: any[]): { id: number }[] => out.map((r) => r.l);

const SCOPES = ['country', 'region', 'city', 'district'] as const;

// The production parameter space, swept exhaustively: 4 scopes × multiType × mixPeriods × mixDeals
// × preferPhotos = 64 combinations. This is the sweep routine #8 ran by hand when it found the gap
// (0 violations over 600 rows); it is now part of the standing guard instead of a one-off.
const ORDER_BY_SCOPE: Invocation[] = [];
for (const scope of SCOPES)
  for (const multiType of [false, true])
    for (const mixPeriods of [false, true])
      for (const mixDeals of [false, true])
        for (const preferPhotos of [false, true])
          ORDER_BY_SCOPE.push({
            label: `scope=${scope} multiType=${multiType} mixPeriods=${mixPeriods} mixDeals=${mixDeals} preferPhotos=${preferPhotos}`,
            args: [RANKED.slice(), scope, multiType, mixPeriods, { mixDeals, preferPhotos }],
          });

// Key lists chosen so the recursion actually recurses: [] is the LEAF (where preferPhotos re-sorts
// and where the measured mutant lived), and the long list drives every level rankedKey() can build.
const INTERLEAVE: Invocation[] = [];
for (const keys of [[], ['platform'], ['platform', 'cleanType'],
                    ['platform', 'deal', 'period', 'cleanType', 'city', 'district']])
  for (const preferPhotos of [false, true])
    INTERLEAVE.push({
      label: `keys=[${keys.join(',')}] preferPhotos=${preferPhotos}`,
      args: [RANKED.slice(), keys, { preferPhotos }],
    });

const INVOCATIONS: Record<string, Invocation[]> = {
  sortListings:      [{ label: 'price_asc', args: [SAMPLE.slice(), 'price_asc'] },
                      { label: 'price_desc', args: [SAMPLE.slice(), 'price_desc'] }],
  diversifyByRegion: [{ label: 'default', args: [SAMPLE.slice()] }],
  diversifyBySource: [{ label: 'default', args: [SAMPLE.slice()] }],
  shuffle:           [{ label: 'default', args: [SAMPLE.slice()] }],
  naturalSpread:     [{ label: 'by source', args: [SAMPLE.slice(), (x: any) => x.source] }],
  // A real budget cap, so the relevance tiers actually split — a single tier would make the
  // concatenation trivially order-preserving and prove nothing.
  rankResults:       [{ label: 'capped budget', args: [SAMPLE.slice(), {}, 12000] }],
  interleaveRanked:  INTERLEAVE,
  orderByScope:      ORDER_BY_SCOPE,
};

const RANKED_STAGES = new Set(['interleaveRanked', 'orderByScope']);

let executions = 0;
for (const stage of REGISTRY) {
  const invocations = INVOCATIONS[stage.name];
  if (!invocations?.length) {
    problems.push(`${stage.name}: no invocation in the table — a registered stage that is never ` +
      `executed is enumerated, not guarded`);
    continue;
  }
  const f = (lifted as Record<string, any>)[stage.name] ?? (diversity as Record<string, any>)[stage.name];
  if (typeof f !== 'function') {
    problems.push(`${stage.name}: could not be resolved to a function to execute`);
    continue;
  }
  const ranked = RANKED_STAGES.has(stage.name);
  const input = ranked ? unwrapRanked(RANKED) : SAMPLE;
  let failed: string | null = null;
  for (const inv of invocations) {
    let out: { id: number }[];
    try {
      const raw = f(...inv.args);
      out = ranked ? unwrapRanked(raw) : raw;
    } catch (e) {
      failed = `could not be executed [${inv.label}] — ${(e as Error).message}`;
      break;
    }
    executions++;
    const bad = violates(stage.kind, input, out);
    if (bad) { failed = `${bad} [${inv.label}]`; break; }
  }
  check(failed === null,
    `${stage.name} (${stage.kind}) never introduces an ineligible listing across ` +
    `${invocations.length} invocation(s) — ${stage.why}`,
    `${stage.name} VIOLATES MATCH FIRST: ${failed}`);
}

// ── ARITY COVERAGE: the harness may not fall behind the function ──────────────────────────────
// THE META-BARRIER (2026-09-18, routine #10, ops_incident #273). The DISCOVERY half above finds a
// NEW STAGE by shape. Nothing noticed a REGISTERED stage GAINING A PARAMETER — and that is how the
// gap above was born: `orderByScope` grew `mixDeals`/`preferPhotos` on 2026-09-14 (ebfbe5d,
// dd66e94) and the two-argument call written before them kept passing, silently proving less every
// time the function grew. A barrier pins the shapes that existed when it was written; this check is
// what makes that stop being true here.
//
// NOT `Function.prototype.length`. That counts parameters only up to the first defaulted one, so
// `orderByScope(rows, scope, multiType = false, mixPeriods = false, opts?)` reports 2 — EXACTLY the
// number the blind harness was passing. A check built on `.length` would have been vacuously green
// on the very defect it exists to catch. The declaration is read from source instead.

/**
 * The declared parameter list of a top-level function, split at top-level commas. Pure, so a
 * mutant signature can be fed straight in. Returns null when the signature cannot be read — a
 * parameter list this cannot parse reads as UNKNOWN and fails the check, never as "zero
 * parameters, all covered" (AGENTS.md: a failed read is not an empty answer).
 */
export function declaredParams(src: string, fnName: string): string[] | null {
  const m = new RegExp(`(?:export )?function ${fnName}\\s*(?:<[^>]*>)?\\(`).exec(src);
  if (!m) return null;
  const out: string[] = [];
  let depth = 1;
  let cur = '';
  let i = m.index + m[0].length;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    // `=>` inside a callback parameter is not a closing angle bracket.
    const isArrow = c === '>' && src[i - 1] === '=';
    if (c === '(' || c === '{' || c === '[' || c === '<') depth++;
    else if (!isArrow && (c === ')' || c === '}' || c === ']' || c === '>')) {
      depth--;
      if (depth === 0) break;
    }
    if (depth === 1 && c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (depth !== 0) return null;              // unbalanced → unreadable, never "no parameters"
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The keys of an inline object-typed parameter (`opts?: { a?: boolean; b?: boolean }`). Pure. */
export function declaredOptionKeys(param: string): string[] {
  const open = param.indexOf('{');
  const close = param.lastIndexOf('}');
  if (open === -1 || close < open) return [];
  return param.slice(open + 1, close).split(';')
    .map((s) => /^([A-Za-z_]\w*)\??\s*:/.exec(s.trim())?.[1] ?? null)
    .filter((s): s is string => s !== null);
}

/**
 * Every declared parameter of every registered stage must be supplied by at least one invocation,
 * and every key of an options parameter must be exercised. Pure over (source, invocations) so both
 * directions can be proven below.
 */
export function arityGaps(
  sources: Record<string, string>,
  registry: readonly { name: string }[],
  invocations: Record<string, Invocation[]>,
): string[] {
  const gaps: string[] = [];
  for (const { name } of registry) {
    const src = Object.values(sources).find((s) => new RegExp(`function ${name}\\s*[<(]`).test(s));
    if (src === undefined) { gaps.push(`${name}: declaration not found in the result path`); continue; }
    const params = declaredParams(src, name);
    if (params === null) { gaps.push(`${name}: signature could not be read (UNKNOWN, not covered)`); continue; }
    const calls = invocations[name] ?? [];
    const widest = Math.max(0, ...calls.map((c) => c.args.length));
    if (widest < params.length) {
      gaps.push(`${name}: declares ${params.length} parameter(s) but the harness passes at most ` +
        `${widest} — ${params.slice(widest).join(' | ')} is never exercised`);
      continue;
    }
    // An options object is one argument however many knobs it hides, so count its KEYS too.
    params.forEach((p, idx) => {
      const keys = declaredOptionKeys(p);
      if (!keys.length) return;
      const missing = keys.filter((k) => !calls.some((c) => {
        const a = c.args[idx];
        return !!a && typeof a === 'object' && k in (a as Record<string, unknown>);
      }));
      if (missing.length) {
        gaps.push(`${name}: option key(s) ${missing.join(', ')} declared on parameter ${idx + 1} ` +
          `but never supplied by any invocation`);
      }
    });
  }
  return gaps;
}

const STAGE_SOURCES = { search: readFileSync(SEARCH, 'utf8'), diversity: readFileSync(DIVERSITY, 'utf8') };
const gaps = arityGaps(STAGE_SOURCES, REGISTRY, INVOCATIONS);
check(gaps.length === 0,
  `every registered stage is executed across its FULL declared signature (${executions} invocations)`,
  `the harness has fallen behind the code it proves:\n      - ${gaps.join('\n      - ')}`);

// The one thing execution cannot show: rankResults must never REACH for rows. A stage that fetches
// can introduce a listing the match never produced no matter how well it permutes what it was given.
// BOUNDED BY THE REAL TERMINATOR, NOT BY A FIXED 1,200 CHARACTERS (hardened 2026-09-04, routine #10).
// Measured honestly: rankResults is 1,038 characters today, so the old fixed window did cover the
// whole function — this was NOT a live blindness, and nothing slipped past it. It was correct by
// luck. The window is a constant and the function is not: the day rankResults grows past 1,200 chars,
// the check silently starts reading a prefix and says nothing about the rest. The body is now bounded
// by its own terminator — a `}` in column 0 — and the slice ASSERTS it found one, so a reformat fails
// loudly here instead of quietly shrinking the window.
const rankSrc = readFileSync(SEARCH, 'utf8');
const rankStart = rankSrc.indexOf('function rankResults(');
const rankEnd = rankSrc.indexOf('\n}\n', rankStart);
check(rankStart > -1 && rankEnd > rankStart,
  `rankResults body located by its real bounds (${rankEnd - rankStart} chars, not a fixed window)`,
  'rankResults could not be bounded — the no-fetch check below would be reading an arbitrary slice');
const rankBody = rankSrc.slice(rankStart, rankEnd > rankStart ? rankEnd : rankStart + 1200);
const REACHES = /await |fetch\(|supabase|\brpc\(|pools\./;
check(!REACHES.test(rankBody),
  'rankResults performs no fetch — it can only reorder what the match handed it',
  'rankResults now reaches for rows — a ranking stage that fetches can introduce a listing the match never produced');

check(npmTestRuns(REPO_ROOT, 'verify-match-first-stages-are-order-only'),
  'npm test runs this guard',
  '`npm test` no longer runs verify-match-first-stages-are-order-only.ts — the guard is inert');

// ── Mutation proofs ───────────────────────────────────────────────────────────────────────────
const mutations: string[] = [];
const mustCatch = (what: string, wouldFail: boolean) =>
  wouldFail ? mutations.push(what) : problems.push(`MUTATION SURVIVED: ${what} would NOT be caught`);

const FILLER = { id: 9999 };
mustCatch('a stage splicing in a listing the match never produced (the widening the owner named)',
  violates('permutation', SAMPLE, [...SAMPLE, FILLER]) !== null);
mustCatch('a stage showing the same listing twice',
  violates('permutation', SAMPLE, [...SAMPLE, SAMPLE[0]]) !== null);
mustCatch('a permutation stage quietly dropping a match',
  violates('permutation', SAMPLE, SAMPLE.slice(1)) !== null);
mustCatch('a SUBSET stage still being caught when it ADDS (a cap is not a licence to widen)',
  violates('subset', SAMPLE, [...SAMPLE.slice(0, 5), FILLER]) !== null);
mustCatch('a subset stage legitimately returning a page — this must NOT be flagged',
  violates('subset', SAMPLE, SAMPLE.slice(0, 10)) === null);
mustCatch('a ranking stage that starts fetching its own rows',
  REACHES.test('  const extra = await supabase.rpc(\'more_listings_ar\', {});'));
// DISCOVERY, proven in every declaration style a new stage could plausibly use. The original proof
// tested only the `function` form — the one form the old regex already matched — so it passed while
// discovery was blind to arrow consts and to callback parameters.
for (const [style, decl] of [
  ['a plain function', 'function preferListingsWithPhotos(rows: Listing[]): Listing[] {'],
  ['an exported arrow const', 'export const preferListingsWithPhotos = (rows: Listing[]): Listing[] => {'],
  ['an arrow const', 'const preferListingsWithPhotos = (rows: Listing[]): Listing[] => {'],
  ['a stage taking a callback', 'function preferListingsWithPhotos(rows: Listing[], key: (x: Listing) => string): Listing[] {'],
] as const) {
  mustCatch(`a new unregistered stage declared as ${style}`,
    stageOnLine(decl) === 'preferListingsWithPhotos' && !registered.has('preferListingsWithPhotos'));
}
mustCatch('…while a BUILDER that changes type is still not mistaken for a stage (no false alarm)',
  stageOnLine('function pool(rows: Row[]): Listing[] {') === null);
mustCatch('…and the callback-parameter shape that was silently missed is now a REAL discovery ' +
  '(naturalSpread, already in the registry, is found by the scan instead of only by the registry)',
  found.includes('naturalSpread'));
// The bound is real, and it grows with the function instead of stopping at a constant: a fetch
// appended to the ACTUAL body — i.e. rankResults having grown — is still seen.
mustCatch('a fetch appended to the real rankResults body, wherever the function grows to',
  REACHES.test(`${rankBody}\n  const extra = await supabase.rpc('more_listings_ar', {});`));

// ── ARITY COVERAGE, proven in both directions ────────────────────────────────────────────────
// The defect this replaces is not hypothetical: it was LIVE for four days and measured. A mutant
// that dropped photoless listings at the diversity leaf survived a green `npm run test:all`.
const GREW = `export function orderByScope<L extends { cleanType?: string | null }>(rows: RankedRow<L>[], scope: Scope, multiType = false, mixPeriods = false, opts?: { mixDeals?: boolean; preferPhotos?: boolean }): RankedRow<L>[] {`;
mustCatch('the REAL defect: a 5-parameter stage invoked with 2 arguments (the shape that let a ' +
  'photoless-listing DROP survive a green suite for four days)',
  arityGaps({ d: GREW }, [{ name: 'orderByScope' }],
    { orderByScope: [{ label: 'old', args: [[], 'city'] }] }).length > 0);
mustCatch('…while the repaired invocation over the same signature is NOT flagged (the check is ' +
  'not vacuously red — this is the negative control Prohibition 1 requires)',
  arityGaps({ d: GREW }, [{ name: 'orderByScope' }],
    { orderByScope: [{ label: 'new', args: [[], 'city', false, false, { mixDeals: true, preferPhotos: true }] }] }).length === 0);
mustCatch('an options object that gains a KEY the harness never supplies (arity alone would miss ' +
  'it — one argument can hide any number of knobs)',
  arityGaps({ d: GREW }, [{ name: 'orderByScope' }],
    { orderByScope: [{ label: 'partial', args: [[], 'city', false, false, { mixDeals: true }] }] }).length > 0);
mustCatch('a stage whose signature cannot be parsed reads as UNKNOWN, never as "no parameters, ' +
  'all covered"',
  declaredParams('export function orderByScope(rows: T[], scope: Scope', 'orderByScope') === null);
mustCatch('a registered stage with NO invocation at all is caught rather than silently skipped',
  arityGaps({ d: GREW }, [{ name: 'orderByScope' }], {}).length > 0);
mustCatch('…and a callback parameter does not truncate the parameter count (`=>` is not a closing ' +
  'angle bracket)',
  declaredParams('function naturalSpread<T>(items: T[], key: (x: T) => string): T[] {', 'naturalSpread')?.length === 2);
mustCatch('the declared signature is read from SOURCE, not from Function.prototype.length — which ' +
  'stops at the first defaulted parameter and would report exactly the 2 the blind harness passed',
  ((_rows: unknown[], _scope: string, _multiType = false, _mixPeriods = false, _opts?: object) => 0).length === 2
    && declaredParams(GREW, 'orderByScope')?.length === 5);
// The enriched SAMPLE is what makes the executed half mean anything: a leaf preference over rows
// that are uniform in the field it reads cannot reorder, and so cannot drop.
mustCatch('the sample actually splits on the field the photo preference reads (a uniform input ' +
  'would make the preferPhotos branch a no-op and prove nothing)',
  SAMPLE.some((l) => l.photos.length > 0) && SAMPLE.some((l) => l.photos.length === 0));
mustCatch('…and on the keys the nested diversity levels group by, so the recursion really recurses',
  new Set(SAMPLE.map((l) => l.cleanType)).size > 1 && new Set(SAMPLE.map((l) => l.deal)).size > 1
    && new Set(SAMPLE.map((l) => l.district)).size > 1 && new Set(SAMPLE.map((l) => l.rentPeriod)).size > 1);
mustCatch('…and the bound is the function\'s own terminator, not a fixed window',
  rankEnd > rankStart && rankSrc.slice(rankEnd, rankEnd + 3) === '\n}\n');

console.log(
  'match-first: the eligible set is decided by matching, and every stage after it may reorder\n' +
  '             or page — never introduce a listing the match did not produce\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const m of mutations) console.log(`  ✓ mutation caught: ${m}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — MATCH FIRST is no longer enforced across the result path.`);
  process.exit(1);
}
console.log(`\n✅ match-first: passed (${ok.length} checks, ${mutations.length} mutations, ${found.length} stages discovered).`);
