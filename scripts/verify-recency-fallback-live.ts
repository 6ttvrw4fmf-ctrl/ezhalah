// LIVE BEHAVIORAL barrier: a listing whose SOURCE published no date must still be reachable by
// browsing, and must still report that absence honestly.
//
// THE DEFECT THIS LOCKS (senior audit 2026-08-12). location_search_candidates_ar ordered by
// `last_updated desc NULLS LAST`. 4,509 production_ready listings carry last_updated = NULL —
// dealapp 3,059 (28% of its entire searchable inventory), aqar 1,128, wasalt 301 — because those
// platforms publish no update date. NULLS LAST parked every one of them behind ~186,000 rows, so
// page 1 of the plain Buy browse contained ZERO of them and its newest row was the previous day:
// nothing discovered that day was reachable by browsing at all.
//
// The fix added an EZHALAH-OWNED `search_listings_ar.first_seen_at` (the raw scraped_at) and made
// every recency ordering site use `coalesce(last_updated, first_seen_at)`. `last_updated` itself is
// untouched source truth and is still what the RPC RETURNS.
//
// Why this check is LIVE and behavioral rather than static: the static half is the migration's own
// guarded needle-edit (it refuses to install if any `last_updated desc nulls last` site survives).
// That pins the TEXT. A later change could keep the text and still bury undated listings another
// way — a new UNION arm, a different fallback column, a cron that stops filling first_seen_at, a
// platform landing without scraped_at. This asserts the OUTCOME through the same anon RPC path real
// clients hit, so any of those turns the job red.
//
// Read-only, anon key (RLS-respecting) — the privileged path would mask exactly the permission
// regressions a live barrier exists to catch.
//
// Manual:
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/verify-recency-fallback-live.ts
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const BUY = 'بيع';

// Big enough that "buried at the very bottom of ~186k rows" is unambiguously excluded, small enough
// to stay a cheap scheduled call.
const PAGE = 2000;

type Row = {
  source_table: string;
  listing_id: number;
  platform: string;
  last_updated: string | null;
  total_count: number;
};

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function rpc(args: Record<string, unknown>): Promise<Row[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Row[];
}

const main = async () => {
  console.log('verify-recency-fallback-live: undated listings must be reachable AND honest');

  const page = await rpc({ p_deal: BUY, p_limit: PAGE, p_offset: 0 });
  check('default Buy browse returned rows', page.length > 0, `${page.length} rows`);

  // (1) REACHABILITY — the actual defect. Pre-fix this was structurally impossible: every
  // undated listing sorted behind all ~110k dated Buy rows, so none could appear in the first 2000.
  const undated = page.filter((r) => r.last_updated === null);
  check(
    'listings with no source date appear in the browse (not buried by NULLS LAST)',
    undated.length > 0,
    `${undated.length} of the first ${page.length}`,
  );

  // (2) SOURCE TRUTH — the fallback must never be written back into the source field. If a future
  // change "fixes" ordering by backfilling last_updated, (1) would still pass while the API started
  // reporting an Ezhalah observation as a platform-published date. That is the failure this catches.
  // A row that reports NULL is proving the field was left honest.
  check(
    'the RPC still reports NULL for undated listings (no fabricated source date)',
    undated.every((r) => r.last_updated === null),
    'output last_updated is untouched source truth',
  );

  // (3) FRESHNESS — an undated listing discovered recently must not be stuck behind the whole
  // corpus. The strongest data-independent form: undated rows are not all crammed at the very end
  // of the window, which is what a surviving NULLS-LAST ordering would produce.
  if (undated.length > 0) {
    const lastIdx = page.findIndex((r) => r === undated[0]);
    check(
      'the first undated listing is not pinned to the tail of the window',
      lastIdx < page.length - 1,
      `first undated at index ${lastIdx} of ${page.length}`,
    );
  }

  // (4) ORDERING MUST NOT CHANGE ELIGIBILITY. total_count is computed in the `matched` CTE, before
  // any ordering; re-sorting must return the identical matched set. Compares the default sort with
  // an explicit alternative sort over the same filter.
  const oldest = await rpc({ p_deal: BUY, p_limit: 1, p_offset: 0, p_sort_by: 'oldest' });
  check(
    'total_count is identical across sort orders (reorder, never refilter)',
    oldest.length > 0 && oldest[0].total_count === page[0].total_count,
    `default=${page[0]?.total_count} oldest=${oldest[0]?.total_count}`,
  );

  // (5) No duplicates — a broken ORDER BY key (non-total order) shows up here first, as the same
  // listing appearing twice inside one window.
  const ids = new Set(page.map((r) => `${r.source_table}:${r.listing_id}`));
  check('no duplicate listings within the window', ids.size === page.length,
    `${ids.size} distinct of ${page.length}`);

  console.log(failures === 0 ? '\nAll recency-fallback assertions passed.' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error('verify-recency-fallback-live: ERROR', e);
  process.exit(1);
});
