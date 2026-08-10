// LIVE regression barrier (2026-08-10 filter audit): the two Advanced Filter COUNT RPCs
// (apartment_guided_counts_ar, property_age_option_counts_ar) must report the exact same base
// population as the real search RPC (location_search_candidates_ar) for the same filter params —
// per docs/ADVANCED_FILTER_DESIGN_CONTRACT.md §8: "count == search, always — same predicate at
// count and search time." A user must never see a count next to an option that the search itself
// cannot fulfil.
//
// BACKGROUND: all three RPCs share byte-identical base eligibility SQL (verified 2026-08-10), but
// location_search_candidates_ar alone had received the PR #409 read-side defense-in-depth hardening
// (blocks a production_ready row that carries a negative price/area, a null deal, or
// production_ready=true with no resolved location). Migration 20260810145200 extended that same
// guard to both count RPCs so all three can never drift apart again. This script proves it, live,
// through the same anon key real clients use (a privileged connection could mask RLS/permission
// differences — memory: verify-via-anon-key rule).
//
// NOT wired into `npm test` (CI has no network/DB). Run after any change to location_search_candidates_ar,
// apartment_guided_counts_ar, or property_age_option_counts_ar, and from the daily production audit:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-count-rpc-parity-live.ts

import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rpc(fn: string, args: Record<string, unknown>): Promise<any[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn} ${res.status}: ${await res.text()}`);
  return (await res.json()) as any[];
}

async function searchTotal(args: Record<string, unknown>): Promise<number> {
  const rows = await rpc('location_search_candidates_ar', { p_per_platform: 100000000, p_limit: 1, ...args });
  return rows.length ? Number(rows[0].total_count) : 0;
}

const BUY = 'بيع';
const RENT = 'إيجار';

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
};

const SCOPES: { name: string; args: Record<string, unknown> }[] = [
  { name: 'buy, unfiltered', args: { p_deal: BUY } },
  { name: 'rent, unfiltered', args: { p_deal: RENT } },
  { name: 'buy · الرياض', args: { p_deal: BUY, p_cities: ['الرياض'] } },
  { name: 'rent annual · جدة', args: { p_deal: RENT, p_rent_period: 'سنوي', p_cities: ['جدة'] } },
  { name: 'buy · شقة · price 300k-800k', args: { p_deal: BUY, p_types: ['شقة'], p_price_min: 300000, p_price_max: 800000 } },
];

async function main() {
  for (const s of SCOPES) {
    const [search, apt, age] = await Promise.all([
      searchTotal(s.args),
      rpc('apartment_guided_counts_ar', s.args).then((r) => Number(r[0]?.cnt_total_base ?? 0)),
      rpc('property_age_option_counts_ar', s.args).then((r) => Number(r[0]?.cnt_total ?? 0)),
    ]);
    check(`${s.name}: apartment_guided_counts_ar == search`, apt === search, `apt=${apt} search=${search}`);
    check(`${s.name}: property_age_option_counts_ar == search`, age === search, `age=${age} search=${search}`);
  }

  console.log(failed === 0
    ? '\n✓ count-RPC parity holds — apartment_guided_counts_ar and property_age_option_counts_ar match location_search_candidates_ar exactly on every scope'
    : `\n✗ ${failed} count-RPC parity check(s) FAILED — a filter count would show a number search cannot fulfil`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
