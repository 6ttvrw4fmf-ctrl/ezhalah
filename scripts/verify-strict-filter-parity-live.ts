// LIVE count-parity regression test for the strict advanced filters (2026-07-27 fix batch).
// Proves — against the REAL production database, through the same anon key the app uses — that
// location_search_candidates_ar's total_count EQUALS strict ground truth (a PostgREST count on
// search_listings_ar with the same predicate, NO production_ready filter) for every filter that
// was NULL-permissive before 20260727124500, plus the amenity-vocabulary invariants.
//
// WHY LIVE + anon key: the offline tripwire (verify-rpc-clause-invariants.ts) pins the SQL text;
// this script pins the BEHAVIOR, via the anon-key REST path real clients use — a privileged
// connection could mask RLS/permission differences (see memory: verify-via-anon-key rule).
//
// NOT wired into `npm test` (CI has no network/DB). Run manually after any RPC migration, and from
// the daily production audit:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-strict-filter-parity-live.ts

// Env wins when set; otherwise the committed PUBLIC endpoint (see scripts/lib/public-supabase.ts).
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
const { url: URL_BASE, key: KEY } = resolvePublicSupabase();

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// RPC total_count with the per-platform cap disabled (cap is applied BEFORE total_count).
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

// The row scope the read RPCs actually serve: production_ready ∪ genuinely-unlocated.
//
// Updated 2026-08-10 (audit). This used to be a bare count with NO scope predicate, which matched
// the RPCs only because their unlocated-fallback disjunct was too wide — it rescued LOCATED rows
// that had been withheld by the price/size safety gate (production_ready is not a pure location
// gate; enforce_price_size_sanity() clears it for price_size_impossible rows). Migration
// 20260810123000 narrowed the fallback to genuinely-unlocated rows, so ground truth must carry the
// same scope or it counts rows the product deliberately withholds. Concretely, on the day of the
// fix: p_street_width_min=>20 (buy) → bare count 19,704, scoped count 19,701, RPC 19,701; the 3-row
// gap is exactly the located-but-withheld rows. See scripts/verify-unlocated-fallback-scope-live.ts.
const SERVED_SCOPE = 'or=(production_ready.is.true,region_id.is.null,city_id.is.null)';

// Strict ground truth: PostgREST exact count on the base table (same predicate, RPC row scope).
async function tableCount(filters: string): Promise<number> {
  const res = await fetch(
    `${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&limit=1&${SERVED_SCOPE}&${filters}`, {
    headers: { ...HEADERS, Prefer: 'count=exact' },
  });
  if (!res.ok && res.status !== 206) throw new Error(`table ${res.status}: ${await res.text()}`);
  const range = res.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1]);
  if (!Number.isFinite(total)) throw new Error(`no count in content-range: ${range}`);
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

// ── exact parity: RPC == strict ground truth ──────────────────────────────────────────────────
const EXACT: { name: string; rpc: Record<string, unknown>; gt: string }[] = [
  { name: 'p_floor_min=>3 (buy)',
    rpc: { p_deal: BUY, p_floor_min: 3 },
    gt: `deal_ar=eq.${enc(BUY)}&floor_number=gte.3` },
  { name: 'p_street_width_min=>20 (buy)',
    rpc: { p_deal: BUY, p_street_width_min: 20 },
    gt: `deal_ar=eq.${enc(BUY)}&street_width_m=gte.20` },
  { name: `p_tenant=>'عوائل' (rent)`,
    rpc: { p_deal: RENT, p_tenant: 'عوائل' },
    gt: `deal_ar=eq.${enc(RENT)}&tenant_ar=eq.${enc('عوائل')}` },
  { name: `p_directions=>['شمال'] (buy) — canonical family`,
    rpc: { p_deal: BUY, p_directions: ['شمال'] },
    gt: `deal_ar=eq.${enc(BUY)}&direction_ar=in.(${enc('"شمال","شمالية","شمالي"')})` },
  { name: `p_amenities=>['rnpl'] (rent)`,
    rpc: { p_deal: RENT, p_amenities: ['rnpl'] },
    gt: `deal_ar=eq.${enc(RENT)}&rent_now_pay_later=is.true` },
  { name: 'p_furnished=>true (rent) — stays strict (Bug C)',
    rpc: { p_deal: RENT, p_furnished: true },
    gt: `deal_ar=eq.${enc(RENT)}&furnished=is.true` },
];

// ── invariants that need no table predicate ───────────────────────────────────────────────────
async function main() {
  for (const t of EXACT) {
    const [a, b] = await Promise.all([rpcCount(t.rpc), tableCount(t.gt)]);
    check(`parity: ${t.name}`, a === b, `rpc=${a} ground=${b}`);
  }

  const [aliasA, aliasB] = await Promise.all([
    rpcCount({ p_deal: RENT, p_amenities: ['rnpl'] }),
    rpcCount({ p_deal: RENT, p_amenities: ['rent_now_pay_later'] }),
  ]);
  check(`alias: 'rent_now_pay_later' == 'rnpl'`, aliasA === aliasB && aliasA > 0, `rnpl=${aliasA} literal=${aliasB}`);

  const unknownTok = await rpcCount({ p_deal: RENT, p_amenities: ['definitely_not_a_token'] });
  check('unknown amenity token fails CLOSED (0 rows, not unfiltered)', unknownTok === 0, `count=${unknownTok}`);

  const [dirShort, dirFem] = await Promise.all([
    rpcCount({ p_deal: BUY, p_directions: ['شمال'] }),
    rpcCount({ p_deal: BUY, p_directions: ['شمالية'] }),
  ]);
  check('direction vocab: شمال == شمالية (both families reachable)', dirShort === dirFem && dirShort > 0, `شمال=${dirShort} شمالية=${dirFem}`);

  // Farm/Agriculture-Plot additivity (owner-permanent invariant) must survive the RPC re-issue.
  const [farm, agri, both] = await Promise.all([
    rpcCount({ p_types: ['مزرعة'] }),
    rpcCount({ p_types: ['أرض زراعية'] }),
    rpcCount({ p_types: ['مزرعة', 'أرض زراعية'] }),
  ]);
  check('Farm + Agriculture Plot stay additively separable', farm + agri === both && farm > 0 && agri > 0, `${farm}+${agri}==${both}`);

  // ── ANNUAL RENT IS SOURCE-PUBLISHED, NEVER INFERRED (audit 2026-07-28) ────────────────────────
  // The RPC used to read "not monthly ⇒ annual" (`p_rent_period='سنوي' and s.payment_monthly=false`),
  // which swept in every rent row whose source published NO period. Those rows were counted in the
  // «لقينا N إعلان» headline and consumed paging slots, but the card fetch is strict
  // (src/data/remote.ts:899 `.eq('rent_period','annual')` — owner rule at :894-895, "a null
  // rent_period is NOT annual … never guess"), so they could never render: the last Load-More page
  // came back short. Ground truth here is deliberately `rent_period_ar`, the SOURCE-published period.
  //
  // GROUND TRUTH CORRECTED 2026-09-03. The annual arm is now, verbatim from the live clause:
  //     p_rent_period = 'سنوي' and (s.rent_period_ar = 'سنوي'
  //                                 or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false)))
  // The second disjunct is the owner's RNPL rule — a listing the SOURCE labels monthly and the
  // SOURCE marks rent-now-pay-later is an annual commitment paid in instalments — and it landed
  // after this check was written. Both disjuncts read a SOURCE-published fact, so the invariant
  // this check exists for is untouched: nothing is INFERRED from the absence of a period.
  //
  // This check was dark when the arm changed (its scripts/test-exclusions.txt row named a workflow
  // that never invoked it — see verify-live-check-workflow-attendance.ts), so nothing noticed. It
  // then stayed silently vacuous: with zero monthly+RNPL rows in the index the old equality held
  // by coincidence, and it only went red once a single such row appeared (2026-09-03: 44,062
  // source-annual + 1 monthly-RNPL = the RPC's 44,063). Production was right the whole time.
  const [annualRpc, annualSrc, annualRnpl, annualNullPeriod] = await Promise.all([
    rpcCount({ p_deal: RENT, p_rent_period: 'سنوي' }),
    tableCount(`deal_ar=eq.${enc(RENT)}&rent_period_ar=eq.${enc('سنوي')}`),
    tableCount(`deal_ar=eq.${enc(RENT)}&rent_period_ar=eq.${enc('شهري')}&rent_now_pay_later=is.true`),
    tableCount(`deal_ar=eq.${enc(RENT)}&rent_period_ar=is.null`),
  ]);
  check('annual rent = SOURCE-published annual + SOURCE-marked monthly-RNPL, exactly',
    annualRpc === annualSrc + annualRnpl && annualSrc > 0,
    `rpc=${annualRpc} ground=${annualSrc}+${annualRnpl}=${annualSrc + annualRnpl}`);

  // The invariant the block above exists for, asserted on its own so the arithmetic cannot mask it:
  // a rent row whose source published NO period is never counted as annual. When the index holds no
  // such rows the comparison cannot discriminate, and saying so is the honest result — a check that
  // reports PASS on a case it never exercised is the failure mode this whole file just demonstrated.
  if (annualNullPeriod > 0) {
    check('a null-period rent row is NEVER inferred into annual',
      annualRpc < annualSrc + annualRnpl + annualNullPeriod,
      `rpc=${annualRpc} vs ${annualSrc}+${annualRnpl}+${annualNullPeriod} null-period rows`);
  } else {
    console.log('SKIP  a null-period rent row is NEVER inferred into annual  ' +
      '(NOT EXERCISED: the index currently holds 0 rent rows with no source-published period)');
  }

  console.log(failed === 0
    ? '\n✓ strict-filter live parity holds — RPC total_count equals strict ground truth on every fixed filter'
    : `\n✗ ${failed} strict-filter parity check(s) FAILED against production`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
