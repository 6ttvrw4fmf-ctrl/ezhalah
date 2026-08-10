// FIELD-LEVEL SAFETY BARRIER — regression guard.
//
// Owner rule, 2026-08-10:
//   Verified structured source YES/value -> store it
//   Explicit structured source NO        -> false
//   Source silent                        -> NULL
//   Never manufacture false from absence
//
// WHAT WENT WRONG (2026-08-10). 15 boolean attribute columns across the platform
// tables carried a column DEFAULT of `false`, and search_listings_ar.rent_now_pay_later
// was NOT NULL DEFAULT false — structurally unable to say "the source never told us".
// 735,686 attribute cells and 113,613 RNPL cells asserted a "no" that no source ever
// published. refresh_rnpl_flags() then re-manufactured it every 20 minutes via
// `coalesce(rent_now_pay_later, false)`.
//
// This script fails the build if any of that returns. It asserts against the LIVE
// database through the anon key (MCP SQL bypasses RLS; the app does not).
//
//   node --experimental-strip-types scripts/verify-safety-barrier.ts

// Self-sufficient by construction: resolvePublicSupabase() falls back to the committed
// PUBLIC anon key when the Actions secret is unset-and-empty. See
// scripts/verify-live-checks-self-sufficient.ts for why that matters — a live barrier
// that cannot obtain an endpoint fails on every run, and "always red" carries no signal.
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL, key: KEY } = resolvePublicSupabase(process.env);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

async function rpc(fn: string, body: Record<string, unknown> = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn} -> HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

console.log('\nField-level Safety Barrier — asserted against the LIVE database\n');

// Checks 1 and 2 read the MATERIALISED barrier state. The underlying detectors
// (detect_manufactured_negatives / detect_boolean_column_defaults) full-scan ~66
// tables x 18 columns and time out through PostgREST, so refresh_safety_barrier_state()
// runs on cron (jobid: safety_barrier_state, 03:23 UTC) and CI reads the cheap row.
const state = await fetch(`${URL}/rest/v1/mon_safety_barrier_state?select=*&id=eq.1`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
}).then((r) => r.json()).then((rows) => rows[0]);

check('barrier state is present and fresh (< 48h)',
  !!state && (Date.now() - Date.parse(state.checked_at)) < 48 * 3600_000,
  state ? `last checked ${state.checked_at}` : 'mon_safety_barrier_state is empty — the cron refresh never ran');

if (state) {
  // 1. No platform may hold `false` for an attribute it has never once reported as `true`.
  //    That signature means nothing ever read the attribute and the false is DEFAULT residue.
  check('no manufactured negatives (false with zero true anywhere on the platform)',
    state.manufactured_pairs === 0,
    `${state.manufactured_pairs} pair(s): ${JSON.stringify(state.detail).slice(0, 300)}`);

  // 2. No attribute column may carry a DEFAULT again — a DEFAULT invents a value for
  //    every row that omits the column, with no code involved and nothing to grep.
  check('no DEFAULT on any attribute column', state.default_columns === 0,
    `${state.default_columns} column(s) carry a DEFAULT again`);
}

// 3. rent_now_pay_later must still be able to express "unknown" end to end.
//    If someone re-adds NOT NULL, unknown silently becomes "no" again for ~10,098 listings.
//    Counted through the anon REST path the app actually uses, not through MCP.
async function countAnnualApts(extra: string): Promise<number> {
  const q = `${URL}/rest/v1/search_listings_ar?select=listing_id`
    + `&deal_ar=eq.${encodeURIComponent('إيجار')}`
    + `&rent_period_ar=eq.${encodeURIComponent('سنوي')}`
    + `&type_ar=eq.${encodeURIComponent('شقة')}`
    + `&production_ready=is.true${extra}`;
  const r = await fetch(q, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!r.ok) throw new Error(`REST ${r.status} ${await r.text()}`);
  return Number((r.headers.get('content-range') ?? '/0').split('/')[1] ?? 0);
}

const rnplUnknown = await countAnnualApts('&rent_now_pay_later=is.null');
const rnplYes     = await countAnnualApts('&rent_now_pay_later=is.true');
check('Annual Rent -> Apartment still carries RNPL unknowns (tri-state intact)',
  rnplUnknown > 0,
  `unknown=${rnplUnknown} yes=${rnplYes} — zero unknowns means the column was forced non-null again, `
  + 'or refresh_rnpl_flags() went back to coalesce(..., false)');
check('RNPL "yes" side preserved (the honesty fix must not remove real offers)',
  rnplYes > 0, `yes=${rnplYes}`);

console.log(failures === 0
  ? '\n✓ Safety Barrier intact — no invented negatives, no column defaults\n'
  : `\n✗ ${failures} check(s) FAILED — absence is being turned into "no" again\n`);
process.exit(failures === 0 ? 0 : 1);
