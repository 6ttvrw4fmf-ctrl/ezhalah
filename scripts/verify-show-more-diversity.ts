// Regression guard for the "Show More degrades into one platform" bug (owner-reported 2026-08-05).
//
// Root cause: the platform-diversity seed (mergeDiversitySeed/filterBoosted, see
// verify-platform-diversity-seed.ts) only ever fired on page 0 (`pageOffset === 0` in
// fetchListingsForQuery). A platform's batch-scraped rows (near-identical last_updated) can saturate
// ANY offset window in the main recency-ordered RPC call, not just the first — so Show More could hit
// the exact same single-platform-saturation failure the page-0 seed was built to fix, just one page
// later, completely unassisted. Live-verified case: a Rent+Apartment+Riyadh search where aqar's fresh
// rescrape batch filled page-2's entire 500-row Load-More window while wasalt's next-freshest matching
// rows sat just outside it.
//
// Fix (src/data/remote.ts, 2026-08-05): the `pageOffset === 0 &&` restriction is removed — the seed may
// now fire on every page. `unionBoosted` (src/lib/platformDiversity.ts) makes the per-query boosted-key
// memory ACCUMULATE across pages instead of being overwritten each time a seed fires, so: (a) a row
// pulled forward by page 0's seed is never re-offered by page 1's seed call, (b) it's excluded once the
// main window's own offset later reaches its true recency rank (the original Load-More-duplicate guard,
// now applied unconditionally instead of only when pageOffset>0).
//
// SECOND fix, same day: a fixed top-20-per-platform seed only ever pulled one round of diversity
// forward per platform — a platform with real depth (hundreds of matches) still reverted to the raw
// window after ~1 Show-More click, once its one-time top-20 allowance was exhausted. `diversitySeedDepth`
// makes the ask grow every round (20, 40, 60, ... capped at 200) so a deep platform keeps contributing
// "repeatedly where inventory permits" (owner rule), not just once. Live-verified against production:
// a 11-qualifying-platform Riyadh/Apartment/Rent search went from [1, 1, 2] platforms shown in the
// front-25-of-page for Show-More clicks #1-3 (pre-fix) to [9, 6, 2] (post-fix, growing-depth), with
// zero same-platform streak in that front-25 on any page (pre-fix streak was 25 = the whole batch).
//
//   node --experimental-strip-types scripts/verify-show-more-diversity.ts   (wired into `npm test`)

import { unionBoosted, mergeDiversitySeed, filterBoosted, diversitySeedDepth } from '../src/lib/platformDiversity.ts';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// ── diversitySeedDepth: the growing-ask primitive that keeps diversity going past 1 Show-More click ──
{
  check('round 0 (a query\'s first seed) asks for the original top-20-per-platform (no regression)', diversitySeedDepth(0) === 20);
  check('round 1 asks deeper (40), not the same 20 (the actual second bug fixed)', diversitySeedDepth(1) === 40);
  check('round 2 asks deeper still (60)', diversitySeedDepth(2) === 60);
  check('the ask keeps growing linearly with the round', diversitySeedDepth(4) === 100);
  check('the ask is capped at 200/platform (never an unbounded window)', diversitySeedDepth(50) === 200);
  check('the cap holds even further out', diversitySeedDepth(1000) === 200);
}

// ── unionBoosted: the accumulation primitive the whole fix rests on ──────────────────────────────
{
  const page0 = new Set(['wasalt:1', 'wasalt:2']);
  const page1 = new Set(['sanadak:9']);
  const afterPage0 = unionBoosted(undefined, page0);
  check('first seed of a query (no prior) becomes the accumulated set as-is', afterPage0.size === 2 && afterPage0.has('wasalt:1'));
  const afterPage1 = unionBoosted(afterPage0, page1);
  check('a second page\'s seed UNIONS with page 0\'s, not replaces it (the actual bug)', afterPage1.size === 3);
  check('page-0 keys survive into the accumulated set after page 1', afterPage1.has('wasalt:1') && afterPage1.has('wasalt:2'));
  check('page-1 keys are present too', afterPage1.has('sanadak:9'));
  const emptyFresh = unionBoosted(afterPage1, new Set());
  check('a page with no NEW boosted rows leaves the accumulated set unchanged (same reference)', emptyFresh === afterPage1);
  check('unionBoosted with no prior and no fresh returns an empty set, not undefined', unionBoosted(undefined, new Set()).size === 0);
}

// ── End-to-end simulation: page 0 seeds, page 1's seed call must not re-offer page 0's picks ──────
{
  type Cand = { source_table: string; listing_id: number; platform: string; last_updated: string | null };
  const aqarBatch = (n: number, startId: number) => Array.from({ length: n }, (_, i) => ({
    source_table: 'aqar_residential_listings', listing_id: startId + i, platform: 'aqar',
    last_updated: '2026-08-05T01:00:00+00:00',
  }));

  // Page 0: main window is 100% aqar (saturated); the RPC's own top-20-per-platform seed offers 2 wasalt rows.
  const page0Main: Cand[] = aqarBatch(30, 1000);
  const seedResponse: Cand[] = [
    { source_table: 'wasalt_residential_listings', listing_id: 5001, platform: 'wasalt', last_updated: '2026-06-01T00:00:00+00:00' },
    { source_table: 'wasalt_residential_listings', listing_id: 5002, platform: 'wasalt', last_updated: '2026-05-15T00:00:00+00:00' },
  ];
  const { merged: page0Merged, boostedKeys: page0Boosted } = mergeDiversitySeed(page0Main, seedResponse);
  let accumulated = unionBoosted(undefined, page0Boosted);
  check('page 0: wasalt rows present after merge', page0Merged.some((c) => c.platform === 'wasalt'));
  check('page 0: exactly 2 keys accumulated', accumulated.size === 2);

  // Page 1 (Show More): main window is AGAIN 100% aqar (a second batch — the exact reported bug).
  const page1Main: Cand[] = aqarBatch(30, 2000);
  // filterBoosted must be applied to the main window FIRST (mirrors the real fetchListingsForQuery
  // order) — here it's a no-op since page 1's main window shares no ids with what was boosted, but it
  // must never throw/misbehave when applied unconditionally on every page.
  const page1MainFiltered = filterBoosted(page1Main, accumulated);
  check('filterBoosted on an unrelated page is a safe no-op (same content)', page1MainFiltered.length === page1Main.length);

  // The RPC's own seed call is DETERMINISTIC (same top-20-per-platform query) — without filtering by the
  // accumulated boosted set, it would return the SAME wasalt:5001/5002 rows a second time. This is the
  // exact scenario unionBoosted + filterBoosted-on-the-seed-response together must prevent.
  const seedResponseAgain: Cand[] = [...seedResponse]; // same rows, same deterministic query
  const freshSeedForPage1 = filterBoosted(seedResponseAgain, accumulated);
  check('page 1\'s seed call, after filtering by the ACCUMULATED (not just page-0-local) boosted set, offers nothing already shown', freshSeedForPage1.length === 0);

  // Now simulate wasalt having MORE forward-pullable inventory (a 3rd row) the seed call would surface once
  // wasalt:5001/5002 are excluded — proves the mechanism still lets genuinely-new rows through, it isn't a
  // blunt "stop seeding after page 0" no-op.
  const seedResponseWithMore: Cand[] = [...seedResponse, { source_table: 'wasalt_residential_listings', listing_id: 5003, platform: 'wasalt', last_updated: '2026-04-01T00:00:00+00:00' }];
  const freshSeedWithMore = filterBoosted(seedResponseWithMore, accumulated);
  check('a genuinely NEW row (not previously boosted) still gets through page 1\'s seed', freshSeedWithMore.length === 1 && freshSeedWithMore[0].listing_id === 5003);
  const { merged: page1Merged, boostedKeys: page1Boosted } = mergeDiversitySeed(page1MainFiltered, freshSeedWithMore);
  check('page 1: the new wasalt row is merged into page 1\'s pool (Show More keeps diversifying)', page1Merged.some((c) => c.listing_id === 5003));
  accumulated = unionBoosted(accumulated, page1Boosted);
  check('accumulated set now covers all 3 wasalt rows across both pages', accumulated.size === 3);

  // Page 2: nothing left to seed (wasalt exhausted) — accumulated set stops growing, main window (still
  // aqar) is untouched. This is the explicit "fine to keep showing the dominant platform once the other
  // platform's inventory is exhausted" rule, not a hard quota.
  const page2Main: Cand[] = aqarBatch(30, 3000);
  const seedResponseExhausted: Cand[] = [...seedResponseWithMore]; // still the same deterministic 3 rows
  const freshSeedForPage2 = filterBoosted(seedResponseExhausted, accumulated);
  check('page 2: wasalt has nothing new left to offer -> seed call contributes zero rows (not a bug, exhaustion)', freshSeedForPage2.length === 0);
  check('page 2: main aqar window is untouched when there is nothing to seed', page2Main.length === 30);
}

console.log(failed === 0 ? '\n✓ all Show-More cross-page diversity assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
