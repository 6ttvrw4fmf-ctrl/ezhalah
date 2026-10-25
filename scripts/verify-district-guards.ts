// THE DISTRICT LIST ONLY GROWS WITH REAL, SINGLE-SPELLED NAMES, AND A MAP ANSWER NEVER ADDS ONE (owner 2026-10-25).
//
// WHAT THIS PINS. Migration *_district_guards_owner_2026_10_25.sql puts the owner's guards in the database itself:
// loc_catalog_district refuses DELETE and TRUNCATE, refuses a new or renamed name that is a number / plan / base / street /
// road / villages / one letter, and refuses a spelling twin (district_twin_check); listing_pin_district refuses a district
// that is not on the list for that city and stores the list's own spelling; mon_detect_district_guards_missing() raises P1
// if a trigger is dropped or disabled, and is rostered. Any LATER migration that drops or disables one of the triggers fails
// here too, unless it re-creates it.
//
//   node --experimental-strip-types scripts/verify-district-guards.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const file = all.filter((n) => /^\d{14}_district_guards_owner_2026_10_25\.sql$/.test(n)).at(-1);
if (!file) { console.log('FAIL  migration *_district_guards_owner_2026_10_25.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const later = all.filter((n) => n > file).map((n) => ({ n, s: readFileSync(join(dir, n), 'utf8') }));
const TRIGGERS = ['trg_zz_district_list_guard', 'trg_zz_district_list_no_truncate', 'trg_pin_district_on_list'];
const JUNK = ['مخطط', 'مخططات', 'قاعده', 'شارع', 'طريق', 'قري'];

function guardProblems(s: string): string[] {
  const fail: string[] = [];
  const list = s.match(/create or replace function public\.trg_district_list_guard\(\)[\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!list) return ['trg_district_list_guard() is not defined'];
  if (!/if tg_op in \('DELETE', 'TRUNCATE'\) then\s+raise exception 'district list guard: districts are never deleted/.test(list)) fail.push('a district can be deleted');
  if (!/new\.district_ar ~ '\[0-9٠-٩\]'/.test(list)) fail.push('a name with a number can be added');
  const junk = list.match(/v_norm ~ '\(\^\|\\s\)\(([^)]*)\)\(\\s\|\$\)'/)?.[1]?.split('|') ?? [];
  for (const w of JUNK) if (!junk.includes(w)) fail.push(`a «${w}» name can be added`);
  if (!/char_length\(v_norm\) < 2/.test(list)) fail.push('a one-letter name can be added');
  if (!/district_twin_check\(new\.city_id, new\.district_ar\)/.test(list) || !/v_twin\.verdict = 'twin'/.test(list)) fail.push('a spelling twin can be added');
  if (!/new\.district_norm := coalesce\(new\.district_norm, v_norm\);/.test(list)) fail.push('a new name can arrive without its norm (the unique index would not see a repeat)');
  if (/v_ok is not null then\s+return new;[\s\S]*if tg_op in \('DELETE'/.test(list)) fail.push('the owner exception switch also unlocks deleting');

  if (!/create trigger trg_zz_district_list_guard\s+before insert or update of district_ar, city_id or delete on public\.loc_catalog_district\s+for each row execute function public\.trg_district_list_guard\(\);/.test(s)) fail.push('the list guard trigger is not on insert / rename / delete');
  if (!/create trigger trg_zz_district_list_no_truncate\s+before truncate on public\.loc_catalog_district/.test(s)) fail.push('the list can be truncated');

  const pin = s.match(/create or replace function public\.trg_pin_district_on_list\(\)[\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!pin) fail.push('trg_pin_district_on_list() is not defined');
  else {
    if (!/from public\.loc_catalog_district c\s+where c\.city_id = new\.city_id\s+and c\.district_norm = public\.norm_district_tok\(public\.loc_display_district_ar\(new\.city_id, new\.district_ar\)\)/.test(pin)) fail.push('a pin district is not checked against that city\'s list');
    if (!/if v_list is null then\s+raise exception 'pin district guard/.test(pin)) fail.push('a pin district off the list is accepted');
    if (!/new\.district_ar := v_list;/.test(pin)) fail.push('a pin district keeps the map\'s spelling instead of the list\'s');
  }
  if (!/create trigger trg_pin_district_on_list\s+before insert or update of district_ar, city_id on public\.listing_pin_district/.test(s)) fail.push('the pin guard trigger is not on insert / change');

  const mon = s.match(/create or replace function public\.mon_detect_district_guards_missing\(\)[\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!mon) fail.push('the alarm mon_detect_district_guards_missing() is missing');
  else {
    for (const t of TRIGGERS) if (!mon.includes(`'${t}'`)) fail.push(`the alarm does not watch ${t}`);
    if (!/t\.tgenabled <> 'D'/.test(mon)) fail.push('the alarm does not notice a disabled trigger');
    if (!/mon_raise\('P1', 'district_guards_missing'/.test(mon)) fail.push('the alarm is not P1');
  }
  if (!/d := replace\(d, anchor, '''mon_detect_district_guards_missing'', ' \|\| anchor\);/.test(s)) fail.push('the alarm is not rostered in mon_run_all_detectors');
  if (!/do \$proof\$/.test(s) || !/PROOF: a delete was not refused/.test(s) || !/PROOF: a spelling twin was not refused/.test(s) || !/PROOF: a pin district off the list was not refused/.test(s)) fail.push('the apply-time proof is gone');
  return fail;
}

function laterProblems(files: { n: string; s: string }[]): string[] {
  const fail: string[] = [];
  for (const t of TRIGGERS) {
    let alive = true;
    for (const { n, s } of files) {
      const body = s.replace(/--.*$/gm, '');
      if (new RegExp(`drop trigger (if exists )?${t}\\b`, 'i').test(body) || new RegExp(`disable trigger (${t}|all)\\b`, 'i').test(body)) alive = false;
      if (new RegExp(`create trigger ${t}\\b`, 'i').test(body)) alive = true;
      if (!alive) { fail.push(`${n} drops or disables ${t} and does not re-create it`); break; }
    }
  }
  return fail;
}

let failed = 0;
const check = (name: string, problems: string[]) => {
  if (problems.length) { failed++; console.log(`FAIL  ${name}\n      ${problems.join('\n      ')}`); } else console.log(`PASS  ${name}`);
};
const mustCatch = (name: string, problems: string[]) => {
  if (!problems.length) failed++;
  console.log(`${problems.length ? 'PASS' : 'FAIL'}  (mutation) catches ${name}`);
};

check(`${file}: the guards are complete`, guardProblems(sql));
check('no later migration drops or disables a guard', laterProblems(later));

const mut = (from: string | RegExp, to: string) => {
  const m = sql.replace(from, to);
  if (m === sql) { failed++; console.log(`FAIL  mutation anchor not found: ${from}`); }
  return m;
};
mustCatch('deleting allowed', guardProblems(mut("if tg_op in ('DELETE', 'TRUNCATE') then", "if false then")));
mustCatch('numbers allowed', guardProblems(mut("new.district_ar ~ '[0-9٠-٩]'", "false")));
mustCatch('plan names allowed', guardProblems(mut('(مخطط|مخططات|قاعده|شارع|طريق|قري)', '(مخططات|قاعده|شارع|طريق|قري)')));
mustCatch('spelling twins allowed', guardProblems(mut("v_twin.verdict = 'twin'", "v_twin.verdict = 'never'")));
mustCatch('the delete trigger dropped from the list guard', guardProblems(mut('or update of district_ar, city_id or delete on public.loc_catalog_district', 'or update of district_ar, city_id on public.loc_catalog_district')));
mustCatch('truncate allowed', guardProblems(mut(/create trigger trg_zz_district_list_no_truncate[\s\S]*?;/, '')));
mustCatch('a pin district off the list accepted', guardProblems(mut('if v_list is null then\n    raise exception', 'if false then\n    raise exception')));
mustCatch('a pin district keeping the map spelling', guardProblems(mut('new.district_ar := v_list;', '')));
mustCatch('the alarm not watching the pin guard', guardProblems(mut("'trg_zz_district_list_no_truncate', 'trg_pin_district_on_list']", "'trg_zz_district_list_no_truncate']")));
mustCatch('the alarm not rostered', guardProblems(mut("d := replace(d, anchor, '''mon_detect_district_guards_missing'', ' || anchor);", '')));
mustCatch('a later migration dropping the list guard', laterProblems([{ n: '99999999999999_x.sql', s: 'drop trigger if exists trg_zz_district_list_guard on public.loc_catalog_district;' }]));
mustCatch('a later migration disabling all triggers', laterProblems([{ n: '99999999999999_x.sql', s: 'alter table public.loc_catalog_district disable trigger all;' }]));
check('a later migration that re-creates the trigger is fine', laterProblems([{ n: '99999999999999_x.sql', s: 'drop trigger if exists trg_pin_district_on_list on x;\ncreate trigger trg_pin_district_on_list before insert on x;' }]));

if (failed) { console.log(`\ndistrict guards: ${failed} problem(s)`); process.exit(1); }
console.log('\ndistrict guards: all checks passed');
