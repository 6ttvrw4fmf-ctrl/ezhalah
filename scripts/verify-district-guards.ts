// THE DISTRICT LIST ONLY GROWS WITH REAL, SINGLE-SPELLED NAMES, AND A MAP ANSWER NEVER ADDS ONE (owner 2026-10-25).
//
// WHAT THIS PINS. Migration *_district_guards_owner_2026_10_25.sql puts the owner's guards in the database itself:
// loc_catalog_district refuses DELETE and TRUNCATE, refuses a new or renamed name that is a number / plan / base / street /
// road / villages / one letter, and refuses a spelling twin (district_twin_check); listing_pin_district refuses a district
// that is not on the list for that city and stores the list's own spelling; mon_detect_district_guards_missing() raises P1
// if a trigger is dropped or disabled, and is rostered. Migration *_district_guards_strong_twin_rule.sql («never
// duplicates», owner 2026-10-25) adds district_twin_strong(): a name is also refused when its LETTERS equal a listed name
// (spaces, punctuation and a trailing ا/ه/ء ignored), equal it without «ال», equal it without the town's name stuck on,
// or are ONE letter away; and the owner exception must NAME the district. Because any later migration can redefine
// trg_district_list_guard(), the clauses are checked on the LATEST definition in the tree, not the first.
//
//   node --experimental-strip-types scripts/verify-district-guards.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const read = (n: string) => readFileSync(join(dir, n), 'utf8');
const find = (re: RegExp, what: string): string => {
  const f = all.filter((n) => re.test(n)).at(-1);
  if (!f) { console.log(`FAIL  migration ${what} is missing`); process.exit(1); }
  return f;
};
const file = find(/^\d{14}_district_guards_owner_2026_10_25\.sql$/, '*_district_guards_owner_2026_10_25.sql');
const strongFile = find(/^\d{14}_district_guards_strong_twin_rule\.sql$/, '*_district_guards_strong_twin_rule.sql');
const sql = read(file);
const strongSql = read(strongFile);
const later = all.filter((n) => n > file).map((n) => ({ n, s: read(n) }));
const TRIGGERS = ['trg_zz_district_list_guard', 'trg_zz_district_list_no_truncate', 'trg_pin_district_on_list'];
const JUNK = ['مخطط', 'مخططات', 'قاعده', 'شارع', 'طريق', 'قري'];
const LIST_FN = /create or replace function public\.trg_district_list_guard\(\)[\s\S]*?\$function\$;/;

// The list guard as production will run it: the LAST definition in migration order.
function latestListFn(files: { n: string; s: string }[]): { n: string; fn: string } {
  let out = { n: '', fn: '' };
  for (const { n, s } of files) { const m = s.match(LIST_FN)?.[0]; if (m) out = { n, fn: m }; }
  return out;
}

function listFnProblems(list: string): string[] {
  const fail: string[] = [];
  if (!list) return ['trg_district_list_guard() is not defined'];
  if (!/if tg_op in \('DELETE', 'TRUNCATE'\) then\s+raise exception 'district list guard: districts are never deleted/.test(list)) fail.push('a district can be deleted');
  if (!/new\.district_ar ~ '\[0-9٠-٩\]'/.test(list)) fail.push('a name with a number can be added');
  const junk = list.match(/v_norm ~ '\(\^\|\\s\)\(([^)]*)\)\(\\s\|\$\)'/)?.[1]?.split('|') ?? [];
  for (const w of JUNK) if (!junk.includes(w)) fail.push(`a «${w}» name can be added`);
  if (!/char_length\(v_norm\) < 2/.test(list)) fail.push('a one-letter name can be added');
  if (!/district_twin_check\(new\.city_id, new\.district_ar\)/.test(list) || !/v_twin\.verdict = 'twin'/.test(list)) fail.push('a spelling twin can be added');
  if (!/new\.district_norm := coalesce\(new\.district_norm, v_norm\);/.test(list)) fail.push('a new name can arrive without its norm (the unique index would not see a repeat)');
  if (/v_ok is not null[^;]*then\s+return new;[\s\S]*if tg_op in \('DELETE'/.test(list)) fail.push('the owner exception switch also unlocks deleting');
  if (!/district_twin_strong\(new\.city_id, new\.district_ar/.test(list)) fail.push('the strong twin rule is not consulted (letters / «ال» / town name / one letter away)');
  if (!/if v_strong\.twin_ar is not null then\s+raise exception 'district list guard: «%» is the same district as «%»/.test(list)) fail.push('a strong twin is not refused');
  if (!/v_ok is not null and public\.norm_district_tok\(v_ok\) = v_norm/.test(list)) fail.push('the owner exception does not have to name the district (any value unlocks everything)');
  return fail;
}

function strongProblems(s: string): string[] {
  const fail: string[] = [];
  const key = s.match(/create or replace function public\.district_key_letters\(p text\)[\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!key) fail.push('district_key_letters() is not defined');
  else {
    if (!/'\[\^ء-ي\]', '', 'g'/.test(key)) fail.push('the letters key keeps spaces / punctuation');
    if (!/'\[اهء\]\+\$', ''/.test(key)) fail.push('the letters key keeps the trailing ا/ه/ء («غبيرا» ≠ «غبيرة»)');
  }
  if (!/create or replace function public\.district_edit_distance\(a text, b text\)/.test(s)) fail.push('district_edit_distance() is not defined');
  const tw = s.match(/create or replace function public\.district_twin_strong\([\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!tw) fail.push('district_twin_strong() is not defined');
  else {
    if (!/when c\.k1 = q\.k1 then 'same letters'/.test(tw)) fail.push('same-letters copies pass');
    if (!/when replace\(c\.k1, 'ال', ''\) = q\.k2 then 'same letters without «ال»'/.test(tw)) fail.push('«ال» copies pass');
    if (!/when q\.town <> '' and \(/.test(tw) || !/'same letters without the town name'/.test(tw) || !/\|\| q\.town \|\| '\$', ''\), '\[اهء\]\+\$', ''\) = c\.k1/.test(tw)) fail.push('town-suffix copies pass (or the key keeps its last letter after the town is removed)');
    if (!/length\(q\.k1\) >= 5 and length\(c\.k1\) >= 5/.test(tw) || !/public\.district_edit_distance\(q\.k1, c\.k1\) <= 1 then 'one letter away'/.test(tw)) fail.push('one-letter-away copies pass');
  }
  for (const p of ['PROOF: «الملقا» was not refused', 'PROOF: «غبيرا» was not refused', 'PROOF: «البغددية الشرقية» was not refused', 'PROOF: «حي أشبيلية - بقيق» was not refused', 'PROOF: «حي ضمان الحراسة - بقيق» was not refused', 'PROOF: a wrong exception name unlocked the guard', 'PROOF: the exception allowed a delete']) {
    if (!s.includes(p)) fail.push(`the apply-time proof lost: ${p}`);
  }
  return fail;
}

function guardProblems(s: string): string[] {
  const fail: string[] = [];
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

// NEVER DUPLICATES FOR EVERY LISTING (owner 2026-10-25): the LATEST definitions of the letters key, district_copy_of() and
// loc_display_district_ar() in migration order, and the served-twins alarm. Pinned on the latest text because any later
// migration may redefine them.
const latestDef = (files: { n: string; s: string }[], re: RegExp): { n: string; fn: string } => {
  let out = { n: '', fn: '' };
  for (const { n, s } of files) { const m = s.match(re)?.[0]; if (m) out = { n, fn: m }; }
  return out;
};
const KEY_RE = /create or replace function public\.district_key_letters\(p text\)[\s\S]*?\$function\$;/;
const FINISH_RE = /create or replace function public\.district_key_finish\(p text\)[\s\S]*?\$function\$;/;
const COPY_RE = /create or replace function public\.district_copy_of\(p_city_id integer, p_raw text\)[\s\S]*?\$function\$;/;
const DISPLAY_RE = /CREATE OR REPLACE FUNCTION public\.loc_display_district_ar\([\s\S]*?\$function\$;/;
const TWINS_RE = /create or replace function public\.mon_detect_district_served_twins\(\)[\s\S]*?\$function\$;/;

function everyListingProblems(files: { n: string; s: string }[]): string[] {
  const fail: string[] = [];
  const finish = latestDef(files, FINISH_RE).fn;
  if (!finish) fail.push('district_key_finish() is not defined');
  else {
    if (!/when p ~ 'ء\$' then p/.test(finish)) fail.push('a final hamza is dropped («الزهراء» would equal «الزهرة»)');
    if (!/regexp_replace\(p, '\[اه\]\+\$', '#'\)/.test(finish)) fail.push('a final ا/ه run is not turned into one marker («غبيرا» ≠ «غبيرة», or «السلام» = «السلامة»)');
  }
  const key = latestDef(files, KEY_RE).fn;
  if (!key) fail.push('district_key_letters() is not defined');
  else {
    if (!/'\[\^ء-ي\]', '', 'g'/.test(key)) fail.push('the letters key keeps spaces / punctuation');
    if (!/public\.district_key_finish\(base\)/.test(key)) fail.push('the letters key does not use the shared end rule');
    if (!/'\|' \|\| tl/.test(key) || !/\(\^\|\\s\)\[ء-ي\]\$/.test(key)) fail.push('a one-letter sequel tail is lost («الجابرية أ» would equal «الجابرية»)');
  }
  const copy = latestDef(files, COPY_RE).fn;
  if (!copy) fail.push('district_copy_of() is not defined');
  else {
    if (!/if exists \(select 1 from public\.loc_catalog_district f where f\.city_id = p_city_id and f\.district_norm = n\) then return null; end if;/.test(copy)) fail.push('a name that is on the list could be folded onto another name');
    if (!/public\.district_key_letters\(b\.district_ar\) = k1 limit 1/.test(copy)) fail.push('same-letters copies are not folded');
    if (!/replace\(public\.district_key_letters\(b\.district_ar\), 'ال', ''\) = k2 limit 1/.test(copy)) fail.push('«ال» copies are not folded');
    if (!/k1s := public\.district_key_finish\(regexp_replace\(regexp_replace\(k1, '\^\(ب\)\?' \|\| town, ''\), '\(ب\)\?' \|\| town \|\| '\$', ''\)\);/.test(copy)) fail.push('town-suffix copies are not folded with the shared end rule');
    if (/district_edit_distance/.test(copy)) fail.push('a one-letter-away name is folded by itself (the owner decides those)');
  }
  const display = latestDef(files, DISPLAY_RE).fn;
  if (!display) fail.push('loc_display_district_ar() is not defined');
  else if (!/public\.district_copy_of\(p_city_id, p_raw\),\s+norm_district_tok\(p_raw\)\) as key/.test(display)) fail.push('loc_display_district_ar() no longer folds copy spellings for every listing (district_copy_of is not consulted before the raw name)');
  const twins = latestDef(files, TWINS_RE).fn;
  if (!twins) fail.push('the served-twins alarm is not defined');
  else {
    for (const k of ['district_copies_served', 'district_copies_unlisted', 'district_near_twins_served']) if (!twins.includes(`'${k}'`)) fail.push(`the alarm no longer raises ${k}`);
    if (!/mon_raise\('P1', 'district_copies_served'/.test(twins)) fail.push('a copy pair the fold missed is not P1');
  }
  if (!files.some(({ s }) => /'''mon_detect_district_served_twins'', ' \|\| anchor/.test(s))) fail.push('the served-twins alarm is not rostered in mon_run_all_detectors');
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

const tree = all.map((n) => ({ n, s: read(n) }));
const live = latestListFn(tree);
check(`${file}: triggers, pin guard, alarm, roster, proof`, guardProblems(sql));
check(`${live.n}: the LATEST trg_district_list_guard() holds every clause`, listFnProblems(live.fn));
check(`${strongFile}: the strong twin rule is complete`, strongProblems(strongSql));
check('no later migration drops or disables a guard', laterProblems(later));

const mutFn = (from: string | RegExp, to: string) => {
  const m = live.fn.replace(from, to);
  if (m === live.fn) { failed++; console.log(`FAIL  mutation anchor not found in the list guard: ${from}`); }
  return m;
};
const mutStrong = (from: string | RegExp, to: string) => {
  const m = strongSql.replace(from, to);
  if (m === strongSql) { failed++; console.log(`FAIL  mutation anchor not found in the strong rule: ${from}`); }
  return m;
};
const mutSql = (from: string | RegExp, to: string) => {
  const m = sql.replace(from, to);
  if (m === sql) { failed++; console.log(`FAIL  mutation anchor not found: ${from}`); }
  return m;
};
mustCatch('deleting allowed', listFnProblems(mutFn("if tg_op in ('DELETE', 'TRUNCATE') then", "if false then")));
mustCatch('numbers allowed', listFnProblems(mutFn("new.district_ar ~ '[0-9٠-٩]'", "false")));
mustCatch('plan names allowed', listFnProblems(mutFn('(مخطط|مخططات|قاعده|شارع|طريق|قري)', '(مخططات|قاعده|شارع|طريق|قري)')));
mustCatch('spelling twins allowed', listFnProblems(mutFn("v_twin.verdict = 'twin'", "v_twin.verdict = 'never'")));
mustCatch('the strong rule not consulted', listFnProblems(mutFn(/select \* into v_strong from public\.district_twin_strong\([^;]*;/, 'v_strong := null;')));
mustCatch('a strong twin not refused', listFnProblems(mutFn('if v_strong.twin_ar is not null then', 'if false then')));
mustCatch('the exception unlocking any name', listFnProblems(mutFn('v_ok is not null and public.norm_district_tok(v_ok) = v_norm', 'v_ok is not null')));
mustCatch('a later migration redefining the list guard WITHOUT the strong rule', listFnProblems(latestListFn([...tree, { n: '99999999999999_x.sql', s: sql }]).fn));
mustCatch('the letters key keeping spaces', strongProblems(mutStrong("'[^ء-ي]', '', 'g'", "'[^ء-ي ]', '', 'g'")));
mustCatch('the letters key keeping the last letter', strongProblems(mutStrong("'[اهء]+$', ''", "'[ء]+$', ''")));
mustCatch('«ال» copies allowed', strongProblems(mutStrong("when replace(c.k1, 'ال', '') = q.k2 then 'same letters without «ال»'", "when false then 'x'")));
mustCatch('town-suffix copies allowed', strongProblems(mutStrong("when q.town <> '' and (", "when false and (")));
mustCatch('the town-stripped key keeping its last letter', strongProblems(mutStrong(/\), '\[اهء\]\+\$', ''\) = c\.k1/, ") = c.k1")));
mustCatch('one-letter-away copies allowed', strongProblems(mutStrong('public.district_edit_distance(q.k1, c.k1) <= 1', 'false')));
mustCatch('the delete trigger dropped from the list guard', guardProblems(mutSql('or update of district_ar, city_id or delete on public.loc_catalog_district', 'or update of district_ar, city_id on public.loc_catalog_district')));
mustCatch('truncate allowed', guardProblems(mutSql(/create trigger trg_zz_district_list_no_truncate[\s\S]*?;/, '')));
mustCatch('a pin district off the list accepted', guardProblems(mutSql('if v_list is null then\n    raise exception', 'if false then\n    raise exception')));
mustCatch('a pin district keeping the map spelling', guardProblems(mutSql('new.district_ar := v_list;', '')));
mustCatch('the alarm not watching the pin guard', guardProblems(mutSql("'trg_zz_district_list_no_truncate', 'trg_pin_district_on_list']", "'trg_zz_district_list_no_truncate']")));
mustCatch('the alarm not rostered', guardProblems(mutSql("d := replace(d, anchor, '''mon_detect_district_guards_missing'', ' || anchor);", '')));
mustCatch('a later migration dropping the list guard', laterProblems([{ n: '99999999999999_x.sql', s: 'drop trigger if exists trg_zz_district_list_guard on public.loc_catalog_district;' }]));
mustCatch('a later migration disabling all triggers', laterProblems([{ n: '99999999999999_x.sql', s: 'alter table public.loc_catalog_district disable trigger all;' }]));
check('a later migration that re-creates the trigger is fine', laterProblems([{ n: '99999999999999_x.sql', s: 'drop trigger if exists trg_pin_district_on_list on x;\ncreate trigger trg_pin_district_on_list before insert on x;' }]));

check('every listing: copy spellings fold to the list name, key v2, served-twins alarm', everyListingProblems(tree));
const keyFile = latestDef(tree, KEY_RE).n, copyFile = latestDef(tree, COPY_RE).n, finishFile = latestDef(tree, FINISH_RE).n;
const mutTree = (file: string, from: string | RegExp, to: string) => tree.map((f) => {
  if (f.n !== file) return f;
  const m = f.s.replace(from, to);
  if (m === f.s) { failed++; console.log(`FAIL  mutation anchor not found in ${file}: ${from}`); }
  return { n: f.n, s: m };
});
mustCatch('a final hamza dropped («الزهراء» = «الزهرة»)', everyListingProblems(mutTree(finishFile, "when p ~ 'ء$' then p", "when false then p")));
mustCatch('a final ا/ه deleted instead of marked («السلام» = «السلامة»)', everyListingProblems(mutTree(finishFile, "regexp_replace(p, '[اه]+$', '#')", "regexp_replace(p, '[اه]+$', '')")));
mustCatch('a sequel tail lost («الجابرية أ» = «الجابرية»)', everyListingProblems(mutTree(keyFile, "'|' || tl", "''")));
mustCatch('a listed name folded onto another', everyListingProblems(mutTree(copyFile, 'if exists (select 1 from public.loc_catalog_district f where f.city_id = p_city_id and f.district_norm = n) then return null; end if;', '')));
mustCatch('one-letter names folded by themselves', everyListingProblems(mutTree(copyFile, 'return v;\nend $function$;', 'return coalesce(v, (select b.district_norm from public.loc_catalog_district b where public.district_edit_distance(public.district_key_letters(b.district_ar), k1) <= 1 limit 1));\nend $function$;')));
mustCatch('the fold removed from loc_display_district_ar', everyListingProblems(mutTree(latestDef(tree, DISPLAY_RE).n, 'public.district_copy_of(p_city_id, p_raw),\n                     norm_district_tok(p_raw)) as key', 'norm_district_tok(p_raw)) as key')));
mustCatch('the served-twins alarm not rostered', everyListingProblems(tree.map((f) => ({ n: f.n, s: f.s.replace("'''mon_detect_district_served_twins'', ' || anchor", "anchor") }))));

if (failed) { console.log(`\ndistrict guards: ${failed} problem(s)`); process.exit(1); }
console.log('\ndistrict guards: all checks passed');
