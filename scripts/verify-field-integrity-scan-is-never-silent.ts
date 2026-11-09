// mon_detect_field_integrity CAN NEITHER CRASH ON A ZERO AREA NOR SKIP A TABLE IN SILENCE (2026-11-09, #11367).
//
// Two defects CodeRabbit found in the 11-08 «judge what customers are served» change, both now fixed in prod:
//   1. The suspect pre-test divided by x.area_m2 behind «x.area_m2 > 0 and …». PostgreSQL does not promise to
//      evaluate the guard first, so a zero-area row could raise division_by_zero (20261108235000 → nullif).
//   2. Each table's scan sat in «exception when others then continue», so such an error skipped the whole table
//      without a word and its listings read as clean (20261109001500 → a P2 field_integrity_table_skipped alert).
//
// Hermetic: reads committed SQL only.
//   A. some migration installs the nullif-guarded division into mon_detect_field_integrity, and no LATER migration
//      that touches the function carries the bare «::numeric / x.area_m2 >» division (outside a replace() anchor
//      constant) or redefines the function without nullif;
//   B. some migration installs the field_integrity_table_skipped alert, and no LATER migration that touches the
//      function reintroduces a silent «exception when others then continue».
// Mutation-proven at the bottom against synthetic inputs.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const FN = /mon_detect_field_integrity/;
const REDEFINE = /create\s+or\s+replace\s+function\s+public\.mon_detect_field_integrity\s*\(/i;
const GUARDED = /::numeric\s*\/\s*nullif\(x\.area_m2,\s*0\)\s*>\s*500000/;
// a bare division, ignoring lines that only declare the replace() anchor (`old_div constant text := …`)
const BARE = /::numeric\s*\/\s*x\.area_m2\s*>/;
const SKIP_ALERT = /'field_integrity_table_skipped:'\s*\|\|\s*rec\.tn/;
const SILENT = /exception\s+when\s+others\s+then\s+continue\s*;/i;

type F = { name: string; sql: string };

function codeLines(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*old_\w+\s+constant\s+text\s*:=/.test(l) && !/^\s*--/.test(l)).join('\n');
}

export function problems(files: F[]): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  const guardIdx = sorted.findIndex((f) => FN.test(f.sql) && GUARDED.test(f.sql));
  if (guardIdx < 0) out.push('no migration installs the nullif-guarded area division into mon_detect_field_integrity');
  else for (const f of sorted.slice(guardIdx + 1)) {
    if (!FN.test(f.sql)) continue;
    if (BARE.test(codeLines(f.sql))) out.push(`${f.name} brings back the unguarded «/ x.area_m2» division`);
    if (REDEFINE.test(f.sql) && !GUARDED.test(f.sql)) out.push(`${f.name} redefines mon_detect_field_integrity without nullif(x.area_m2, 0)`);
  }
  const skipIdx = sorted.findIndex((f) => FN.test(f.sql) && SKIP_ALERT.test(f.sql));
  if (skipIdx < 0) out.push('no migration makes a skipped field_integrity table raise an alert');
  else for (const f of sorted.slice(skipIdx + 1)) {
    if (!FN.test(f.sql)) continue;
    if (SILENT.test(codeLines(f.sql))) out.push(`${f.name} reintroduces a silent «exception when others then continue»`);
    if (REDEFINE.test(f.sql) && !SKIP_ALERT.test(f.sql)) out.push(`${f.name} redefines mon_detect_field_integrity without the skipped-table alert`);
  }
  return out;
}

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
const guard: F = { name: '20261108235000_a.sql', sql: "old_div constant text := $a$coalesce(x.price_annual, 0))::numeric / x.area_m2 > 500000)$a$;\nnew_div constant text := $a$coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)$a$;\n-- mon_detect_field_integrity" };
const skip: F = { name: '20261109001500_b.sql', sql: "old_exc constant text := $a$    exception when others then continue;  -- x\n$a$;\n-- mon_detect_field_integrity\n'field_integrity_table_skipped:'||rec.tn" };
const cases: Array<[string, F[], boolean]> = [
  ['the real pair passes', [guard, skip], true],
  ['no guard install fails', [skip], false],
  ['no skip-alert install fails', [guard], false],
  ['a later patch with a bare division fails', [guard, skip, { name: '20261110000000_c.sql', sql: 'mon_detect_field_integrity … greatest(0,1)::numeric / x.area_m2 > 500000' }], false],
  ['a later redefine without nullif fails', [guard, skip, { name: '20261110000000_c.sql', sql: "create or replace function public.mon_detect_field_integrity() 'field_integrity_table_skipped:'||rec.tn" }], false],
  ['a later silent handler fails', [guard, skip, { name: '20261110000000_c.sql', sql: 'mon_detect_field_integrity\n    exception when others then continue;\n' }], false],
  ['an unrelated later migration passes', [guard, skip, { name: '20261110000000_c.sql', sql: 'select 1 / x.area_m2 > 2; exception when others then continue;' }], true],
];
let bad = 0;
for (const [label, files, expectOk] of cases) {
  const ok = problems(files).length === 0;
  if (ok !== expectOk) { console.error(`✗ mutation proof «${label}»: expected ${expectOk ? 'pass' : 'fail'}`); bad++; }
}
if (bad) process.exit(1);

const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const p = problems(files);
if (p.length) { for (const x of p) console.error('✗ ' + x); process.exit(1); }
console.log(`✓ field_integrity scan: zero-area safe and never silent (${cases.length} mutation proofs)`);
