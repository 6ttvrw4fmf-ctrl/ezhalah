// LIVE regression barrier (2026-09-04, daily engineer full-population production integrity check).
//
// THE INCIDENT THIS EXISTS TO CATCH: 20260818221919_rent_period_product_fallback_annual_when_no_
// monthly_evidence.sql (owner product decision) made sync_search_listings_ar() classify every
// confirmed rent listing with no explicit source period as سنوي (شهري on the monthly-only
// platforms, gathern/aqarmonthly) — so no priced-or-priceless rent listing is ever unreachable by
// EITHER period chip in Normal Filter / Advanced Filter / Trending / the AI agent, all of which
// read search_listings_ar.rent_period_ar as the single canonical field.
//
// That fallback SILENTLY REVERTED sometime after being installed and proven working: a later
// CREATE OR REPLACE FUNCTION on sync_search_listings_ar() — for an unrelated reason, built from a
// stale base definition — kept the gathern/aqarmonthly special case but dropped the سنوي arm back
// to a bare NULL. Found 2026-09-04 via full-population evidence: 891 active, production_ready rent
// listings across 20 platforms (aqar 402, raghdan 125, eaqartabuk 111, arkaan 77, dealapp 49, and 15
// more) carried rent_period_ar = NULL despite qualifying for the fallback — the live cause of the
// nine open searchability_collapse P1/P2 alerts (alkhaas, eaqartabuk, hajer, jurash, mizlaj,
// raghdan, sadin, eastabha, souq24) raised 2026-09-03 17:59. Same shape as the
// af_rebuild_would_revert() incident the same day: an unrelated migration silently discarding a
// prior migration's fix because it rebuilt the function from an out-of-date snapshot.
//
// This script is the equivalent of an af_rebuild_would_revert()-style guard for a function this
// routine cannot add a live DB detector to (no migration write access) — it re-derives the SAME
// fallback-eligible population via the anon-readable REST API (memory: verify-via-anon-key rule —
// a privileged connection could mask an RLS/permission difference a real user would hit) and fails
// if it is ever nonzero again.
//
// NOT wired into `npm test` (CI has no network/DB) — same precedent as every other *-live.ts check
// here. Run manually, from a scheduled workflow, or as part of a production integrity sweep:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-rent-period-fallback-not-reverted-live.ts

import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// AGENTS.md: "search_listings_ar is anon-readable; use Prefer: count=exact with limit=0 for counts."
async function exactCount(filter: string): Promise<number> {
  const res = await fetch(`${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&${filter}&limit=0`, {
    headers: { ...HEADERS, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`search_listings_ar ${res.status}: ${await res.text()}`);
  const range = res.headers.get('content-range'); // "0-0/N" or "*/N"
  const total = range?.split('/')[1];
  if (!total || Number.isNaN(Number(total))) {
    throw new Error(`could not parse Content-Range for exact count: ${range}`);
  }
  return Number(total);
}

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
  if (!ok) failed++;
};

async function main() {
  // The exact fallback-eligible population: confirmed rent, no explicit period, not a monthly-only
  // platform, currently reachable-by-search (production_ready). Any row here has no source period
  // and is not gathern/aqarmonthly, so sync_search_listings_ar()'s fallback owes it either 'سنوي'
  // (everywhere) or 'شهري' (gathern/aqarmonthly only, already excluded) — never NULL.
  const unreached = await exactCount(
    "deal_ar=eq.%D8%A5%D9%8A%D8%AC%D8%A7%D8%B1" + // إيجار
      '&rent_period_ar=is.null' +
      '&platform=not.in.(gathern,aqarmonthly)' +
      '&production_ready=eq.true',
  );
  check(
    'no confirmed rent listing on a non-monthly-only platform is left with rent_period_ar=NULL',
    unreached === 0,
    `unreached=${unreached} (2026-09-04 incident measured 891 across 20 platforms)`,
  );

  // Sanity control: the monthly-only platforms must still resolve to شهري, never سنوي — proves this
  // check isn't just observing an over-broad "everything gets سنوي" regression instead.
  const monthlyOnlyStillAnnual = await exactCount(
    'platform=in.(gathern,aqarmonthly)' +
      '&deal_ar=eq.%D8%A5%D9%8A%D8%AC%D8%A7%D8%B1' + // إيجار
      '&rent_period_ar=eq.%D8%B3%D9%86%D9%88%D9%8A' + // سنوي
      '&production_ready=eq.true',
  );
  check(
    'monthly-only platforms (gathern, aqarmonthly) never fall back to سنوي',
    monthlyOnlyStillAnnual === 0,
    `count=${monthlyOnlyStillAnnual}`,
  );

  console.log(
    failed === 0
      ? '\n✓ rent-period fallback intact — no confirmed rent listing is stranded by an unset period'
      : `\n✗ ${failed} check(s) FAILED — the 2026-08-18 rent-period fallback has regressed again`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
