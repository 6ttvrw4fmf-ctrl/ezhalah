// field_integrity_extreme_magnitude JUDGES WHAT IS SERVED (2026-11-04, fields-and-filters).
//
// enforce_price_size_sanity() (owner 2026-10-28) serves the seller's figure when a sale total was typed
// into the per-meter box. The source table keeps the source's figure (PRICE = SOURCE), so the raw-only
// detector kept a P1 open over five dealapp cards that already showed a sane price (listing 23614750:
// source 1,290,000,000 for 430 m², served 3,000,000) — a standing false alarm that hides the one row that
// IS served wrong (21600559, 554,113,966/yr). Migration 20261104…_field_integrity_judges_served_price
// excludes a row only when its served price DIFFERS from the source figure and is itself sane.
//
// This barrier is hermetic: it reads committed SQL only.
//   1. some migration installs the served-correction clause into mon_detect_field_integrity;
//   2. no LATER migration redefines mon_detect_field_integrity (create or replace) without it;
//   3. the clause keeps both halves — «differs from source» AND «served sane» — so it can never
//      exclude a row served exactly as the source wrote it.
// Mutation-proven at the bottom against synthetic inputs.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';

export function servedClauseOk(sql: string): boolean {
  const s = sql.replace(/\s+/g, ' ');
  return /from public\.search_listings_ar s where s\.source_table = %L and s\.listing_id = x\.id/.test(s)
    && /s\.price_total is distinct from x\.price_total/.test(s)
    && /coalesce\(s\.price_total, 0\)::numeric \/ s\.area_m2 <= 2000000/.test(s)
    && /coalesce\(s\.price_annual, 0\)::numeric \/ s\.area_m2 <= 500000/.test(s)
    && /from public\.%I x/.test(s);
}

const REDEFINE = /create\s+or\s+replace\s+function\s+public\.mon_detect_field_integrity\s*\(/i;

export function problems(files: Array<{ name: string; sql: string }>): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const installIdx = sorted.findIndex((f) => /mon_detect_field_integrity/.test(f.sql) && servedClauseOk(f.sql));
  if (installIdx < 0) return ['no migration installs the served-price clause into mon_detect_field_integrity'];
  const out: string[] = [];
  for (const f of sorted.slice(installIdx + 1)) {
    if (REDEFINE.test(f.sql) && !servedClauseOk(f.sql)) {
      out.push(`${f.name} redefines mon_detect_field_integrity without the served-price clause`);
    }
  }
  return out;
}

// ── mutation proofs ────────────────────────────────────────────────────────────────────────────────
const GOOD = `do $$ ... public.mon_detect_field_integrity() ...
  and not exists (select 1 from public.search_listings_ar s
     where s.source_table = %L and s.listing_id = x.id
       and s.price_total is distinct from x.price_total
       and s.area_m2 > 0
       and coalesce(s.price_total, 0)::numeric / s.area_m2 <= 2000000
       and coalesce(s.price_annual, 0)::numeric / s.area_m2 <= 500000))
  from public.%I x $$;`;
const mutants: Array<[string, Array<{ name: string; sql: string }>]> = [
  ['clause absent', [{ name: '1.sql', sql: 'create or replace function public.mon_detect_field_integrity() ...' }]],
  ['«differs from source» half dropped (would hide a row served as-is)',
    [{ name: '1.sql', sql: GOOD.replace('and s.price_total is distinct from x.price_total', '') }]],
  ['«served sane» half dropped', [{ name: '1.sql', sql: GOOD.replace('<= 2000000', '<= 9e99') }]],
  ['later redefinition loses it', [{ name: '1.sql', sql: GOOD },
    { name: '2.sql', sql: 'create or replace function public.mon_detect_field_integrity() returns int ...' }]],
];
let fail = 0;
function mustCatch(label: string, caught: boolean): void {
  if (!caught) { console.error(`✗ mutant survived: ${label}`); fail++; }
}
for (const [label, input] of mutants) mustCatch(label, problems(input).length > 0);
if (problems([{ name: '1.sql', sql: GOOD }]).length) { console.error('✗ the good shape is rejected'); fail++; }

// ── the real tree ──────────────────────────────────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const real = problems(files);
for (const p of real) console.error(`✗ ${p}`);
if (fail || real.length) process.exit(1);
console.log(`✓ field_integrity judges the served price (${mutants.length} mutants killed)`);
