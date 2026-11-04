// A BROWSER-VERIFIED BEDROOM COUNT SILENCES field_integrity_bedrooms ONLY WHILE IT IS STILL THAT COUNT (2026-11-04).
//
// WHY. field_integrity_bedrooms flagged 15 rows (aqar 6, alqasem 1, wasalt 8). Each ad was opened in a real browser
// on 2026-11-04 and every count was the source's own (aqar «غرف النوم 72», wasalt «777 Bedrooms», alqasem
// «غرف 166»). bedrooms_source_corroborated() could not see them: the number is in the page's spec grid, not in our
// stored title/URL. Migration 20261104105012 added ops_bedrooms_source_verified and made the bedrooms arm skip a row
// that is registered there.
//
// THE RULE THIS FILE HOLDS. A register is an alert-suppressing waiver, and AGENTS.md says a waiver must be re-checked
// rather than believed. Here the re-check is the VALUE PIN: the arm may skip a row only while x.bedrooms equals the
// verified number, so a re-scrape that changes the count raises again. Without `b.bedrooms = x.bedrooms` the register
// would silence that listing forever, whatever it later says. Measured in production 2026-11-04: wasalt flags 0 rows
// with the pin; with the pin off-by-one, the same query flags all 8.
//
// HOW. Offline: some committed migration must wire the register into mon_detect_field_integrity(), and EVERY one that
// references it must carry the table scope, the id join and the value pin. (A later rewrite that drops the register
// entirely re-raises the alerts — the safe direction — so that case is not this file's to block.)
//
//   node --experimental-strip-types scripts/verify-bedrooms-register-is-value-pinned.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');

export type Mig = { name: string; sql: string };

const TOUCHES = /mon_detect_field_integrity\s*\(/i;
const REGISTER = /ops_bedrooms_source_verified\s+b\b/i;
const ID_JOIN = /b\.listing_id\s*=\s*x\.id\b/i;
const VALUE_PIN = /b\.bedrooms\s*=\s*x\.bedrooms\b/i;
const TABLE_PIN = /b\.source_table\s*=\s*%L/i;

export function problems(migs: Mig[]): string[] {
  const out: string[] = [];
  const touching = migs.filter((m) => TOUCHES.test(m.sql)).sort((a, b) => a.name.localeCompare(b.name));
  const withRegister = touching.filter((m) => REGISTER.test(m.sql));
  if (withRegister.length === 0) {
    out.push('no migration wires ops_bedrooms_source_verified into mon_detect_field_integrity (20261104105012 did)');
    return out;
  }
  for (const m of withRegister) {
    if (!ID_JOIN.test(m.sql)) out.push(`${m.name}: register clause has no b.listing_id = x.id join`);
    if (!TABLE_PIN.test(m.sql)) out.push(`${m.name}: register clause is not scoped to the scanned table (b.source_table = %L)`);
    if (!VALUE_PIN.test(m.sql)) out.push(`${m.name}: register clause is not VALUE-PINNED (b.bedrooms = x.bedrooms) — a changed count would stay silenced`);
  }
  return out;
}

// ── mutation proofs: the predicate must fail on each broken shape ─────────────────────────────────────────
const GOOD = `select mon_detect_field_integrity(); and not exists (select 1 from public.ops_bedrooms_source_verified b
   where b.source_table = %L and b.listing_id = x.id and b.bedrooms = x.bedrooms)`;
const mutants: Array<[string, Mig[]]> = [
  ['value pin removed', [{ name: '20990101000000_a.sql', sql: GOOD.replace('and b.bedrooms = x.bedrooms', '') }]],
  ['id join removed', [{ name: '20990101000000_a.sql', sql: GOOD.replace('and b.listing_id = x.id', '') }]],
  ['table scope removed', [{ name: '20990101000000_a.sql', sql: GOOD.replace('b.source_table = %L and', '') }]],
  ['register never wired', [{ name: '20990101000000_a.sql', sql: 'select mon_detect_field_integrity();' }]],
];
let failed = false;
if (problems([{ name: '20990101000000_a.sql', sql: GOOD }]).length) {
  console.error('FAIL  the good shape is rejected:', problems([{ name: '20990101000000_a.sql', sql: GOOD }]));
  failed = true;
}
for (const [label, m] of mutants) {
  if (problems(m).length === 0) { console.error(`FAIL  mutant NOT caught: ${label}`); failed = true; }
  else console.log(`PASS  mutant caught: ${label}`);
}

// ── the real tree ─────────────────────────────────────────────────────────────────────────────────────────
const migs: Mig[] = readdirSync(MIG).filter((f) => f.endsWith('.sql')).map((f) => ({ name: f, sql: readFileSync(join(MIG, f), 'utf8') }));
const real = problems(migs);
for (const p of real) console.error(`FAIL  ${p}`);
if (failed || real.length) process.exit(1);
console.log('OK: the bedrooms register silences a row only while its count is still the browser-verified one');
