// A detector must call mon_raise() EVERY time its condition is true — never only when its alert is closed.
//
// THE DEFECT (alert_reaffirmation, open since 2026-10-23). Seven detectors wrote
//     v_open := exists (select 1 from alert_event where dedup_key = ... and resolved_at is null);
//     if <clean> then if v_open then resolve; end if;
//     elsif not v_open then  mon_raise(...)
// so while their alert stood, nothing re-affirmed it: the payload stayed the day it was raised,
// last_affirmed_at stayed NULL (pin_coverage_below_floor: raised 06:59, never affirmed) and severity
// could never escalate. mon_raise() already keeps one open row per dedup key and returns 0 for an open
// key, so the guard bought nothing and cost all of that.
//
// Production already watches this (mon_detect_alert_reaffirmation, LIMB B). This is the review-time half:
// a migration that (re)introduces the guard is RED on its PR instead of an alert the next sweep.
//
// HOW (hermetic). For every mon_detect_* function, take the LAST committed migration that either
// `create or replace`s it or patches it by name with replace(..., 'elsif not v_open then', 'else').
// If that last word is a definition carrying the guard, it fails. The SQL detector's two exemptions are
// mirrored exactly: mon_detect_alert_reaffirmation (it names the pattern) and a body that also carries an
// unguarded `else` arm that re-raises anyway.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const GUARD = 'elsif not v_open then';
const EXEMPT = new Set(['mon_detect_alert_reaffirmation']);

// A patch migration: it EXECUTES replace() over a live body, and the text it replaces is the guard, as a
// string literal (both shapes in the tree: 20260906110014's `a_old constant text := E'  elsif not v_open
// then'` and an inline `replace(d, 'elsif not v_open then', 'else')`). Every detector it names in a quoted
// literal has had the guard stripped as of that file.
const isGuardStrippingPatch = (sql: string) =>
  /execute\s+replace\(\s*d\s*,/.test(sql) && /E?'(?:\s|\\n)*elsif not v_open then'/.test(sql);

// THE SECOND SPELLING (🔧 2026-11-04). The same guard written inline, with no v_open variable:
//     elsif not exists (select 1 from public.alert_event where dedup_key = '…' and resolved_at is null) then
//       r := r + public.mon_raise(...)
// Four detectors used it and passed this barrier and LIMB B for weeks, because both searched for the one
// literal above: served_total_below_city_floor (P1) kept its 2026-10-18 payload — 430 rows while the live
// set was 147 — with last_affirmed_at NULL. Fixed in 20261108134701 (the guard becomes «else» on the four live bodies,
// via regexp_replace over pg_get_functiondef); LIMB B learned the spelling in 20261108140500.
// Comments are stripped first so a header that DESCRIBES the shape is not read as code.
export const INLINE_GUARD =
  /(?:if|elsif)\s+not\s+exists\s*\(\s*select\s+1\s+from\s+(?:public\.)?alert_event\b[^;]*?resolved_at\s+is\s+null\s*\)\s*then[^;]*?\bmon_raise\s*\(/i;
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, '');
export const isGuarded = (body: string) => {
  const code = stripSqlComments(body);
  const unguardedElse = /\n\s*else\n\s*(?:n|r) := (?:n|r) \+ public\.mon_raise/.test(code);
  return (code.includes(GUARD) || INLINE_GUARD.test(code)) && !unguardedElse;
};

// The inline spelling's own stripping patch (20261108134701): `regexp_replace(d, guard, 'else', 'g')` over the live
// body, `guard` being the inline not-exists literal. Every detector it names in a quoted literal is unguarded from then.
export const isInlineGuardStrippingPatch = (sql: string) =>
  /regexp_replace\(\s*d\s*,\s*guard\s*,\s*'else'/.test(sql) && /guard\s+constant\s+text\s*:=\s*'elsif not exists/.test(sql);

type Verdict = { name: string; file: string; guarded: boolean };

function lastWord(files: string[], opts: { ignoreInlinePatch?: boolean } = {}): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  for (const f of files) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    // definitions, in file order
    const defRe = /create\s+or\s+replace\s+function\s+(?:public\.)?(mon_detect_[a-z0-9_]+)\s*\(/gi;
    const starts = [...sql.matchAll(defRe)];
    starts.forEach((m, i) => {
      const body = sql.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index : sql.length);
      out.set(m[1], { name: m[1], file: f, guarded: isGuarded(body) });
    });
    // name-listed patches that strip the guard
    if (isGuardStrippingPatch(sql) || (!opts.ignoreInlinePatch && isInlineGuardStrippingPatch(sql))) {
      for (const n of sql.matchAll(/'(mon_detect_[a-z0-9_]+)'/g)) {
        const prev = out.get(n[1]);
        if (prev) out.set(n[1], { name: n[1], file: f, guarded: false });
      }
    }
  }
  return out;
}

const guardedOf = (m: Map<string, Verdict>) =>
  [...m.values()].filter((v) => v.guarded && !EXEMPT.has(v.name)).map((v) => v.name).sort();

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
// A mutation proof: `caught` is whether the check FAILED on the mutated (pre-fix / synthetic) input.
const mustCatch = (name: string, caught: boolean) => check(`mutation: ${name}`, caught);

console.log('verify-detectors-reaffirm-open-alerts: no detector skips mon_raise() while its own alert is open.');

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const now = guardedOf(lastWord(files));
check('every committed detector re-raises while its alert is open', now.length === 0,
  `still guarded (\`${GUARD}\` or the inline not-exists spelling): ${now.join(', ')}`);

// Mutation 1: the tree before the fix (every file up to and excluding the stripping patch) is caught.
const patchIdx = files.findLastIndex((f) => isGuardStrippingPatch(readFileSync(join(MIG, f), 'utf8')));
check('the guard-stripping patch is committed', patchIdx >= 0);
if (patchIdx >= 0) {
  const before = guardedOf(lastWord(files.slice(0, patchIdx)));
  mustCatch('the pre-fix tree is caught (the seven detectors alert_reaffirmation named)',
    ['mon_detect_pin_coverage_below_floor', 'mon_detect_place_list_leaks', 'mon_detect_district_guards_missing']
      .every((n) => before.includes(n)), `caught: ${before.join(', ') || 'nothing'}`);
}

// Mutation 2: a NEW definition that re-introduces the guard after the patch is caught.
{
  const m = lastWord(files);
  m.set('mon_detect_pin_coverage_below_floor', { name: 'mon_detect_pin_coverage_below_floor', file: 'synthetic', guarded: true });
  mustCatch('a later definition that re-adds the guard is caught', guardedOf(m).includes('mon_detect_pin_coverage_below_floor'));
}

// Mutation 3 (🔧 2026-11-04): the INLINE spelling, on the exact pre-fix body shape, and its repair.
{
  const BAD = `  if v_rows = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'k' and resolved_at is null) then
      perform public.mon_resolve('k', 'x');
    end if;
  elsif not exists (select 1 from public.alert_event where dedup_key = 'k' and resolved_at is null) then
    r := r + public.mon_raise('P1', 'k', 'x', 'k', '{}'::jsonb);
  end if;`;
  mustCatch('the inline not-exists guard is caught', isGuarded(BAD));
  check('…and the same body with «else» passes', !isGuarded(BAD.replace(/elsif not exists \([^)]*\) then/, 'else')));
  check('…and a comment that only DESCRIBES the shape is not read as code',
    !isGuarded(`-- elsif not exists (select 1 from public.alert_event where resolved_at is null) then mon_raise(\n  r := public.mon_raise('P1','k','x','k','{}');`));
  // The pre-fix tree (everything before 20261108134701) names the four this spelling hid.
  const fixIdx = files.findIndex((f) => f.startsWith('20261108134701'));
  check('the inline-guard fix migration is committed', fixIdx >= 0);
  if (fixIdx >= 0) {
    const before = guardedOf(lastWord(files.slice(0, fixIdx)));
    mustCatch('the pre-fix tree is caught (the four inline-guarded detectors)',
      ['mon_detect_served_total_below_city_floor', 'mon_detect_af_view_drops_stored_answer',
        'mon_detect_served_pin_outside_ksa', 'mon_detect_wasalt_street_width_misread'].every((n) => before.includes(n)),
      `caught: ${before.join(', ') || 'nothing'}`);
    // …and the recogniser of that patch is load-bearing: read blind to it, today's tree still carries the four.
    const blind = guardedOf(lastWord(files, { ignoreInlinePatch: true }));
    mustCatch('ignoring the inline-guard patch, today\'s tree is caught (the recogniser is not decoration)',
      blind.includes('mon_detect_served_total_below_city_floor'));
  }
}

if (failures) {
  console.log(`\n❌ verify-detectors-reaffirm-open-alerts: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-detectors-reaffirm-open-alerts: passed.');
