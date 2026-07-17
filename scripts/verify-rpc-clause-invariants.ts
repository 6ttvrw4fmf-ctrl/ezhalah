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
];

// A clause that must NOT come back: the pre-fix rent-period predicate keyed on lease length + a hardcoded
// platform list. Its presence means someone pasted a stale body.
const FORBIDDEN: { name: string; marker: RegExp; why: string }[] = [
  {
    name: "stale rent-period clause (rent_period_ar + hardcoded platform in ('gathern','aqarmonthly'))",
    marker: /p_rent_period\s*=\s*'شهري'[\s\S]{0,120}?platform\s+in\s*\(\s*'gathern'\s*,\s*'aqarmonthly'\s*\)/i,
    why: 'This is the reverted, lease-length-based bucket. Rent period must bucket on payment_monthly.',
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
