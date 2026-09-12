// LIVE half — NOT wired into `npm test` (that CI has no network/DB; declared in
// scripts/test-exclusions.txt). Runs from .github/workflows/district-catalog-live-check.yml on a
// schedule, and from the daily production audit.
//
// Executes the REAL production RPC (district_options_ar) through the anon key the app itself uses
// — the same live-behavioral pattern as verify-platform-diversity-live.ts (memory: never test a
// copy of production code; verify via the anon key, not privileged access). Judges the response
// with the SAME predicate its hermetic sibling (verify-district-catalog-no-internal-codes.ts)
// proves sound by mutation — imported from scripts/lib/districtCatalog.ts, never re-implemented
// here, so this file can only ever be testing the real thing.
//
// Manual:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
//     node --experimental-strip-types scripts/verify-district-catalog-no-internal-codes-live.ts
//
// MUTATION-PROOF-EXEMPT: this file has no logic of its own to mutate — it only fetches and hands
// the response to auditDistrictOptions(), which its hermetic sibling
// (verify-district-catalog-no-internal-codes.ts) already proves sound with 6 mutations against the
// same shared predicate. A proof duplicated here would exercise nothing this file itself decides.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { auditDistrictOptions, auditNoBogusEntries, HISTORICALLY_POLLUTED_CITIES, type DistrictRow } from './lib/districtCatalog.ts';

const RIYADH = 3;
const JAZAN = 17; // richest set of GENUINE numbered sub-districts observed — the positive control.

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

async function main() {
  const { url: URL_BASE, key: KEY } = resolvePublicSupabase();
  const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  async function districtOptions(cityId: number, extra: Record<string, unknown> = {}): Promise<DistrictRow[]> {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/district_options_ar`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ p_city_id: cityId, ...extra }),
    });
    if (!res.ok) throw new Error(`district_options_ar HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  const jazan = await districtOptions(JAZAN);
  const scopes: [string, Record<string, unknown>][] = [
    ['no filters (broadest call)', {}],
    ['Buy, Residential', { p_deal: 'بيع', p_category: 'Residential' }],
    ['Rent, Residential', { p_deal: 'إيجار', p_category: 'Residential' }],
    ['Commercial', { p_category: 'Commercial' }],
  ];
  for (const [label, args] of scopes) {
    const riyadh = await districtOptions(RIYADH, args);
    const problems = auditDistrictOptions(riyadh, jazan);
    check(`Riyadh (${label}, ${riyadh.length} districts): clean and complete`, problems.length === 0, problems.join('; '));
  }

  // Beyond Riyadh: prove the PUBLIC RPC PATH itself (not just the underlying table, which the
  // standing detector already covers exhaustively for all 297 cities) stays clean for every city
  // with a documented pollution history before the fix.
  for (const city of HISTORICALLY_POLLUTED_CITIES) {
    if (city.id === RIYADH) continue; // already swept above, across 4 scopes
    const rows = await districtOptions(city.id);
    const problems = auditNoBogusEntries(city.label, rows);
    check(`${city.label} (${rows.length} districts): no internal-code-shaped entries via the RPC`,
      problems.length === 0, problems.join('; '));
  }

  console.log(failed === 0
    ? '\n✓ district catalog live: no internal codes leak in, genuine numbered districts stay distinct'
    : `\n✗ ${failed} live district-catalog check(s) FAILED against production`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
