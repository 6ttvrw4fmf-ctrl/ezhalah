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
// The two price arms, told apart by their own thresholds: the phone/ID band and the extreme price-per-m² test.
const PHONE_ARM = /between\s+500000000\s+and\s+599999999/;
const MAGNITUDE_ARM = /::numeric\s*\/\s*area_m2\s*>\s*2000000\b/;
/** Which price arms of a full function text carry the served-raw call — judged per `count(*) filter (…)` arm,
 *  so two calls in one arm can never stand in for a missing call in the other. */
export function servedRawByArm(sql: string): { phone: boolean; magnitude: boolean } {
  const one = new RegExp(SERVED_RAW.source);
  const arms = codeLines(sql).split(/count\(\*\)\s+filter\s*\(\s*where/i);
  return {
    phone: arms.some((a) => PHONE_ARM.test(a) && one.test(a)),
    magnitude: arms.some((a) => MAGNITUDE_ARM.test(a) && one.test(a)),
  };
}
/** A migration that puts the served-raw check into BOTH price arms (full text judged per arm, or a patch asserting two hits). */
export const installsBothArms = (sql: string): boolean => {
  const by = servedRawByArm(sql);
  return (by.phone && by.magnitude) || ((sql.match(SERVED_RAW) || []).length >= 1 && /\)\s*<>\s*2\s+then/.test(sql));
};

type F = { name: string; sql: string };

/** The `old_X` / `new_X` constant pairs of a `replace(v, old_X, new_X)` patch migration, matched by suffix.
 *  Reads any dollar quote (`$a$`, `$o$`, `$$` …) and plain '…' strings with '' escapes. */
export function patchPairs(sql: string): Array<{ old: string; neu: string }> {
  const consts = new Map<string, { old?: string; neu?: string }>();
  const DECL = /\b(old|new)_(\w+)\s+(?:constant\s+)?text\s*:=\s*(?:\$(\w*)\$([\s\S]*?)\$\3\$|'((?:[^']|'')*)')/g;
  for (const m of sql.matchAll(DECL)) {
    const val = m[4] ?? m[5].replace(/''/g, "'");
    const e = consts.get(m[2]) ?? {};
    if (m[1] === 'old') e.old = val; else e.neu = val;
    consts.set(m[2], e);
  }
  return [...consts.values()].filter((e) => e.old !== undefined && e.neu !== undefined).map((e) => ({ old: e.old!, neu: e.neu! }));
}

/** A migration that rewrites mon_detect_field_integrity from its live text (pg_get_functiondef + replace) —
 *  if patchPairs cannot read its pairs, the barrier cannot judge it and must fail closed. */
export function isFunctionPatch(sql: string): boolean {
  return FN.test(sql) && /pg_get_functiondef\s*\(\s*'public\.mon_detect_field_integrity/.test(sql) && /\breplace\s*\(/.test(sql);
}

/** Every replace(...) call in a function patch, and whether each one is a form this barrier can judge:
 *  replace(<var>, old_X, new_X) or replace(<var>, old_X, '') with old_X/new_X declared constants. Anything else —
 *  an inline literal, a concatenation, a second unrelated rewrite — is unreadable, so the patch must fail closed. */
export function unreadableReplaces(sql: string): string[] {
  const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const declared = new Set([...code.matchAll(/\b(old|new)_(\w+)\s+(?:constant\s+)?text\s*:=/g)].map((m) => `${m[1]}_${m[2]}`));
  const calls = [...code.matchAll(/\breplace\s*\(/gi)].length;
  let readable = 0;
  const bad: string[] = [];
  for (const m of code.matchAll(/\breplace\s*\(\s*(\w+)\s*,\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/gi)) {
    const [, , from, to] = m;
    const sfx = from.replace(/^old_/, '');
    const ok = /^old_\w+$/.test(from) && declared.has(from) && (to === "''" || (to === `new_${sfx}` && declared.has(to)));
    if (ok) readable++; else bad.push(m[0]);
  }
  if (readable + bad.length < calls) bad.push(`${calls - readable - bad.length} replace(...) call(s) with nested or unparseable arguments`);
  return bad;
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
    if (REDEFINE.test(f.sql)) {
      const by = servedRawByArm(f.sql);
      if (!by.phone) out.push(`${f.name} redefines mon_detect_field_integrity without the served-raw check in the phone/ID price arm`);
      if (!by.magnitude) out.push(`${f.name} redefines mon_detect_field_integrity without the served-raw check in the extreme-magnitude arm`);
    }
    if (patchRemoves(f.sql, SERVED_RAW)) out.push(`${f.name} removes the served-raw check from a price arm through a replace() patch`);
    if (isFunctionPatch(f.sql)) {
      const bad = unreadableReplaces(f.sql);
      if (patchPairs(f.sql).length === 0 || bad.length) out.push(`${f.name} patches mon_detect_field_integrity in a shape this barrier cannot read — every rewrite must be replace(v, old_X, new_X) with declared constants: ${bad.join('; ') || 'no readable pairs'}`);
    }
  }
  return out;
}

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
const ARM = 'then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))';
const PHONE = 'count(*) filter (where price_total between 500000000 and 599999999';
const MAG = 'count(*) filter (where price_total::numeric/area_m2 > 2000000';
const served: F = { name: '20261108221500_s.sql', sql: `-- mon_detect_field_integrity\n${PHONE} ${ARM}),\n${MAG} ${ARM})` };
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
const redefineWith = (phoneCalls: number, magCalls: number): F => ({ name: '20261110000000_f.sql', sql: `create or replace function public.mon_detect_field_integrity() x::numeric / nullif(x.area_m2, 0) > 500000 'field_integrity_table_skipped:'||rec.tn\n${PHONE} ${Array(phoneCalls).fill(ARM).join(' ')}),\n${MAG} ${Array(magCalls).fill(ARM).join(' ')})` });
const errs = (f: F) => problems([served, guard, skip, f]);
mustCatch('a redefine that drops the served-raw check from the phone/ID arm only', errs(redefineWith(0, 1)).some((e) => /phone\/ID/.test(e)) && !errs(redefineWith(0, 1)).some((e) => /extreme-magnitude/.test(e)));
mustCatch('a redefine that drops the served-raw check from the extreme-magnitude arm only', errs(redefineWith(1, 0)).some((e) => /extreme-magnitude/.test(e)) && !errs(redefineWith(1, 0)).some((e) => /phone\/ID/.test(e)));
mustCatch('a redefine with TWO calls in the phone arm and none in the magnitude arm', errs(redefineWith(2, 0)).some((e) => /extreme-magnitude/.test(e)));
mustCatch('a redefine with TWO calls in the magnitude arm and none in the phone arm', errs(redefineWith(0, 2)).some((e) => /phone\/ID/.test(e)));
mustCatch('a redefine that drops it from both arms', errs(redefineWith(0, 0)).length >= 2);
mustPass('a redefine that keeps both arms', errs(redefineWith(1, 1)).length === 0);
mustCatch('an install with the check in only one arm', problems([{ ...served, sql: `-- mon_detect_field_integrity\n${ARM}` }, guard, skip]).length > 0);
const patch = (oldText: string, newText: string): F => ({ name: '20261110000000_p.sql', sql: `-- mon_detect_field_integrity\ndo $m$ declare v text;\n  old_x constant text := $a$${oldText}$a$;\n  new_x constant text := $a$${newText}$a$;\nbegin v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);\n  execute replace(v, old_x, new_x); end $m$;` });
mustCatch('a replace() patch that swaps the served-raw call for «true»', problems([served, guard, skip, patch(ARM, 'then true')]).length > 0);
mustCatch('a replace() patch that swaps the nullif division back to a bare one', problems([served, guard, skip, patch('::numeric / nullif(x.area_m2, 0) > 500000', '::numeric / x.area_m2 > 500000')]).length > 0);
mustCatch("a replace() patch that drops the skipped-table alert", problems([served, guard, skip, patch("'field_integrity_table_skipped:'||rec.tn", "'x'")]).length > 0);
mustPass('a replace() patch that keeps the served-raw call while changing its guard', problems([served, guard, skip, patch(`and ${ARM}`, `and case when y ${ARM} else false end`)]).length === 0);
const patchQ = (decl: string): F => ({ name: '20261110000000_q.sql', sql: `-- mon_detect_field_integrity\ndo $m$ declare v text;\n${decl}\nbegin v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);\n  execute replace(v, old_x, new_x); end $m$;` });
mustCatch('a $o$/$n$-quoted patch that drops the served-raw call', problems([served, guard, skip, patchQ(`  old_x constant text := $o$${ARM}$o$;\n  new_x constant text := $n$then true$n$;`)]).length > 0);
mustCatch("a '…'-quoted patch that drops the served-raw call", problems([served, guard, skip, patchQ(`  old_x constant text := '${ARM}';\n  new_x constant text := 'then true';`)]).length > 0);
mustCatch('a patch in a shape the barrier cannot read (inline replace literals)', problems([served, guard, skip, { name: '20261110000000_r.sql', sql: `-- mon_detect_field_integrity\ndo $m$ declare v text; begin v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);\n  execute replace(v, 'x' || 'y', 'z'); end $m$;` }]).length > 0);
mustPass("a '…'-quoted patch that keeps the call (with a '' escape) passes", problems([served, guard, skip, patchQ(`  old_x constant text := 'and ${ARM}';\n  new_x constant text := 'and case when y = ''z'' ${ARM} else false end';`)]).length === 0);
mustCatch('a readable unrelated pair followed by an inline-literal replace that removes the call', problems([served, guard, skip, patchQ(`  old_ok text := 'unrelated';\n  new_ok text := 'unrelated';\nbegin null; end; do $z$ declare v text; begin v := replace(v, old_ok, new_ok);\n  v := replace(v, 'public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))', 'true');`)]).length > 0);
mustCatch('a replace whose replacement is a concatenation', problems([served, guard, skip, patchQ(`  old_x constant text := 'a';\n  new_x constant text := 'b';\n  v2 text := replace(v, old_x, new_x || 'c');`)]).length > 0);
mustCatch('a replace nested inside another expression the reader cannot split', problems([served, guard, skip, patchQ(`  old_x constant text := 'a';\n  new_x constant text := 'b';\n  v2 text := replace(upper(v), old_x, new_x);`)]).length > 0);
if (bad) process.exit(1);

const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const p = problems(files);
if (p.length) { for (const x of p) console.error('✗ ' + x); process.exit(1); }
console.log(`✓ field_integrity scan: zero-area safe and never silent (${cases.length} mutation proofs)`);
