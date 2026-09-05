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
const SHAPE = /^(?:export )?function ([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\(([^)]*)\)\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:<[^>]*>)?\[\])\s*\{/;
const found: string[] = [];
for (const file of [SEARCH, DIVERSITY]) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = SHAPE.exec(line);
    if (!m) continue;
    const [, name, params, ret] = m;
    // The first parameter must be an array of the SAME type the function returns. `string[]` helper
    // builders (budgetLines, notes, …) take a query, not a list, so they never match.
    const firstParamType = (params.split(',')[0] ?? '').split(':').slice(1).join(':').trim();
    if (firstParamType !== ret) continue;
    found.push(name);
  }
}

const registered = new Set(REGISTRY.map((s) => s.name));
const unregistered = found.filter((n) => !registered.has(n));
check(unregistered.length === 0,
  `every X[] → X[] stage in the result path is registered (${found.length} found)`,
  `UNREGISTERED post-match stage(s): ${unregistered.join(', ')} — a stage that transforms the ` +
  `result list must declare whether it is a permutation or a subset, and be proven never to ` +
  `introduce a listing the match did not produce. Add it to REGISTRY in this file.`);

check(found.length >= 7,
  `discovery still sees the result path (${found.length} stages)`,
  `discovery found only ${found.length} stages — the scan has stopped matching (a reformat, a moved ` +
  `file, or a signature style change) and this guard is now blind`);

// ── EXECUTION: run each stage and compare sets by id ──────────────────────────────────────────
const PRELUDE = `
type Listing = Record<string, any>;
type SearchQuery = Record<string, any>;
type SortKey = string;
const CITY_TO_REGION: Record<string, string> = {};
const listingPriceValue = (p: any) => Number(p) || 0;
const exactSizeTarget = (_q: any) => null;
const priceOf = (l: any) => l.priceValue ?? 0;
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
const SAMPLE = Array.from({ length: 24 }, (_, i) => ({
  id: i + 1,
  source: ['aqar', 'wasalt', 'gathern', 'dealapp'][i % 4],
  regionAr: ['الرياض', 'مكة', 'الشرقية'][i % 3],
  city: ['الرياض', 'جدة', 'الدمام'][i % 3],
  area: 100 + i, beds: (i % 5) + 1, priceValue: 1000 * (i + 1), ppm: 10 + i, rec: i,
  price: String(1000 * (i + 1)),
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

const run = (name: string): { id: number }[] => {
  const f = (lifted as Record<string, any>)[name] ?? (diversity as Record<string, any>)[name];
  switch (name) {
    case 'sortListings':      return f(SAMPLE.slice(), 'price_asc');
    case 'diversifyByRegion': return f(SAMPLE.slice());
    case 'diversifyBySource': return f(SAMPLE.slice());
    case 'shuffle':           return f(SAMPLE.slice());
    case 'naturalSpread':     return f(SAMPLE.slice(), (x: any) => x.source);
    case 'interleaveRanked':  return f(SAMPLE.map((l) => ({ l, keys: [l.source] })), ['source']).map((r: any) => r.l);
    case 'orderByScope':      return f(SAMPLE.map((l) => ({ l, keys: [l.source] })), 'city').map((r: any) => r.l);
    // A real budget cap, so the relevance tiers actually split — a single tier would make the
    // concatenation trivially order-preserving and prove nothing.
    case 'rankResults':       return f(SAMPLE.slice(), {}, 12000);
    default: throw new Error(`no execution harness for stage ${name}`);
  }
};

for (const stage of REGISTRY) {
  let out: { id: number }[];
  try {
    out = run(stage.name);
  } catch (e) {
    problems.push(`${stage.name}: could not be executed — ${(e as Error).message}`);
    continue;
  }
  const bad = violates(stage.kind, SAMPLE, out);
  check(bad === null,
    `${stage.name} (${stage.kind}) never introduces an ineligible listing — ${stage.why}`,
    `${stage.name} VIOLATES MATCH FIRST: ${bad}`);
}

// The one thing execution cannot show: rankResults must never REACH for rows. A stage that fetches
// can introduce a listing the match never produced no matter how well it permutes what it was given.
const rankSrc = readFileSync(SEARCH, 'utf8');
const rankBody = rankSrc.slice(rankSrc.indexOf('function rankResults('), rankSrc.indexOf('function rankResults(') + 1200);
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
mustCatch('a new unregistered X[] → X[] stage appearing in the result path',
  SHAPE.test('function preferListingsWithPhotos(rows: Listing[]): Listing[] {') &&
  !registered.has('preferListingsWithPhotos'));

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
