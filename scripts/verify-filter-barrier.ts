// REAL regression test for the normal-Filter barrier (read-side defense-in-depth on
// location_search_candidates_ar). Runs against the live DB via the anon key — exactly what a real
// user hits. It proves the guard did NOT break the Filter and that no Ezhalah-side INVALID row is
// ever returned. It deliberately does NOT assert anything about source-price MAGNITUDE (source is
// truth — a huge source-published price is legal). Continuous production coverage is provided
// separately by mon_detect_filter_barrier_leaks (P1 alert on any leak).
//
//   tsx scripts/verify-filter-barrier.ts   (wired into `npm run verify`)

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY!;
const sb = createClient(url, key);

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

// 1) The guard must not have broken the Filter: a broad Buy query still returns rows.
const buy = await sb.rpc('location_search_candidates_ar', { p_deal: 'بيع', p_limit: 500 });
check('Filter RPC returns rows for a Buy query (read-side guard did not break search)',
  !buy.error && Array.isArray(buy.data) && buy.data.length > 0);

// 2) A broad Rent query still returns rows.
const rent = await sb.rpc('location_search_candidates_ar', { p_deal: 'إيجار', p_limit: 500 });
check('Filter RPC returns rows for a Rent query',
  !rent.error && Array.isArray(rent.data) && rent.data.length > 0);

// 3) NOTHING the Filter returns may carry impossible parser output (negative price/area). This is the
//    read-side guard's promise. (0 is legal — "on request"/"unknown" placeholder — so only NEGATIVE.)
const rows = [...(buy.data ?? []), ...(rent.data ?? [])];
const negArea = rows.filter((r: any) => r.area_m2 != null && r.area_m2 < 0);
const negPrice = rows.filter((r: any) => r.effective_price != null && r.effective_price < 0);
check(`no returned row has negative area (${negArea.length} found)`, negArea.length === 0);
check(`no returned row has negative price (${negPrice.length} found)`, negPrice.length === 0);

console.log(failed === 0 ? '\n✓ filter-barrier assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
