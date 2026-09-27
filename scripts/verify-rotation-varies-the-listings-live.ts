// THE DEPLOYED SEARCH REALLY RETURNS A DIFFERENT MIX FOR A DIFFERENT SEED — AND PAGES CLEANLY.
//
// LIVE half of the 2026-09-26 rotation rule (owner: "I refresh — the same exact one shouldn't show
// عقار first... عقار has so much in our database, don't always show me the exact one"). Its
// hermetic sibling, verify-rotation-seed-is-per-search.ts, proves the CLIENT mints one seed per
// search and holds it across that search's pages. Neither half can prove the other: the client can
// thread a perfect seed into an ORDER BY that ignores it, which is exactly the state this change
// repaired (rot_key sat BELOW div_rank, so the seed could only reorder platforms, never pick which
// listing a platform fronts). Only a real call against the deployed function can tell.
//
// Asserted against the REAL RPC, never a copy of its SQL:
//   1. two seeds → the SAME total_count (rotation reorders, it must never change eligibility)
//   2. two seeds → DIFFERENT listing ids on the first screen (the "same houses" complaint)
//   3. two seeds → a DIFFERENT platform in front (the "عقار is always first" complaint)
//   4. one seed, paged → no duplicate and no skipped id across the walk («عرض المزيد» safety)
//   5. within one seed's first screen, no platform repeats before every matching platform appeared
//   6. the no-seed call still works (the backward-compatible path every other caller uses)
//
// Uses the PUBLIC anon key — this is exactly the path a real visitor's browser takes, and reading
// it through a privileged key would mask an RLS/permission regression. FAILS CLOSED: an unreachable
// RPC is a failure, never "no rotation problem found" (AGENTS.md — a failed fetch is not an empty
// answer).
//
// LIVE, so deliberately OUT of the hermetic required suite (scripts/test-exclusions.txt records the
// workflow home). Its verdict depends on production inventory, which moves constantly; inside
// `npm test` it would fail unrelated PRs whenever a scrape landed.
//
//   node --experimental-strip-types scripts/verify-rotation-varies-the-listings-live.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { postgrestFetch } from './lib/postgrestRetry.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();

const CITY = 'الرياض';
const DEAL = 'بيع';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

type Row = { source_table: string; listing_id: number; platform: string; total_count?: number };

async function candidates(opts: { seed?: string; limit: number; offset?: number }): Promise<Row[]> {
  const body: Record<string, unknown> = {
    p_deal: DEAL, p_cities: [CITY], p_limit: opts.limit, p_offset: opts.offset ?? 0,
  };
  if (opts.seed !== undefined) body.p_rotation_seed = opts.seed;
  const r = await postgrestFetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  // FAIL CLOSED — an unreachable or erroring RPC must never read as "nothing to report".
  if (!r.ok) throw new Error(`HTTP ${r.status} from location_search_candidates_ar: ${text.slice(0, 300)}`);
  const rows = JSON.parse(text) as Row[];
  if (!Array.isArray(rows)) throw new Error(`unexpected payload shape: ${text.slice(0, 200)}`);
  return rows;
}

const idOf = (r: Row) => `${r.source_table}:${r.listing_id}`;

/** Each platform's FIRST listing in served order (array order from PostgREST IS the served order). */
export function topPerPlatform(rows: Row[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.platform)) m.set(r.platform, idOf(r));
  return m;
}

/**
 * THE PREDICATE THIS BARRIER IS ABOUT: of the platforms present under both seeds, what share
 * changed the listing they front? 0% is the exact defect the 2026-09-26 SQL change repaired
 * (rotation reordered platforms but never reached inside one), and it is what this file measured
 * against production before that change landed: 0% of 52 platforms.
 */
export function frontChangeRate(a: Row[], b: Row[]): { shared: number; changed: number; pct: number; frozen: string[] } {
  const ta = topPerPlatform(a);
  const tb = topPerPlatform(b);
  const shared = [...ta.keys()].filter((p) => tb.has(p));
  const frozen = shared.filter((p) => ta.get(p) === tb.get(p));
  const changed = shared.length - frozen.length;
  return { shared: shared.length, changed, pct: shared.length ? Math.round((100 * changed) / shared.length) : 0, frozen };
}

try {
  console.log(`\nRotation varies the served listings — live, «${CITY} / ${DEAL}»\n`);

  const SEED_A = 'barrier-seed-A-' + Date.now();
  const SEED_B = 'barrier-seed-B-' + Date.now();

  const a = await candidates({ seed: SEED_A, limit: 12 });
  const b = await candidates({ seed: SEED_B, limit: 12 });

  check('the scope has enough inventory for this barrier to bite (≥ 12 matches, many platforms)',
    a.length === 12 && new Set(a.map((r) => r.platform)).size >= 5,
    `rows=${a.length} platforms=${new Set(a.map((r) => r.platform)).size}`);

  // 1. eligibility is untouched by rotation
  const totalA = a[0]?.total_count ?? -1;
  const totalB = b[0]?.total_count ?? -2;
  check('two seeds report the SAME total_count (rotation reorders, it never re-filters)',
    totalA === totalB && totalA > 0, `A=${totalA} B=${totalB}`);

  // 2. THE ACTUAL COMPLAINT: does a GIVEN platform front a DIFFERENT listing?
  //
  // Comparing the first screens as a whole is NOT enough and was the first version of this check:
  // the pre-existing rot_key already reorders PLATFORMS, so the first screen's composition shifts
  // between seeds even when every platform is still fronting the exact same house. That version
  // passed against the unfixed function — a barrier that cannot fail is worse than none.
  //
  // So: take each platform's FIRST listing (array order from PostgREST IS the served order — no
  // window function, which without an explicit ORDER BY returns partition rows in arbitrary order
  // and silently produced a meaningless 19.2%-both-ways reading while this was being built), and
  // ask how many platforms actually swapped their front house.
  const DEEP = 600;
  const aBig = await candidates({ seed: SEED_A, limit: DEEP });
  const bBig = await candidates({ seed: SEED_B, limit: DEEP });
  const rate = frontChangeRate(aBig, bBig);
  check('enough platforms in both samples for this to mean anything', rate.shared >= 20, `shared=${rate.shared}`);
  check('the great majority of platforms front a DIFFERENT listing under a different seed',
    rate.pct >= 70,
    `only ${rate.pct}% of ${rate.shared} platforms changed their front listing`
    + ` — rotation is not reaching div_rank's per-platform window.`
    + ` Frozen: ${rate.frozen.slice(0, 6).join(', ')}`);
  console.log(`      (${rate.pct}% of ${rate.shared} shared platforms changed their front listing)`);

  // 3. the «عقار is always first» half — sampled over SEVERAL seeds, not two.
  //
  // Two seeds is a coin flip, not a measurement: with ~56 eligible platforms the same one can
  // legitimately lead twice in a row, and an early version of this check failed exactly that way on
  // a correct build (both drew aqar). What actually distinguishes "rotation works" from "عقار is
  // pinned to the front" is whether the leader EVER changes across a handful of seeds.
  const leaders: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s = await candidates({ seed: `lead-probe-${i}-${Date.now()}`, limit: 1 });
    if (s[0]) leaders.push(s[0].platform);
  }
  check('the leading platform is not pinned — it varies across several seeds',
    new Set(leaders).size >= 2,
    `all ${leaders.length} seeds led with the same platform: ${leaders[0]}`);
  console.log(`      (leaders across 5 seeds: ${leaders.join(', ')})`);

  // 5. platform diversity still holds inside one screen
  const platsA = a.map((r) => r.platform);
  const firstRepeat = platsA.findIndex((p, i) => platsA.indexOf(p) < i);
  const distinctBeforeRepeat = new Set(platsA.slice(0, firstRepeat === -1 ? platsA.length : firstRepeat)).size;
  check('no platform repeats on the first screen before every matching platform has had a turn',
    firstRepeat === -1 || distinctBeforeRepeat === new Set(platsA).size,
    `first repeat at ${firstRepeat}, only ${distinctBeforeRepeat} distinct before it`);

  // 4. paging with ONE seed is duplicate-free and gap-free
  const PAGE = 100;
  const seen: string[] = [];
  for (let offset = 0; offset < 400; offset += PAGE) {
    const page = await candidates({ seed: SEED_A, limit: PAGE, offset });
    seen.push(...page.map(idOf));
    if (page.length < PAGE) break;
  }
  check('a paged walk on ONE seed never repeats a listing («عرض المزيد» cannot show a card twice)',
    new Set(seen).size === seen.length,
    `${seen.length - new Set(seen).size} duplicate(s) across ${seen.length} paged rows`);

  // The walk must also be a PREFIX of the same ordering — page N must continue, not reshuffle.
  const straight = await candidates({ seed: SEED_A, limit: seen.length });
  check('the paged walk equals the same ordering read in one shot (pages continue, never reshuffle)',
    straight.map(idOf).join(',') === seen.join(','),
    'paging diverged from the single-shot order — a page boundary is re-sorting');

  // 6. the no-seed path still works for every caller that passes none
  const noSeed = await candidates({ limit: 5 });
  check('the no-seed call still returns rows (backward compatible for callers without a seed)',
    noSeed.length === 5, `rows=${noSeed.length}`);
} catch (e) {
  failed++;
  console.error(`FAIL  the barrier could not complete — failing closed rather than reporting clean`);
  console.error(`      ${(e as Error).message}`);
}

// ── MUTATION PROOFS — the predicate above, fed the defects it exists to catch ───────────────────
// Deterministic and synthetic on purpose: these prove the RULE discriminates, independently of
// whatever production inventory happens to look like on the day. Without them this file could
// report green because the threshold was unreachable rather than because rotation works — which is
// exactly what its first draft did: it compared whole first screens, which already differ under the
// OLD function (the pre-existing rot_key reorders PLATFORMS), so it passed against the very defect
// it was written for.
console.log('\n  mutation proofs (synthetic, deterministic)\n');
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

const row = (platform: string, id: number): Row => ({ source_table: `${platform}_residential_listings`, listing_id: id, platform });
const PLATS = ['aqar', 'wasalt', 'dealapp', 'sakan', 'tuba', 'rakez', 'dwelleo', 'ialqarawi', 'nofodh', 'muktamel'];

// M1: THE REAL PRE-FIX STATE — every platform fronts the identical listing, only the platform ORDER
// differs. This is what production measured at 0% before the change; the threshold must reject it.
{
  const a = PLATS.map((p, i) => row(p, 100 + i));
  const b = [...PLATS].reverse().map((p) => row(p, 100 + PLATS.indexOf(p)));   // same fronts, shuffled order
  const r = frontChangeRate(a, b);
  mustCatch(`platform order shuffling while every front listing stays frozen (${r.pct}% changed)`, !(r.pct >= 70));
}
// M2: a partial regression — only a third of platforms rotate — must still be rejected.
{
  const a = PLATS.map((p, i) => row(p, 200 + i));
  const b = PLATS.map((p, i) => row(p, i % 3 === 0 ? 900 + i : 200 + i));
  const r = frontChangeRate(a, b);
  mustCatch(`only ${r.pct}% of platforms rotating (a partial regression)`, !(r.pct >= 70));
}
// M3: the healthy shape is NOT flagged — the threshold is not vacuously red.
{
  const a = PLATS.map((p, i) => row(p, 300 + i));
  const b = PLATS.map((p, i) => row(p, 700 + i));
  const r = frontChangeRate(a, b);
  mustCatch(`nothing — a fully rotating result set (${r.pct}%) still passes`, r.pct >= 70);
}
// M4: the duplicate detector used on the paged walk really sees a repeat.
{
  const walk = ['a:1', 'a:2', 'a:3', 'a:2'];
  mustCatch('a repeated listing across a paged walk', new Set(walk).size !== walk.length);
}
// M5: …and does not cry wolf on a clean walk.
{
  const walk = ['a:1', 'a:2', 'a:3'];
  mustCatch('nothing — a clean paged walk is not reported as duplicated', new Set(walk).size === walk.length);
}

console.log(failed === 0
  ? '\n✅ rotation varies the served listings and the platform order, without touching totals or paging.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
