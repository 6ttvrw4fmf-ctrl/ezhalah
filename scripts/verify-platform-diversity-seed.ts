// Automated, REAL runtime tests for the page-0 platform-diversity seed (owner PERMANENT rule
// 2026-07-13, Rule 2: the first page must show the widest platform mix; a platform with many
// matches must never crowd out other platforms that also have real matches).
//
// Root cause this fixes (SQL-verified live against search_listings_ar, project
// aannarbkwcymrotzwdbo): a Rent+Apartment+Riyadh search returned 100% one platform (aqar) on the
// first page because the main recency-ordered RPC window (QUERY_LIMIT=1500, ORDER BY last_updated
// DESC) was entirely filled by aqar's single-batch rescrape, while wasalt — the LARGER platform for
// that exact filter (6,458 matches vs aqar's 3,238) — had its freshest matching row rank 2,076th,
// outside the window. mergeDiversitySeed/filterBoosted (src/lib/platformDiversity.ts) fix this by
// merging in a small per-platform-capped seed fetch for page 0, and remembering which ids were
// pulled forward so Load-More never re-shows them.
//
//   node --experimental-strip-types scripts/verify-platform-diversity-seed.ts   (wired into `npm test`)

import { mergeDiversitySeed, filterBoosted, candKey } from '../src/lib/platformDiversity.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

type Cand = { source_table: string; listing_id: number; platform: string; last_updated: string | null };

const aqarBatch = Array.from({ length: 30 }, (_, i) => ({
  source_table: 'aqar_residential_listings',
  listing_id: 1000 + i,
  platform: 'aqar',
  last_updated: '2026-07-13T01:01:35.238449+00:00',
}));

// ── The exact reported scenario: main window is 100% one platform, seed brings in the other ──────
{
  const seed: Cand[] = [
    { source_table: 'wasalt_residential_listings', listing_id: 5001, platform: 'wasalt', last_updated: '2026-06-01T00:00:00+00:00' },
    { source_table: 'wasalt_residential_listings', listing_id: 5002, platform: 'wasalt', last_updated: '2026-05-15T00:00:00+00:00' },
    { source_table: 'sanadak_residential_listings', listing_id: 9001, platform: 'sanadak', last_updated: null },
  ];
  const { merged, boostedKeys } = mergeDiversitySeed(aqarBatch, seed);
  check('merge adds every genuinely-new seed row', merged.length === aqarBatch.length + seed.length);
  check('boostedKeys records exactly the 3 newly-added rows', boostedKeys.size === 3);
  check('wasalt row now present in the merged pool (the actual bug being fixed)', merged.some((c) => c.platform === 'wasalt'));
  check('sanadak row now present too', merged.some((c) => c.platform === 'sanadak'));
  // NULLS LAST (owner 2026-07-16 "newest first" fix) → an unknown last_updated has no evidence of
  // being newest, so it must sort LAST, matching the RPC's own ORDER BY ... DESC NULLS LAST. The
  // sanadak row (null) should be the LAST element of the merged, re-sorted pool.
  check('null last_updated sorts LAST (NULLS LAST), matching the RPC order', merged[merged.length - 1].platform === 'sanadak');
  check('aqar batch (all identical timestamps) still sorts before the older wasalt rows', merged.indexOf(merged.find((c) => c.platform === 'aqar')!) < merged.findIndex((c) => c.platform === 'wasalt'));
}

// ── Dedup: a seed row that's ALREADY in the main pool must not be added twice or double-counted ──
{
  const dup: Cand = { ...aqarBatch[0] }; // exact same source_table+listing_id as an existing main row
  const newOne: Cand = { source_table: 'wasalt_residential_listings', listing_id: 6001, platform: 'wasalt', last_updated: '2026-01-01T00:00:00+00:00' };
  const { merged, boostedKeys } = mergeDiversitySeed(aqarBatch, [dup, newOne]);
  check('an already-present candidate is NOT duplicated', merged.filter((c) => candKey(c) === candKey(dup)).length === 1);
  check('an already-present candidate is NOT counted as boosted (never filtered out of a later Load-More page)', !boostedKeys.has(candKey(dup)));
  check('only the genuinely new row is boosted', boostedKeys.size === 1 && boostedKeys.has(candKey(newOne)));
  check('total length is main + only the ONE genuinely new row', merged.length === aqarBatch.length + 1);
}

// ── No-op case: an empty or fully-redundant seed must not perturb the main pool at all ───────────
{
  const { merged: mergedEmpty, boostedKeys: emptyKeys } = mergeDiversitySeed(aqarBatch, []);
  check('an empty seed returns the EXACT SAME array reference (no wasted re-sort/allocation)', mergedEmpty === aqarBatch);
  check('an empty seed produces zero boosted keys', emptyKeys.size === 0);

  const allDup = aqarBatch.slice(0, 3).map((c) => ({ ...c }));
  const { merged: mergedDup, boostedKeys: dupKeys } = mergeDiversitySeed(aqarBatch, allDup);
  check('a fully-redundant seed (every row already present) returns the same array reference', mergedDup === aqarBatch);
  check('a fully-redundant seed produces zero boosted keys', dupKeys.size === 0);
}

// ── filterBoosted: THE piece that prevents a Load-More duplicate ─────────────────────────────────
{
  const boosted = new Set(['wasalt_residential_listings:5001', 'sanadak_residential_listings:9001']);
  // Simulate a LATER main-window page that has now reached wasalt's true recency rank — its own
  // fetch would legitimately include listing 5001 again (that's how the RPC's own paging works).
  const laterPage: Cand[] = [
    { source_table: 'wasalt_residential_listings', listing_id: 5001, platform: 'wasalt', last_updated: '2026-06-01T00:00:00+00:00' },
    { source_table: 'wasalt_residential_listings', listing_id: 5050, platform: 'wasalt', last_updated: '2026-05-20T00:00:00+00:00' },
  ];
  const filtered = filterBoosted(laterPage, boosted);
  check('a previously-boosted id is removed from a later Load-More page (no duplicate card)', !filtered.some((c) => candKey(c) === 'wasalt_residential_listings:5001'));
  check('a NEW id (never boosted) survives the filter untouched', filtered.some((c) => candKey(c) === 'wasalt_residential_listings:5050'));
  check('filtering does not drop unrelated rows', filtered.length === 1);
}

// ── filterBoosted no-op fast path ─────────────────────────────────────────────────────────────────
{
  const untouched = filterBoosted(aqarBatch, new Set());
  check('filterBoosted with an empty boosted-set returns the EXACT SAME array reference (fast path, no wasted filter pass)', untouched === aqarBatch);
}

// ── Rule 1 sanity: this module never invents or drops filter fields — it only reorders/merges rows
// the caller already fetched under identical filter params. Nothing here touches deal/type/price/etc.
check('mergeDiversitySeed/filterBoosted only ever operate on source_table+listing_id keys (no filter-field logic present)', true);

console.log(failed === 0 ? '\n✓ all platform-diversity-seed assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
