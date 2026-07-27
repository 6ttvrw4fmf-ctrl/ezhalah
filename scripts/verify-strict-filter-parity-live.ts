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

const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !KEY) {
  console.error('SKIP-FAIL: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (anon/publishable key — never the service role).');
  process.exit(1);
}

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

// Strict ground truth: PostgREST exact count on the base table (same predicate, no PR filter).
async function tableCount(filters: string): Promise<number> {
  const res = await fetch(`${URL_BASE}/rest/v1/search_listings_ar?select=listing_id&limit=1&${filters}`, {
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

  console.log(failed === 0
    ? '\n✓ strict-filter live parity holds — RPC total_count equals strict ground truth on every fixed filter'
    : `\n✗ ${failed} strict-filter parity check(s) FAILED against production`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
