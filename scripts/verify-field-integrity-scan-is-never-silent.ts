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
// C. both price arms (phone/ID band + extreme magnitude) count a row only while a customer is served that raw figure
const SERVED_RAW = /public\.field_integrity_served_raw\(x\.tableoid,\s*x\.id,\s*coalesce\(x\.price_total,\s*x\.price_annual\)\)/g;
/** How many served-raw calls a migration's executable text carries (replace() anchor constants excluded). */
export const servedRawArms = (sql: string): number => (codeLines(sql).match(SERVED_RAW) || []).length;
// a full definition carries the call twice; a replace() patch carries it once in its constant and ASSERTS it lands twice
/** A migration that puts the served-raw check into BOTH price arms (full text, or a patch asserting two hits). */
export const installsBothArms = (sql: string): boolean =>
  servedRawArms(sql) >= 2 || ((sql.match(SERVED_RAW) || []).length >= 1 && /\)\s*<>\s*2\s+then/.test(sql));

type F = { name: string; sql: string };

/** The `old_X` / `new_X` constant pairs of a `replace(v, old_X, new_X)` patch migration, matched by suffix. */
export function patchPairs(sql: string): Array<{ old: string; neu: string }> {
  const consts = new Map<string, { old?: string; neu?: string }>();
  for (const m of sql.matchAll(/\b(old|new)_(\w+)\s+constant\s+text\s*:=\s*\$a\$([\s\S]*?)\$a\$/g)) {
    const e = consts.get(m[2]) ?? {};
    if (m[1] === 'old') e.old = m[3]; else e.neu = m[3];
    consts.set(m[2], e);
  }
  return [...consts.values()].filter((e) => e.old !== undefined && e.neu !== undefined).map((e) => ({ old: e.old!, neu: e.neu! }));
}

/** True when a replace() patch swaps text carrying `marker` for text that no longer carries it. */
export function patchRemoves(sql: string, marker: RegExp): boolean {
  const m = new RegExp(marker.source, marker.flags.replace('g', ''));
  return patchPairs(sql).some((p) => m.test(p.old) && !m.test(p.neu));
}

function codeLines(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*old_\w+\s+constant\s+text\s*:=/.test(l) && !/^\s*--/.test(l)).join('\n');
}

/** Every way the committed migrations leave mon_detect_field_integrity crashable, silent, or judging unserved prices. */
export function problems(files: F[]): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  const guardIdx = sorted.findIndex((f) => FN.test(f.sql) && GUARDED.test(f.sql));
  if (guardIdx < 0) out.push('no migration installs the nullif-guarded area division into mon_detect_field_integrity');
  else for (const f of sorted.slice(guardIdx + 1)) {
    if (!FN.test(f.sql)) continue;
    if (BARE.test(codeLines(f.sql))) out.push(`${f.name} brings back the unguarded «/ x.area_m2» division`);
    if (REDEFINE.test(f.sql) && !GUARDED.test(f.sql)) out.push(`${f.name} redefines mon_detect_field_integrity without nullif(x.area_m2, 0)`);
    if (patchRemoves(f.sql, GUARDED)) out.push(`${f.name} removes the nullif-guarded division through a replace() patch`);
  }
  const skipIdx = sorted.findIndex((f) => FN.test(f.sql) && SKIP_ALERT.test(f.sql));
  if (skipIdx < 0) out.push('no migration makes a skipped field_integrity table raise an alert');
  else for (const f of sorted.slice(skipIdx + 1)) {
    if (!FN.test(f.sql)) continue;
    if (SILENT.test(codeLines(f.sql))) out.push(`${f.name} reintroduces a silent «exception when others then continue»`);
    if (REDEFINE.test(f.sql) && !SKIP_ALERT.test(f.sql)) out.push(`${f.name} redefines mon_detect_field_integrity without the skipped-table alert`);
    if (patchRemoves(f.sql, SKIP_ALERT)) out.push(`${f.name} removes the skipped-table alert through a replace() patch`);
  }
  const servedIdx = sorted.findIndex((f) => FN.test(f.sql) && installsBothArms(f.sql));
  if (servedIdx < 0) out.push('no migration installs the served-raw check into both price arms of mon_detect_field_integrity');
  else for (const f of sorted.slice(servedIdx + 1)) {
    if (REDEFINE.test(f.sql) && servedRawArms(f.sql) < 2) out.push(`${f.name} redefines mon_detect_field_integrity with the served-raw check in fewer than both price arms`);
    if (patchRemoves(f.sql, SERVED_RAW)) out.push(`${f.name} removes the served-raw check from a price arm through a replace() patch`);
  }
  return out;
}

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
const ARM = 'then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))';
const served: F = { name: '20261108221500_s.sql', sql: `-- mon_detect_field_integrity\nphone arm ${ARM}\nmagnitude arm ${ARM}` };
const guard: F = { name: '20261108235000_a.sql', sql: "old_div constant text := $a$coalesce(x.price_annual, 0))::numeric / x.area_m2 > 500000)$a$;\nnew_div constant text := $a$coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)$a$;\n-- mon_detect_field_integrity" };
const skip: F = { name: '20261109001500_b.sql', sql: "old_exc constant text := $a$    exception when others then continue;  -- x\n$a$;\n-- mon_detect_field_integrity\n'field_integrity_table_skipped:'||rec.tn" };
const cases: Array<[string, F[], boolean]> = [
  ['the real set passes', [served, guard, skip], true],
  ['no guard install fails', [served, skip], false],
  ['no skip-alert install fails', [served, guard], false],
  ['no served-raw install fails', [guard, skip], false],
  ['a later patch with a bare division fails', [served, guard, skip, { name: '20261110000000_c.sql', sql: 'mon_detect_field_integrity … greatest(0,1)::numeric / x.area_m2 > 500000' }], false],
  ['a later redefine without nullif fails', [served, guard, skip, { name: '20261110000000_c.sql', sql: "create or replace function public.mon_detect_field_integrity() 'field_integrity_table_skipped:'||rec.tn" }], false],
  ['a later silent handler fails', [served, guard, skip, { name: '20261110000000_c.sql', sql: 'mon_detect_field_integrity\n    exception when others then continue;\n' }], false],
  ['an unrelated later migration passes', [served, guard, skip, { name: '20261110000000_c.sql', sql: 'select 1 / x.area_m2 > 2; exception when others then continue;' }], true],
];
let bad = 0;
const mustCatch = (label: string, caught: boolean) => { if (!caught) { console.error(`✗ mutation proof «${label}» not caught`); bad++; } };
const mustPass = (label: string, ok: boolean) => { if (!ok) { console.error(`✗ «${label}» should pass`); bad++; } };
for (const [label, files, expectOk] of cases) {
  const ok = problems(files).length === 0;
  if (expectOk) mustPass(label, ok); else mustCatch(label, !ok);
}
mustCatch('a later patch reintroducing the bare division', problems([served, guard, skip, { name: '20261110000000_d.sql', sql: 'mon_detect_field_integrity … greatest(0,1)::numeric / x.area_m2 > 500000' }]).length > 0);
mustCatch('a later patch reintroducing the silent skip', problems([served, guard, skip, { name: '20261110000000_e.sql', sql: 'mon_detect_field_integrity\n    exception when others then continue;\n' }]).length > 0);
const redefineWith = (arms: number) => ({ name: '20261110000000_f.sql', sql: `create or replace function public.mon_detect_field_integrity() x::numeric / nullif(x.area_m2, 0) > 500000 'field_integrity_table_skipped:'||rec.tn ${Array(arms).fill(ARM).join(' ')}` });
mustCatch('a redefine that drops the served-raw check from the phone/ID arm', problems([served, guard, skip, redefineWith(1)]).length > 0);
mustCatch('a redefine that drops the served-raw check from the extreme-magnitude arm', problems([served, guard, skip, redefineWith(1)]).length > 0);
mustCatch('a redefine that drops it from both arms', problems([served, guard, skip, redefineWith(0)]).length > 0);
mustPass('a redefine that keeps both arms', problems([served, guard, skip, redefineWith(2)]).length === 0);
mustCatch('an install with the check in only one arm', problems([{ ...served, sql: `-- mon_detect_field_integrity\n${ARM}` }, guard, skip]).length > 0);
const patch = (oldText: string, newText: string): F => ({ name: '20261110000000_p.sql', sql: `-- mon_detect_field_integrity\ndo $m$ declare v text;\n  old_x constant text := $a$${oldText}$a$;\n  new_x constant text := $a$${newText}$a$;\nbegin v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);\n  execute replace(v, old_x, new_x); end $m$;` });
mustCatch('a replace() patch that swaps the served-raw call for «true»', problems([served, guard, skip, patch(ARM, 'then true')]).length > 0);
mustCatch('a replace() patch that swaps the nullif division back to a bare one', problems([served, guard, skip, patch('::numeric / nullif(x.area_m2, 0) > 500000', '::numeric / x.area_m2 > 500000')]).length > 0);
mustCatch("a replace() patch that drops the skipped-table alert", problems([served, guard, skip, patch("'field_integrity_table_skipped:'||rec.tn", "'x'")]).length > 0);
mustPass('a replace() patch that keeps the served-raw call while changing its guard', problems([served, guard, skip, patch(`and ${ARM}`, `and case when y ${ARM} else false end`)]).length === 0);
if (bad) process.exit(1);

const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const p = problems(files);
if (p.length) { for (const x of p) console.error('✗ ' + x); process.exit(1); }
console.log(`✓ field_integrity scan: zero-area safe and never silent (${cases.length} mutation proofs)`);
