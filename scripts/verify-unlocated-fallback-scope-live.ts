// LIVE regression barrier for the audit-2026-08-10 fix: the "unlocated fallback" disjunct in the
// read RPCs may rescue ONLY genuinely-unlocated rows.
//
// Background. All three read RPCs (location_search_candidates_ar, apartment_guided_counts_ar,
// property_age_option_counts_ar) gate rows with:
//     production_ready OR (<no location filter supplied> AND <not price-gated>)
// The second disjunct exists for the product rule "unresolved-location countrywide": a row whose
// location never resolved still belongs in a countrywide search, because no location filter could
// ever reach it. That is deliberate and must KEEP working.
//
// The defect it hid: production_ready is NOT a pure location gate — trigger enforce_price_size_sanity()
// also clears it for price_size_impossible() rows (owner-approved PR#298 safety gate). Because the
// fallback keyed off "the USER supplied no location filter" rather than "the ROW is unlocated", every
// LOCATED-but-withheld row leaked into unfiltered search and vanished the moment a city was picked.
// Live before the fix: dealapp/5696027 (جدة, 22,002,786,078,000 SAR over 564,174 m²) returned by
// p_deal='بيع' with no location filter, absent from the same call with p_cities=['جدة'].
//
// This asserts the BEHAVIOR against production through the anon key the app actually uses (a
// privileged connection could mask RLS differences — see memory: verify-via-anon-key rule).
//
// NOT wired into `npm test` (CI has no network/DB). Run after any RPC migration and from the daily
// production audit:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-unlocated-fallback-scope-live.ts

// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rpcCount(args: Record<string, unknown>): Promise<number> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ p_per_platform: 100000000, p_limit: 1, ...args }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as { total_count: number }[];
  return rows.length ? Number(rows[0].total_count) : 0;
}

async function tableCount(filters: string): Promise<number> {
  const res = await fetch(`${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&limit=1&${filters}`, {
    headers: { ...HEADERS, Prefer: 'count=exact' },
  });
  if (!res.ok && res.status !== 206) throw new Error(`table ${res.status}: ${await res.text()}`);
  const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`no count for ${filters}`);
  return total;
}

const BUY = 'بيع';
const RENT = 'إيجار';
const enc = encodeURIComponent;

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
};

for (const [name, deal] of [['buy', BUY], ['rent', RENT]] as const) {
  const d = `deal_ar=eq.${enc(deal)}`;

  // The three populations, straight from the base table.
  const all = await tableCount(d);
  const prodReady = await tableCount(`${d}&production_ready=is.true`);
  // Genuinely unlocated: either id is NULL. PostgREST `or=` with two is.null predicates.
  const unlocated = await tableCount(`${d}&or=(region_id.is.null,city_id.is.null)`);
  // Located but withheld — the leak population.
  const withheldLocated = all - prodReady - unlocated;

  const rpc = await rpcCount({ p_deal: deal });

  // 1. Exact scope: the RPC returns production_ready ∪ unlocated, nothing more.
  check(
    `${name}: unfiltered RPC == production_ready + genuinely-unlocated`,
    rpc === prodReady + unlocated,
    `rpc=${rpc} pr=${prodReady} unlocated=${unlocated} sum=${prodReady + unlocated}`,
  );

  // 2. No located-but-withheld row leaks in (this is the bug that was fixed).
  check(
    `${name}: located-but-withheld rows stay withheld unfiltered`,
    rpc !== all && rpc === all - withheldLocated,
    `all=${all} withheld_located=${withheldLocated} rpc=${rpc}`,
  );

  // 3. The countrywide product rule still holds — unlocated rows are NOT over-tightened away.
  if (unlocated > 0) {
    check(
      `${name}: unresolved-location rows still reachable countrywide`,
      rpc > prodReady,
      `rpc=${rpc} > production_ready=${prodReady} (rescues ${unlocated} unlocated)`,
    );
  }
}

// 4. Same row, both ways: a located-but-withheld row must be invisible with AND without a location
//    filter. Picked live so the test survives that row aging out.
const withheldRes = await fetch(
  `${URL_BASE}/rest/v1/search_listings_ar` +
    `?select=source_table,listing_id,city_ar,deal_ar&production_ready=is.false` +
    `&region_id=not.is.null&city_id=not.is.null&limit=1`,
  { headers: HEADERS },
);
const withheldRows = (await withheldRes.json()) as
  { source_table: string; listing_id: number; city_ar: string; deal_ar: string }[];

if (withheldRows.length === 0) {
  console.log('SKIP  no located-but-withheld row in production right now (nothing to leak)');
} else {
  const row = withheldRows[0];
  const seen = async (args: Record<string, unknown>) => {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/location_search_candidates_ar`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ p_deal: row.deal_ar, p_per_platform: 100000000, p_limit: 1000000, ...args }),
    });
    if (!res.ok) throw new Error(`rpc ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as { source_table: string; listing_id: number }[];
    return rows.some((r) => r.source_table === row.source_table && r.listing_id === row.listing_id);
  };

  const unfiltered = await seen({});
  const filtered = await seen({ p_cities: [row.city_ar] });
  check(
    'withheld row answers identically with and without a location filter',
    unfiltered === false && filtered === false,
    `${row.source_table}/${row.listing_id} unfiltered=${unfiltered} city=${filtered}`,
  );
}

console.log(
  failed === 0
    ? '\n✓ unlocated fallback rescues ONLY unlocated rows — located rows answer the same either way'
    : `\n✗ ${failed} check(s) FAILED — the fallback disjunct is rescuing located rows again`,
);
process.exit(failed === 0 ? 0 : 1);
