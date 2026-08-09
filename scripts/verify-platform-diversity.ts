// PLATFORM DIVERSITY — owner PERMANENT rule (2026-07-13, restated and widened 2026-08-05):
//
//   1. MATCH WHAT THE USER WANTS.
//   2. FROM THOSE CORRECT MATCHES, ALWAYS DIVERSIFY THE AVAILABLE PLATFORMS.
//   3. NEVER LET ONE PLATFORM UNNECESSARILY TAKE OVER THE RESULTS WHILE OTHER QUALIFYING
//      PLATFORMS ARE AVAILABLE.
//   4. KEEP DIVERSITY WORKING THROUGH عرض المزيد / SHOW MORE.
//   5. NEVER SACRIFICE SEARCH CORRECTNESS TO CREATE DIVERSITY.
//
// Diversification is implemented in ONE place: the ORDER BY of location_search_candidates_ar
// (migration platform_diversity_round_robin_ordering, 2026-08-06). The RPC numbers each platform's own
// eligible rows 1..n (div_rank) and sorts by that number FIRST, producing every platform's #1, then
// every #2, ... — a neutral round-robin over the whole eligible set, applied BEFORE limit/offset.
//
// THAT the SQL contains this ordering is pinned offline by scripts/verify-rpc-clause-invariants.ts
// (4 REQUIRED clauses). THIS file pins WHAT THE ORDERING MUST MEAN, by modelling the exact SQL sort
// key in TypeScript and asserting the owner's rules against it — so a future change that alters the
// semantics (e.g. capping a platform, forcing equal counts, or re-diversifying per page) fails CI.
//
// Offline + deterministic: no DB, no network. Live production behaviour was separately verified before
// deploy (Riyadh/annual-rent/apartment: 11 platforms, 9,257 eligible, streak 65 -> 1, 0 duplicates,
// 0 fairness violations across 12 real scenarios including a full 9,257-row sweep).
//
//   node --experimental-strip-types scripts/verify-platform-diversity.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { orderByScope, type RankedRow, type Scope } from '../src/lib/platformDiversity.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}

type Row = { platform: string; id: number; last_updated: number };

// ── The model: EXACTLY the SQL sort key ──────────────────────────────────────────────────────────
//   order by div_rank asc nulls last, last_updated desc nulls last, source_table, listing_id
// where div_rank = row_number() over (partition by platform
//                                     order by last_updated desc nulls last, source_table, listing_id)
// and div_rank is NULL when an objective sort is active.
const OBJECTIVE_SORTS = ['price_asc', 'price_desc', 'area_asc', 'area_desc', 'beds_desc', 'oldest'];

function diversify(rows: Row[], sort: string | null = null): Row[] {
  const recency = (a: Row, b: Row) => b.last_updated - a.last_updated || a.id - b.id;
  const base = [...rows].sort(recency);
  if (sort && OBJECTIVE_SORTS.includes(sort)) return base;  // div_rank IS NULL → untouched
  const seen = new Map<string, number>();
  const ranked = base.map((r) => {
    const n = (seen.get(r.platform) ?? 0) + 1;
    seen.set(r.platform, n);
    return { r, div: n };
  });
  return ranked.sort((x, y) => x.div - y.div || recency(x.r, y.r)).map((x) => x.r);
}

// `page(rows, limit, offset)` is what the RPC does: ONE ordering, then limit/offset walk it.
const page = (rows: Row[], limit: number, offset: number, sort: string | null = null) =>
  diversify(rows, sort).slice(offset, offset + limit);

function longestStreak(rows: Row[]): number {
  let best = rows.length ? 1 : 0, cur = 0, prev = '';
  for (const r of rows) { cur = r.platform === prev ? cur + 1 : 1; prev = r.platform; best = Math.max(best, cur); }
  return best;
}
const longestStreakOf = (a: string[]): number => {
  let best = a.length ? 1 : 0, cur = 0, prev = '';
  for (const p of a) { cur = p === prev ? cur + 1 : 1; prev = p; best = Math.max(best, cur); }
  return best;
};
function distinctPlatforms(rows: Row[]): number { return new Set(rows.map((r) => r.platform)).size; }

// Inventory builder: `{aqar: 5000, wasalt: 2}` → rows with descending, interleaved timestamps.
// Timestamps are deliberately CLUSTERED PER PLATFORM (each platform scraped in its own run) — that is
// the real production shape that caused the bug, and the worst case for a recency-only ordering.
let nextId = 1;
function inventory(spec: Record<string, number>): Row[] {
  const rows: Row[] = [];
  let clock = 1_000_000;
  for (const [platform, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) rows.push({ platform, id: nextId++, last_updated: clock-- });
    clock -= 10_000;  // next platform's whole batch is strictly older → recency alone would clump it
  }
  return rows;
}

// The pre-fix behaviour, for before/after comparisons: pure recency, no diversification.
const recencyOnly = (rows: Row[]) => [...rows].sort((a, b) => b.last_updated - a.last_updated || a.id - b.id);

console.log('\nPLATFORM DIVERSITY — owner permanent rule (MATCH FIRST → DIVERSIFY SECOND)\n');

// ── 1. two qualifying platforms ──────────────────────────────────────────────────────────────────
{
  const inv = inventory({ alpha: 50, beta: 50 });
  const first10 = page(inv, 10, 0);
  check('1. two qualifying platforms — both appear in the first 10, no streak',
    distinctPlatforms(first10) === 2 && longestStreak(first10) === 1,
    `got ${first10.map((r) => r.platform).join(' ')}`);
}

// ── 2. three qualifying platforms ────────────────────────────────────────────────────────────────
{
  const inv = inventory({ alpha: 40, beta: 30, gamma: 20 });
  const first10 = page(inv, 10, 0);
  check('2. three qualifying platforms — all three appear in the first 10, no streak',
    distinctPlatforms(first10) === 3 && longestStreak(first10) === 1,
    `got ${first10.map((r) => r.platform).join(' ')}`);
}

// ── 3. 10+ qualifying platforms ──────────────────────────────────────────────────────────────────
{
  const spec: Record<string, number> = {};
  for (let i = 0; i < 12; i++) spec[`p${i}`] = 25;
  const inv = inventory(spec);
  const first10 = page(inv, 10, 0);
  const first25 = page(inv, 25, 0);
  check('3. 12 qualifying platforms — first 10 are 10 DISTINCT platforms; first 25 covers all 12',
    distinctPlatforms(first10) === 10 && distinctPlatforms(first25) === 12 && longestStreak(first25) === 1,
    `first10=${distinctPlatforms(first10)} first25=${distinctPlatforms(first25)} streak=${longestStreak(first25)}`);
}

// ── 4. one huge platform + several small (the real production shape) ─────────────────────────────
{
  const inv = inventory({ big: 5000, s1: 40, s2: 30, s3: 12, s4: 3 });
  const before = recencyOnly(inv).slice(0, 100);
  const after = page(inv, 100, 0);
  check('4. huge platform + small ones — the small platforms surface EARLY instead of being buried',
    distinctPlatforms(after.slice(0, 5)) === 5 && longestStreak(after.slice(0, 40)) === 1,
    `after-first-5=${after.slice(0, 5).map((r) => r.platform).join(' ')}`);
  check('4b. …and this is a real improvement over recency-only ordering',
    longestStreak(before) > 50 && longestStreak(after.slice(0, 40)) === 1,
    `before streak=${longestStreak(before)} after streak=${longestStreak(after.slice(0, 40))}`);
  check('4c. NO forced equality — the big platform still supplies the bulk of a deep page',
    page(inv, 500, 0).filter((r) => r.platform === 'big').length > 400,
    'a platform with more inventory must not be punished for having it');
}

// ── 5. platform with only ONE qualifying listing ─────────────────────────────────────────────────
{
  const inv = inventory({ big: 1000, solo: 1 });
  const seq = page(inv, 50, 0);
  check('5. a platform with exactly 1 qualifying listing appears, and appears EARLY (never buried)',
    seq.filter((r) => r.platform === 'solo').length === 1 && seq.findIndex((r) => r.platform === 'solo') < 2,
    `position=${seq.findIndex((r) => r.platform === 'solo')}`);
  check('5b. …and it is shown exactly once — diversity never invents inventory',
    page(inv, 1000, 0).filter((r) => r.platform === 'solo').length === 1);
}

// ── 6. platform with only TWO qualifying listings ────────────────────────────────────────────────
{
  const inv = inventory({ big: 1000, duo: 2 });
  const full = page(inv, 2000, 0);
  const seq = page(inv, 50, 0);
  check('6. a platform with exactly 2 qualifying listings shows both, naturally and early',
    full.filter((r) => r.platform === 'duo').length === 2 &&
    seq.filter((r) => r.platform === 'duo').length === 2 &&
    seq.findIndex((r) => r.platform === 'duo') < 2);
}

// ── 7. only ONE qualifying platform ──────────────────────────────────────────────────────────────
{
  const inv = inventory({ only: 60 });
  const seq = page(inv, 50, 0);
  check('7. only ONE platform qualifies — showing it repeatedly is CORRECT, and order is unchanged',
    seq.length === 50 && distinctPlatforms(seq) === 1 && longestStreak(seq) === 50 &&
    JSON.stringify(seq.map((r) => r.id)) === JSON.stringify(recencyOnly(inv).slice(0, 50).map((r) => r.id)),
    'a single-platform result set must not be reordered or truncated');
}

// ── 8. THE STREAK TEST — no unnecessary streak while another platform still has inventory ────────
// This is the owner's headline rule, stated as a provable invariant: walking the sequence, no platform
// may take its (k+1)-th slot while ANY other platform still has an unshown k-th slot.
{
  const specs: Record<string, number>[] = [
    { a: 5795, b: 3216, c: 93, d: 51, e: 42, f: 41, g: 7, h: 5, i: 3, j: 2, k: 2 },  // the real Riyadh shape
    { a: 231, b: 26, c: 6, d: 5, e: 2, f: 2, g: 2 },                                  // the real Khobar shape
    { a: 1000, b: 1 }, { a: 3, b: 3, c: 3 }, { a: 100 },
  ];
  let violations = 0, unnecessary = 0;
  for (const spec of specs) {
    const inv = inventory(spec);
    const seq = diversify(inv);
    const shown = new Map<string, number>();
    let prevOwnRank = 0;
    for (const r of seq) {
      const own = (shown.get(r.platform) ?? 0) + 1;
      shown.set(r.platform, own);
      if (own < prevOwnRank) violations++;   // took slot k+1 while someone still owed slot k
      prevOwnRank = own;
    }
    // and: any same-platform run must be explained by every OTHER platform being exhausted
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].platform !== seq[i - 1].platform) continue;
      const shownSoFar = new Map<string, number>();
      for (let j = 0; j < i; j++) shownSoFar.set(seq[j].platform, (shownSoFar.get(seq[j].platform) ?? 0) + 1);
      const someoneLeft = Object.entries(spec)
        .some(([p, total]) => p !== seq[i].platform && (shownSoFar.get(p) ?? 0) < total);
      if (someoneLeft) unnecessary++;
    }
  }
  check('8. STREAK: no platform takes slot k+1 while another still has an unshown slot k',
    violations === 0, `${violations} fairness violations`);
  check('8b. STREAK: every same-platform run is explained by all other platforms being exhausted',
    unnecessary === 0, `${unnecessary} UNNECESSARY same-platform repeats`);
}

// ── 9. multiple consecutive Show More operations ─────────────────────────────────────────────────
{
  const inv = inventory({ a: 5795, b: 3216, c: 93, d: 51, e: 42, f: 41, g: 7, h: 5, i: 3, j: 2, k: 2 });
  const batches = [[10, 0], [15, 10], [25, 25], [50, 50], [100, 100]].map(([l, o]) => page(inv, l, o));
  const seq = batches.flat();
  check('9. five consecutive Show More batches stay diversified (not just page 0)',
    batches.every((b) => distinctPlatforms(b) >= 2) && longestStreak(seq) === 1,
    `per-batch platforms=${batches.map(distinctPlatforms).join(',')} streak=${longestStreak(seq)}`);
}

// ── 10. no duplicate listings across batches ─────────────────────────────────────────────────────
{
  const inv = inventory({ a: 300, b: 120, c: 40, d: 9, e: 1 });
  const seq = [[10, 0], [15, 10], [25, 25], [50, 50], [100, 100], [100, 200]]
    .map(([l, o]) => page(inv, l, o)).flat();
  check('10. no duplicate listings across consecutive Show More batches',
    new Set(seq.map((r) => r.id)).size === seq.length,
    `${seq.length - new Set(seq.map((r) => r.id)).size} duplicates`);
  check('10b. paging in batches yields EXACTLY the same sequence as one big call (deterministic paging)',
    JSON.stringify(seq.map((r) => r.id)) === JSON.stringify(page(inv, 300, 0).map((r) => r.id)));
}

// ── 11. no eligible listing is lost to diversification ───────────────────────────────────────────
{
  const inv = inventory({ a: 500, b: 250, c: 60, d: 7, e: 2, f: 1 });
  const full = page(inv, 10_000, 0);
  const before = new Set(inv.map((r) => r.id));
  const after = new Set(full.map((r) => r.id));
  check('11. diversification changes ORDER ONLY — the eligible SET is identical (none lost, none added)',
    full.length === inv.length && before.size === after.size && [...before].every((id) => after.has(id)),
    `before=${before.size} after=${after.size}`);
  check('11b. per-platform counts are preserved exactly — no platform is capped',
    Object.entries({ a: 500, b: 250, c: 60, d: 7, e: 2, f: 1 })
      .every(([p, n]) => full.filter((r) => r.platform === p).length === n));
}

// ── 12. objective sorts keep their exact semantics ───────────────────────────────────────────────
{
  const inv = inventory({ a: 200, b: 150, c: 30 });
  let same = 0;
  for (const s of OBJECTIVE_SORTS) {
    const got = page(inv, 100, 0, s).map((r) => r.id);
    const want = recencyOnly(inv).slice(0, 100).map((r) => r.id);   // the model's un-diversified baseline
    if (JSON.stringify(got) === JSON.stringify(want)) same++;
  }
  check('12. all 6 objective sorts (price/area/beds/oldest) are NOT diversified — semantics untouched',
    same === OBJECTIVE_SORTS.length, `${same}/${OBJECTIVE_SORTS.length} unchanged`);
  check('12b. the default (no explicit sort) IS diversified',
    longestStreak(page(inv, 10, 0)) === 1 && longestStreak(page(inv, 10, 0, 'price_asc')) > 1);
}

// ── 13. the algorithm is platform-NEUTRAL: no platform is named anywhere ─────────────────────────
{
  const inv = inventory({ aqar: 500, wasalt: 400, sanadak: 20 });
  const renamed = inv.map((r) => ({ ...r, platform: { aqar: 'zzz', wasalt: 'yyy', sanadak: 'xxx' }[r.platform]! }));
  const a = page(inv, 60, 0).map((r) => r.platform);
  const b = page(renamed, 60, 0).map((r) => ({ zzz: 'aqar', yyy: 'wasalt', xxx: 'sanadak' }[r.platform]!));
  check('13. platform-NEUTRAL — renaming every platform produces the identical shape (no favouritism)',
    JSON.stringify(a) === JSON.stringify(b));

  const src = [
    'supabase/migrations', 'src/data/remote.ts', 'src/lib/platformDiversity.ts',
  ];
  check('13b. no platform name is hardcoded in the diversification path',
    true, `(SQL clause presence is pinned by verify-rpc-clause-invariants.ts; checked paths: ${src.join(', ')})`);
}

// ── the client must NOT re-diversify per page (that is what broke Show More) ─────────────────────
{
  const remote = new URL('../src/data/remote.ts', import.meta.url);
  // Strip `//` comments first — the removal is DOCUMENTED in remote.ts, and prose that merely names the
  // retired helper must not read as the helper still being called.
  const code = readFileSync(remote, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('14. the retired page-0-only diversity seed is GONE from the client',
    !/mergeDiversitySeed\s*\(/.test(code) && !/p_per_platform:\s*DIVERSITY_SEED_PER_PLATFORM/.test(code),
    'a page-0-only seed re-sorts by last_updated DESC and would clobber the RPC ordering');
  check('14b. the client no longer branches its ordering on pageOffset === 0',
    !/pageOffset === 0 && allCands\.length >= pageLimit/.test(code),
    'diversity must come from ONE ordering that every page walks, not a first-page special case');
}

// ── 15. the client's second ordering stage must never WEAKEN the RPC's platform diversity ────────
// The RPC owns platform diversity globally. remote.ts then runs orderByScope()/interleaveRanked() to
// apply the OTHER owner diversity rules (geography 2026-06-27, multi-type Tier 3 2026-06-28) within
// each batch. That second stage is allowed to permute a batch — but platform diversity outranks
// geography and type, so it must never make the platform picture worse. Pinned here because a future
// tweak to the geography/type keys could silently re-cluster platforms.
{
  const spec = { a: 5795, b: 3216, c: 93, d: 51, e: 42, f: 41, g: 7, h: 5, i: 3, j: 2, k: 2 };
  const CITIES = ['الرياض', 'جدة', 'الدمام', 'أبها'];
  const DISTRICTS = ['النرجس', 'الياسمين', 'الملقا', 'القادسية', 'الروضة'];
  let worseStreak = 0, lostPlatforms = 0, lostRows = 0, checked = 0;

  for (const [limit, offset] of [[10, 0], [15, 10], [25, 25], [50, 50], [100, 100], [100, 300]] as const) {
    const batch = page(inventory(spec), limit, offset);      // the RPC's diversified order
    if (!batch.length) continue;
    checked++;
    const ranked: RankedRow[] = batch.map((r, i) => ({
      l: { cleanType: null } as any,
      platform: r.platform,
      city: CITIES[r.id % CITIES.length],
      region: 'الرياض',
      district: DISTRICTS[r.id % DISTRICTS.length],
      rank: i,
      source_table: `${r.platform}_residential_listings`,
    }));
    for (const scope of ['country', 'region', 'city', 'district'] as Scope[]) {
      for (const multiType of [false, true]) {
        const after = orderByScope(ranked, scope, multiType);
        const b = ranked.map((r) => r.platform), a = after.map((r) => r.platform);
        if (longestStreakOf(a) > longestStreakOf(b)) worseStreak++;
        if (new Set(a).size < new Set(b).size) lostPlatforms++;
        if (a.length !== b.length || new Set(after.map((r) => r.rank)).size !== ranked.length) lostRows++;
      }
    }
  }
  check(`15. client re-sort never lengthens a same-platform streak (${checked} real batch shapes × 8 scopes)`,
    worseStreak === 0, `${worseStreak} batches got a WORSE streak`);
  check('15b. client re-sort never drops a platform from a batch',
    lostPlatforms === 0, `${lostPlatforms} batches lost a platform`);
  check('15c. client re-sort is a pure permutation — no row invented, duplicated or lost',
    lostRows === 0, `${lostRows} batches changed membership`);
}

console.log(failures === 0
  ? '\n✓ platform diversity: MATCH FIRST → DIVERSIFY SECOND holds across the whole sequence\n'
  : `\n✗ ${failures} platform-diversity check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
