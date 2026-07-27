// TRIPWIRE: fail CI when a migration re-issues location_search_candidates_ar with a body that DROPS a
// clause that must always be present.
//
// WHY THIS EXISTS (real incident, 2026-07-17): migration 20260716221011 moved the Monthly/Yearly rent
// filter onto s.payment_monthly (payment schedule — the owner's permanent rule). 139 seconds later,
// 20260716221230 (PR#120, "newest first NULLS LAST") re-issued CREATE OR REPLACE FUNCTION
// location_search_candidates_ar from a body COPIED FROM THE PREVIOUS RPC MIGRATION, silently carrying the
// stale rent-period clause and reverting the fix in production. 15,221 listings were returned by the wrong
// rent-period filter and 15,419 vanished from Monthly, with no error and no test failure. The repo copy was
// stale too, so a replay would have re-reverted it again.
//
// The failure mode is generic: this RPC is defined by full-body CREATE OR REPLACE in many migrations, so
// ANY author who copies an older body silently deletes newer clauses. This tripwire pins the invariants.
//
// It is deliberately OFFLINE + STATIC (no DB connection — CI has none, and tripwires here are offline-only):
// it replays the repo's migration ORDER exactly as Supabase would, takes the LAST migration that defines
// the RPC (that body is what a fresh replay produces), and asserts every required clause survives.
//
//   node --experimental-strip-types scripts/verify-rpc-clause-invariants.ts   (wired into `npm test`)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const RPC = 'location_search_candidates_ar';

// Each invariant = a clause that MUST appear in the effective (last) definition of the RPC.
// `marker` is matched case-insensitively against the migration body.
const REQUIRED: { name: string; marker: RegExp; why: string }[] = [
  {
    name: 'rent-period buckets on payment_monthly (payment SCHEDULE, not lease length)',
    marker: /payment_monthly/i,
    why: 'Owner permanent rule: Monthly = source explicitly offers monthly payment; Yearly = must pay annually. Reverted once by PR#120 (15,221 listings in the wrong bucket).',
  },
  {
    name: 'category purity via known_type_ar',
    marker: /known_type_ar/i,
    why: 'Residential/Commercial purity — without it ~14k Commercial-macro rows leak into Residential results.',
  },
  {
    name: 'newest-first ordering uses NULLS LAST',
    marker: /nulls\s+last/i,
    why: 'PR#120: unknown-date rows must sort LAST, not first.',
  },
  {
    name: 'furnished filter is NULL-strict (consistent with the amenities furnished token)',
    marker: /p_furnished\s+is null or s\.furnished\s*=\s*p_furnished/i,
    why: 'Bug C (2026-07-23): p_furnished must exclude furnished-unknown rows like every other strict boolean and the amenities path (both return 31,394). NULL-permissive returned 72,483 (furnished IS NOT FALSE).',
  },
  {
    name: 'tenant filter is NULL-strict',
    marker: /p_tenant\s+is null or s\.tenant_ar\s*=\s*p_tenant/i,
    why: '2026-07-27 audit: the permissive form returned 75,014 rows for p_tenant=>عوائل instead of the strict 5,751 — tenant-unknown rows must not pass an explicit tenant filter.',
  },
  {
    name: 'directions filter is NULL-strict and vocabulary-canonicalized (norm_direction_ar on BOTH sides)',
    marker: /norm_direction_ar\(s\.direction_ar\)\s+in\s*\(select norm_direction_ar\(d\)/i,
    why: '2026-07-27 audit: direction_ar holds two vocabulary families (شمال 14,869 vs شمالية 40); a literal match makes one family unreachable, and the old NULL-permissive clause returned 67,439 instead of 14,869.',
  },
  {
    name: 'street-width filter is NULL-strict (street_width_m IS NOT NULL required)',
    marker: /s\.street_width_m is not null/i,
    why: '2026-07-27 audit: NULL-permissive returned 89,819 for p_street_width_min=>20 instead of the strict 20,112.',
  },
  {
    name: 'floor filter is NULL-strict (floor_number IS NOT NULL required)',
    marker: /s\.floor_number is not null/i,
    why: '2026-07-27 audit: NULL-permissive returned 108,880 for p_floor_min=>3 instead of the strict 3,661 (96.6% false positives — floor coverage is only 4.9%).',
  },
  {
    name: "amenity token 'rent_now_pay_later' is an explicit alias of 'rnpl'",
    marker: /'rent_now_pay_later'\s*=\s*any\(p_amenities\)\)\s*or s\.rent_now_pay_later/i,
    why: "2026-07-27 audit: the literal token silently degraded to an UNFILTERED search (75,492 instead of 15,199).",
  },
  {
    name: 'unknown amenity tokens fail CLOSED (vocabulary guard present)',
    marker: /not exists \(select 1 from unnest\(p_amenities\) tok/i,
    why: 'An unrecognized amenity token must never silently widen a search to "no filter" — it must match nothing, so the mistake is visible the first time it ships.',
  },
];

// A clause that must NOT come back: the pre-fix rent-period predicate keyed on lease length + a hardcoded
// platform list. Its presence means someone pasted a stale body.
const FORBIDDEN: { name: string; marker: RegExp; why: string }[] = [
  {
    name: "stale rent-period clause (rent_period_ar + hardcoded platform in ('gathern','aqarmonthly'))",
    marker: /p_rent_period\s*=\s*'شهري'[\s\S]{0,120}?platform\s+in\s*\(\s*'gathern'\s*,\s*'aqarmonthly'\s*\)/i,
    why: 'This is the reverted, lease-length-based bucket. Rent period must bucket on payment_monthly.',
  },
  {
    name: 'NULL-permissive furnished predicate (Bug C regression)',
    marker: /p_furnished\s+is null or s\.furnished is null/i,
    why: 'Reintroduces Bug C: p_furnished would keep furnished-unknown rows (72,483) instead of the strict 31,394 the amenities path returns.',
  },
  {
    name: 'NULL-permissive tenant predicate',
    marker: /or s\.tenant_ar is null or/i,
    why: 'Reintroduces the 2026-07-27 defect: tenant-unknown rows pass an explicit tenant filter (75,014 instead of 5,751).',
  },
  {
    name: 'NULL-permissive directions predicate',
    marker: /or s\.direction_ar is null or/i,
    why: 'Reintroduces the 2026-07-27 defect: direction-unknown rows pass an explicit direction filter (67,439 instead of 14,869).',
  },
  {
    name: 'NULL-permissive street-width predicate',
    marker: /or s\.street_width_m is null\s+or/i,
    why: 'Reintroduces the 2026-07-27 defect: width-unknown rows pass an explicit street-width filter (89,819 instead of 20,112).',
  },
  {
    name: 'NULL-permissive floor predicate',
    marker: /or s\.floor_number is null\s+or/i,
    why: 'Reintroduces the 2026-07-27 defect: floor-unknown rows pass an explicit floor filter (108,880 instead of 3,661).',
  },
];

// Supabase applies migrations in version order (the leading numeric prefix). Replicate that ordering so
// "last" here == what a real replay would leave in the database.
function versionOf(filename: string): string {
  const m = filename.match(/^(\d+)/);
  return m ? m[1] : '';
}
function compareMigrations(a: string, b: string): number {
  const va = versionOf(a);
  const vb = versionOf(b);
  if (va !== vb) return va < vb ? -1 : 1; // lexicographic on the digit prefix == chronological here
  return a < b ? -1 : 1;
}

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const defineRe = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(public\\.)?${RPC}\\s*\\(`, 'i');

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort(compareMigrations);

const definers = files.filter((f) => defineRe.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')));

check(`at least one migration defines ${RPC} (found ${definers.length})`, definers.length > 0);
if (!definers.length) {
  console.error(`\n✗ No migration defines ${RPC}. Tripwire cannot verify invariants.`);
  process.exit(1);
}

// The LAST definer wins on a full replay — that body is the effective definition.
const effective = definers[definers.length - 1];
const body = readFileSync(join(MIGRATIONS_DIR, effective), 'utf8');
console.log(`\n→ effective ${RPC} definition after replay: ${effective}`);
console.log(`  (${definers.length} migration(s) define it: ${definers.join(', ')})\n`);

for (const inv of REQUIRED) {
  const ok = inv.marker.test(body);
  check(`effective RPC keeps: ${inv.name}`, ok);
  if (!ok) console.error(`   ↳ WHY IT MATTERS: ${inv.why}\n   ↳ ${effective} re-issues ${RPC} but DROPS this clause. Do not copy an older body — start from the CURRENT live definition (pg_get_functiondef) and change only what you intend.`);
}
for (const bad of FORBIDDEN) {
  const present = bad.marker.test(body);
  check(`effective RPC does NOT reintroduce: ${bad.name}`, !present);
  if (present) console.error(`   ↳ WHY IT MATTERS: ${bad.why}`);
}

console.log(
  failed === 0
    ? '\n✓ RPC clause invariants hold — no migration drops a required clause'
    : `\n✗ ${failed} RPC clause invariant(s) VIOLATED — a migration re-issued ${RPC} with a stale body`,
);
process.exit(failed === 0 ? 0 : 1);
