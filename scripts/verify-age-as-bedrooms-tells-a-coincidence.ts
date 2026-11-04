// suspicious_listing_facts:age_as_bedrooms TELLS A COINCIDENCE FROM A MISREAD (2026-11-04).
//
// The detector flagged sakan 100289 — the ad its own text cites as the bug — although that ad says
// «العمر : + 10» AND «10 غرف نوم» (spec table «غرف: 10»): ten bedrooms is the site's own count. Migration
// 20261104071417 makes a row a suspect only when the ad does NOT itself state that many rooms.
//
// Hermetic: reads committed SQL and EXECUTES the two regexes (ported 1:1 from the SQL) on literals:
//   • the stated-rooms exclusion must be installed into mon_detect_suspicious_listing_facts, and no later
//     full redefinition may drop it;
//   • both directions: a coincidence is excluded, a genuine age-as-bedrooms still hits.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const EXCLUSION = /!~ \(\\?'\(\^\|\\{1,2}D\)\\?' \|\| bedrooms::text \|\| \\?'\\{1,2}s\*\(غرف\|غرفة\|غرفه\)\\?'\)/;
const REDEFINE = /create\s+or\s+replace\s+function\s+public\.mon_detect_suspicious_listing_facts\s*\(/i;

export function problems(files: Array<{ name: string; sql: string }>): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const i = sorted.findIndex((f) => /mon_detect_suspicious_listing_facts/.test(f.sql) && EXCLUSION.test(f.sql));
  if (i < 0) return ['no migration installs the stated-rooms exclusion into mon_detect_suspicious_listing_facts'];
  return sorted.slice(i + 1).filter((f) => REDEFINE.test(f.sql) && !EXCLUSION.test(f.sql))
    .map((f) => `${f.name} redefines mon_detect_suspicious_listing_facts without the stated-rooms exclusion`);
}

// The predicate as the SQL computes it (Postgres ARE ≈ JS RegExp for these patterns).
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
export function suspect(desc: string, beds: number): boolean {
  const d = digits(desc);
  const ageHit = new RegExp(`(عمر العقار|العمر|عمره|عمرها)\\s*[:：*]*\\s*\\+?\\s*${beds}(\\D|$)`).test(d);
  const stated = new RegExp(`(^|\\D)${beds}\\s*(غرف|غرفة|غرفه)`).test(d);
  return ageHit && !stated;
}

let fail = 0;
const cases: Array<[string, number, boolean]> = [
  ['العمر : + 10 المساحة : 720 م … 10 غرف نوم - صالات معيشة واسعة', 10, false],   // sakan 100289
  ['العمر : + 10 المساحة 720 فيلا دورين', 10, true],                              // still a suspect
  ['عمر العقار: ٧ - ٧ غرفة', 7, false],
  ['عمر العقار: 7 - 17 غرفة', 7, true],                                           // 17 ≠ 7
];
for (const [d, b, want] of cases) {
  if (suspect(d, b) !== want) { console.error(`✗ suspect(${JSON.stringify(d)}, ${b}) should be ${want}`); fail++; }
}
const GOOD = `do $$ public.mon_detect_suspicious_listing_facts() … !~ ('(^|\\D)' || bedrooms::text || '\\s*(غرف|غرفة|غرفه)') $$`;
const mutants: Array<[string, Array<{ name: string; sql: string }>]> = [
  ['exclusion absent', [{ name: '1.sql', sql: 'public.mon_detect_suspicious_listing_facts()' }]],
  ['later redefinition drops it', [{ name: '1.sql', sql: GOOD },
    { name: '2.sql', sql: 'create or replace function public.mon_detect_suspicious_listing_facts() returns int' }]],
];
for (const [label, input] of mutants) {
  if (problems(input).length === 0) { console.error(`✗ mutant survived: ${label}`); fail++; }
}
if (problems([{ name: '1.sql', sql: GOOD }]).length) { console.error('✗ the good shape is rejected'); fail++; }

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const real = problems(files);
for (const p of real) console.error(`✗ ${p}`);
if (fail || real.length) process.exit(1);
console.log(`✓ age_as_bedrooms tells a coincidence from a misread (${cases.length} cases, ${mutants.length} mutants)`);
