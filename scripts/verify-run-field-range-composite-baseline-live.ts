// LIVE regression guard: mon_check_run_field_ranges' buy/rent null-price checks must judge each
// touched slice against a COMPOSITE per-property_type baseline, not one flat table-wide fraction.
//
// THE BUG (2026-08-21, "aqar_residential timeouts" mislabel investigation). The label was wrong —
// all the RC-B demotions were fast (4-24s), never a hang. The real cause: aqar-sweep.yml runs one
// begin_run/end_run PER CITY sweeping ALL property types x both deals in a single pass
// (scrapers/aqar/run_residential.py --all-residential --city X), and mon_check_run_field_ranges
// compared that touched slice's null-price fraction against ONE flat table-wide baseline + 0.25
// margin. Per-property_type null rates on aqar_residential_listings are structurally very different
// and stable (measured: Buy 1.37%-77.50%, Rent 4.28%-90.57%) -- a city sweep that happens to land
// disproportionately on Room/Chalet/Rest House (a small/niche city producing few Apartment/Villa
// touches) ALWAYS looked anomalous against the flat baseline even with zero real regression. Real
// trip: alert_event id=466, run 32382, rent_price_null_regression, slice_n=321, slice_frac=0.318 vs
// table_baseline_frac=0.066 -- fully explained by the touched slice being Room/Chalet/Rest
// House-heavy, all three faithfully high-null on the live source (WebFetch-confirmed against 4 live
// sa.aqar.fm pages: house/chalet listings genuinely show no price at all).
//
// THE FIX: migration 20260821031350_fix_run_field_range_composite_baseline.sql replaces the flat
// baseline with a composite one -- each property_type present in the touched slice contributes its
// OWN table-wide null rate, weighted by its share of the slice (falling back to the flat baseline
// per-type when that type has <20 table-wide rows, or when property_type isn't a column at all --
// so wasalt/aqaratikom/etc are unaffected).
//
// WHAT THIS PROVES, against the SAME synthetic data shape as the real trip (slice_n=321):
//   (a) a Room/Chalet/Rest-House-heavy touched slice, each type's null rate matching ITS OWN
//       baseline exactly (zero real regression) -- must NOT trip degraded.
//   (b) a normally-low-null type (Apartment, ~1.4% baseline) suddenly showing 45% null in the
//       touched slice -- a GENUINE regression -- must still trip degraded, proving the composite
//       fix does not lose real-regression sensitivity.
//
// This was proven red-on-old / green-on-new interactively during the fix session (Supabase MCP
// execute_sql against the OLD function definition, then again after applying the migration) --
// see the fix PR description for the exact before/after RPC output. This script is the PERMANENT,
// repeatable version of that same proof, run against the (now fixed, live) function only -- it
// asserts the NEW function's behavior, not a replay of the old one (there is no safe way to redefine
// a shared production function mid-test-run without racing every other concurrent session).
//
// NOT wired into `npm test` (CI has no network/DB/service-role key). Run after any change to
// mon_check_run_field_ranges, and periodically from the daily production audit:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types \
//     scripts/verify-run-field-range-composite-baseline-live.ts

import { PUBLIC_SUPABASE_URL } from './lib/public-supabase.ts';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.log('SKIP-FAIL: set SUPABASE_SERVICE_ROLE_KEY (this check needs write access to the '
    + 'service-role-only ops_test_field_range_synthetic fixture and calls a SECURITY DEFINER RPC '
    + 'that scrapers/common/db.py itself only ever calls with the service role).');
  process.exit(1);
}

const HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
const TABLE = 'ops_test_field_range_synthetic';
const REST = `${PUBLIC_SUPABASE_URL}/rest/v1`;

async function clearTable(): Promise<void> {
  const res = await fetch(`${REST}/${TABLE}?id=gte.0`, { method: 'DELETE', headers: HEADERS });
  if (!res.ok) throw new Error(`clear table failed ${res.status}: ${await res.text()}`);
}

type Row = {
  ad_number: string; listing_url: string; property_type: string; transaction_type: 'Buy' | 'Rent';
  price_total: number | null; price_annual: number | null; city: string; region: string;
  active: boolean; last_seen_at: string;
};

async function insertRows(rows: Row[]): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${REST}/${TABLE}`, { method: 'POST', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`insert failed ${res.status}: ${await res.text()}`);
}

async function callCheck(sinceIso: string): Promise<boolean> {
  const res = await fetch(`${REST}/rpc/mon_check_run_field_ranges`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({
      p_run_id: 999999, p_platform: 'ops_test', p_table: TABLE,
      p_since: sinceIso, p_placeholder_tokens: [],
    }),
  });
  if (!res.ok) throw new Error(`RPC failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as boolean;
}

async function clearTestAlert(): Promise<void> {
  const res = await fetch(`${REST}/alert_event?dedup_key=eq.run_field_range:${TABLE}`, { method: 'DELETE', headers: HEADERS });
  if (!res.ok) throw new Error(`alert cleanup failed ${res.status}: ${await res.text()}`);
}

// ── synthetic baseline population, matching aqar_residential_listings' real measured per-type
// null fractions (2026-08-21) so the composite math exercises realistic numbers, not toy ones. ──
const OLD = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();

function bulk(type: string, deal: 'Buy' | 'Rent', n: number, nullN: number, when: string, prefix: string): Row[] {
  const rows: Row[] = [];
  for (let i = 1; i <= n; i++) {
    const isNull = i <= nullN;
    rows.push({
      ad_number: `${prefix}${type}${i}`, listing_url: `https://x/${prefix}${type}${i}`,
      property_type: type, transaction_type: deal,
      price_total: deal === 'Buy' ? (isNull ? null : 100000) : null,
      price_annual: deal === 'Rent' ? (isNull ? null : 1000) : null,
      city: 'c', region: 'r', active: true, last_seen_at: when,
    });
  }
  return rows;
}

async function main() {
  let failed = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  -> ${detail}`}`);
    if (!ok) failed++;
  };

  await clearTable();

  const baseline: Row[] = [
    // Rent baseline
    ...bulk('Apartment', 'Rent', 15000, 642, OLD, 'B'),
    ...bulk('Villa', 'Rent', 6000, 316, OLD, 'B'),
    ...bulk('Floor', 'Rent', 4000, 250, OLD, 'B'),
    ...bulk('Building', 'Rent', 3000, 132, OLD, 'B'),
    ...bulk('Room', 'Rent', 1800, 452, OLD, 'B'),
    ...bulk('Rest House', 'Rent', 1200, 204, OLD, 'B'),
    ...bulk('Chalet', 'Rent', 50, 45, OLD, 'B'),
    // Buy baseline
    ...bulk('Apartment', 'Buy', 15000, 206, OLD, 'BB'),
    ...bulk('Villa', 'Buy', 14000, 615, OLD, 'BB'),
    ...bulk('Commercial Land', 'Buy', 17000, 1513, OLD, 'BB'),
    ...bulk('Floor', 'Buy', 6000, 108, OLD, 'BB'),
    ...bulk('Building', 'Buy', 5000, 315, OLD, 'BB'),
    ...bulk('Residential Land', 'Buy', 2800, 515, OLD, 'BB'),
    ...bulk('Industrial Land', 'Buy', 1900, 223, OLD, 'BB'),
    ...bulk('Rest House', 'Buy', 1500, 158, OLD, 'BB'),
  ];
  // insert in chunks — PostgREST/pgbouncer dislike one giant multi-thousand-row payload
  for (let i = 0; i < baseline.length; i += 2000) await insertRows(baseline.slice(i, i + 2000));

  const NOW = new Date().toISOString();
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // captures only "touched" rows

  // Scenario (a): Room/Chalet/Rest-House-heavy RENT touched slice, each type's null rate matching
  // its OWN baseline exactly — mirrors real alert 466's shape (slice_n=321).
  const scenarioA: Row[] = [
    ...bulk('Room', 'Rent', 200, 50, NOW, 'TA'),
    ...bulk('Chalet', 'Rent', 60, 54, NOW, 'TA2'),
    ...bulk('Rest House', 'Rent', 61, 10, NOW, 'TA3'),
  ];
  await insertRows(scenarioA);
  const afterA = await callCheck(sinceIso);
  const alertA = await (await fetch(`${REST}/alert_event?dedup_key=eq.run_field_range:${TABLE}&select=detail`, { headers: HEADERS })).json();
  const reasonsA: string[] = (alertA[0]?.detail?.reasons ?? []).map((r: any) => r.check);
  check('scenario (a) faithful high-null-type mix does NOT trip rent_price_null_regression',
    !reasonsA.includes('rent_price_null_regression'),
    `reasons=${JSON.stringify(reasonsA)}`);
  await clearTestAlert();
  // remove scenario (a) rows before the next scenario so slices don't mix
  await fetch(`${REST}/${TABLE}?ad_number=like.TA*`, { method: 'DELETE', headers: HEADERS });

  // Scenario (b): GENUINE regression — Apartment BUY jumps from its ~1.4% baseline to 45% null.
  const scenarioB: Row[] = bulk('Apartment', 'Buy', 300, 135, NOW, 'TB');
  await insertRows(scenarioB);
  const afterB = await callCheck(sinceIso);
  const alertB = await (await fetch(`${REST}/alert_event?dedup_key=eq.run_field_range:${TABLE}&select=detail`, { headers: HEADERS })).json();
  const reasonsB: string[] = (alertB[0]?.detail?.reasons ?? []).map((r: any) => r.check);
  check('scenario (b) genuine Apartment regression (1.4% -> 45%) STILL trips buy_price_null_regression',
    afterB === true && reasonsB.includes('buy_price_null_regression'),
    `degraded=${afterB} reasons=${JSON.stringify(reasonsB)}`);

  await clearTestAlert();
  await clearTable();

  console.log(failed === 0
    ? '\n✓ composite per-property_type baseline: no false positive on type-mix skew, still catches a real regression'
    : `\n✗ ${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
