// One district, one search identity: a spelling sites use that IS one of our districts folds into it (owner 2026-10-25).
//
// THE DEFECT. Sites write «الهجلة الجديد», «الشبيكة الجديد», «السويفلة الجديد» for districts our list calls «الهجلة»,
// «الشبيكة», «السويفلة». norm_district_tok keeps «الجديد», so each name lived as TWO districts in search: a user who
// picked «الهجلة» never saw the 84 ads that said «الهجلة الجديد». A blanket «الجديد» fold is wrong, because some "new"
// names are separate districts («منفوحة الجديدة» next to «منفوحة» in الرياض), so the fold is a per-name, owner-approved
// spelling memory: public.loc_district_alias, applied inside loc_display_district_ar(). The served district_ar, its
// stored token, the picker and the counts then agree; cards keep the source's own words (they read the raw tables).
//
//   node --experimental-strip-types scripts/verify-district-spelling-memory.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_district_spelling_memory_new_suffix\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_district_spelling_memory_new_suffix.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');

// Names the owner has NOT approved as spellings of another district. They must never be seeded as an alias.
// («الدرعية الجديدة» and «الطريف الجديدة» left this list on 2026-10-25: the owner answered "same", then made
// «X الجديد = X» a permanent rule. What stays held are the names our own list keeps as separate districts.)
const HELD = ['منفوحة الجديدة', 'الشامية الجديد', 'الفلق الجديد'];

function problems(s: string): string[] {
  const fail: string[] = [];
  if (!/create table if not exists public\.loc_district_alias \(/.test(s)) fail.push('loc_district_alias is not created');
  if (!/primary key \(city_id, from_norm\)/.test(s)) fail.push('a spelling can map to two districts in one city (no (city_id, from_norm) key)');
  if (!/check \(from_norm <> to_norm\)/.test(s)) fail.push('an alias may point at itself');
  if (!/alter table public\.loc_district_alias enable row level security;/.test(s)) fail.push('row level security is off');
  if (!/revoke all on table public\.loc_district_alias from public, anon, authenticated;/.test(s)) fail.push('the alias table is readable by the public keys');

  const seed = s.match(/insert into public\.loc_district_alias[\s\S]*?on conflict \(city_id, from_norm\) do nothing;/)?.[0] ?? '';
  if (!seed) fail.push('the seed is missing or can overwrite an earlier decision');
  if (!/public\.norm_district_tok\(v\.site_spelling\), public\.norm_district_tok\(v\.our_district\), v\.why, 'owner'/.test(seed)) fail.push('seed keys are not built with norm_district_tok or are not marked as owner decisions');
  const rows = [...seed.matchAll(/\((\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)];
  if (rows.length === 0) fail.push('the seed has no rows');
  for (const [, , from, , why] of rows) {
    if (!/^owner \d{4}-\d{2}-\d{2}:/.test(why)) fail.push(`«${from}» is seeded without an owner decision`);
    for (const h of HELD) if (from.includes(h)) fail.push(`«${from}» is held (a possibly separate district) and must not be folded`);
  }
  if (!/where not exists \(select 1 from public\.loc_catalog_district d where d\.city_id = a\.city_id and d\.district_norm = a\.to_norm\);\s+if bad is not null then raise exception/.test(s)) fail.push('an alias may point at a district that is not in our list');

  const fn = s.match(/CREATE OR REPLACE FUNCTION public\.loc_display_district_ar\([\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!fn) { fail.push('loc_display_district_ar is not redefined'); return fail; }
  if (!/select a\.to_norm from public\.loc_district_alias a\s+where a\.city_id = p_city_id and a\.from_norm = norm_district_tok\(p_raw\)/.test(fn)) fail.push('the display does not consult the spelling memory in the same city');
  if (!/coalesce\(\s*\(select a\.to_norm[\s\S]*?\),\s*norm_district_tok\(p_raw\)\)/.test(fn)) fail.push('a name without an alias no longer keeps its own token');
  if (!/\), p_raw\)\s+end/.test(fn)) fail.push('an unknown name is no longer shown as the source wrote it');
  if (!/منفوحة الجديدة changed although it has no alias/.test(s)) fail.push('the apply-time proof no longer checks that a real «الجديدة» district is untouched');
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : ` — ${why}`}`); };
const mustCatch = (label: string, caught: boolean, why = '') => check(`mutant caught: ${label}`, caught, why);

const live = problems(sql);
check(`committed migration ${file} holds every pin`, live.length === 0, live.join('; '));

const mutants: Array<[string, (s: string) => string]> = [
  ['a held «new» district folded', (s) => s.replace("on conflict (city_id, from_norm) do nothing;", '').replace(") as v(city_id, site_spelling, our_district, why)", ",\n  (3, 'حي منفوحة الجديدة', 'حي منفوحة', 'owner 2026-10-25: x')\n) as v(city_id, site_spelling, our_district, why)\non conflict (city_id, from_norm) do nothing;")],
  ['a seed row without an owner decision', (s) => s.replace("'owner 2026-10-25: «الشبيكة الجديد» is «الشبيكة»'", "'looks the same'")],
  ['alias target not checked against our list', (s) => s.replace(/if bad is not null then raise exception[^;]*;/, 'null;')],
  ['display ignores the spelling memory', (s) => s.replace(/coalesce\(\s*\(select a\.to_norm from public\.loc_district_alias a\s+where a\.city_id = p_city_id and a\.from_norm = norm_district_tok\(p_raw\)\),\s*norm_district_tok\(p_raw\)\)/, 'norm_district_tok(p_raw)')],
  ['alias applied across cities', (s) => s.replace('where a.city_id = p_city_id and a.from_norm', 'where a.from_norm')],
  ['unknown names no longer shown as written', (s) => s.replace(/\), p_raw\)\s+end/, '), null)\n  end')],
  ['public keys can read the table', (s) => s.replace('revoke all on table public.loc_district_alias from public, anon, authenticated;', '')],
  ['a spelling can point at two districts', (s) => s.replace('primary key (city_id, from_norm),', '')],
  ['real «new» district proof removed', (s) => s.replace(/\n  if public\.loc_display_district_ar\(3, 'حي منفوحة الجديدة'\)[\s\S]*?end if;/, '')],
];
for (const [label, mutate] of mutants) {
  const m = mutate(sql);
  mustCatch(label, m !== sql && problems(m).length > 0, m === sql ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
}

// Every later migration that adds a spelling is held to the same rules: an owner decision, never a held name,
// never an overwrite, and the target checked against our list.
function seedProblems(name: string, s: string): string[] {
  const fail: string[] = [];
  // A seed runs to its ON CONFLICT clause: a «;» inside a why text (an owner's sentence) must not cut the statement short,
  // or the overwrite check below would judge half a statement (caught 2026-10-25 on batch_1).
  const seeds = [...s.matchAll(/insert into public\.loc_district_alias[\s\S]*?on conflict \(city_id, from_norm\) do (?:nothing|update[^;]*);/g)].map((m) => m[0]);
  for (const seed of seeds) {
    if (!/on conflict \(city_id, from_norm\) do nothing;$/.test(seed)) fail.push(`${name}: a seed can overwrite an earlier decision`);
    if (!/'owner'\s*\nfrom \(values/.test(seed) && !/v\.why, 'owner'/.test(seed)) fail.push(`${name}: a seed is not marked as an owner decision`);
    for (const [, , from, , why] of seed.matchAll(/\((\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)) {
      if (!/^owner \d{4}-\d{2}-\d{2}:/.test(why)) fail.push(`${name}: «${from}» is seeded without an owner decision`);
      for (const h of HELD) if (from.includes(h)) fail.push(`${name}: «${from}» is held and must not be folded`);
    }
  }
  if (seeds.length > 0 && !/if bad is not null then raise exception 'alias target not in loc_catalog_district/.test(s)) fail.push(`${name}: the alias targets are not checked against our list`);
  return fail;
}
const later = readdirSync(dir).filter((f) => f.endsWith('.sql') && f > file);
const laterFails = later.flatMap((f) => seedProblems(f, readFileSync(join(dir, f), 'utf8')));
check('every later spelling migration holds the same rules', laterFails.length === 0, laterFails.join('; '));
const fakeLater = "insert into public.loc_district_alias (city_id, from_norm, to_norm, why, decided_by)\nselect v.city_id, public.norm_district_tok(v.site_spelling), public.norm_district_tok(v.our_district), v.why, 'owner'\nfrom (values\n  (3, 'حي منفوحة الجديدة', 'حي منفوحة', 'owner 2026-10-26: x')\n) as v(city_id, site_spelling, our_district, why)\non conflict (city_id, from_norm) do nothing;\nif bad is not null then raise exception 'alias target not in loc_catalog_district: %', bad; end if;";
mustCatch('a later migration folds a held name', seedProblems('fake', fakeLater).length > 0);
mustCatch('a later migration skips the owner decision', seedProblems('fake', fakeLater.replace("'owner 2026-10-26: x'", "'same'").replace('منفوحة الجديدة', 'العزيزية الجديدة')).length > 0);
mustCatch('a later migration overwrites a decision', seedProblems('fake', fakeLater.replace('on conflict (city_id, from_norm) do nothing;', 'on conflict (city_id, from_norm) do update set to_norm = excluded.to_norm;').replace('منفوحة الجديدة', 'العزيزية الجديدة')).length > 0);

// The permanent rule (owner 2026-10-25): «X الجديد / X الجديدة» is X, but only when X is in our list for that city and
// the "new" name is not itself a district in our list.
const ruleFile = readdirSync(dir).filter((f) => /^\d{14}_district_new_suffix_permanent_rule\.sql$/.test(f)).sort().at(-1);
function ruleProblems(s: string): string[] {
  const fail: string[] = [];
  const fn = s.match(/CREATE OR REPLACE FUNCTION public\.loc_display_district_ar\([\s\S]*?\$function\$;/)?.[0] ?? '';
  if (!fn) { fail.push('the permanent rule does not redefine loc_display_district_ar'); return fail; }
  if (!/select a\.to_norm from public\.loc_district_alias a\s+where a\.city_id = p_city_id and a\.from_norm = norm_district_tok\(p_raw\)/.test(fn)) fail.push('the spelling memory is no longer consulted first');
  if (!/norm_district_tok\(p_raw\) ~ '\\s\+\(ال\)\?جديد\[ه\]\?\$'/.test(fn)) fail.push('the «الجديد / الجديدة» arm is gone');
  if (!/from public\.loc_catalog_district b[\s\S]*?b\.city_id = p_city_id[\s\S]*?b\.district_norm = regexp_replace\(norm_district_tok\(p_raw\)/.test(fn)) fail.push('the base district is no longer required to be in our list for this city');
  if (!/and not exists \(select 1 from public\.loc_catalog_district f\s+where f\.city_id = p_city_id and f\.district_norm = norm_district_tok\(p_raw\)\)/.test(fn)) fail.push('a "new" district that is its own district in our list would be folded («منفوحة الجديدة»)');
  if (!/,\s*p_raw\)\s+from \(select norm_district_tok\(p_raw\) as own,/.test(fn)) fail.push('an unknown name is no longer shown as the source wrote it');
  if (!/where t\.key <> t\.own and c\.city_id = p_city_id and c\.district_norm = t\.key/.test(fn)) fail.push('our list\'s own name may now replace names that were never folded');
  if (!/منفوحة الجديدة folded although our list has it as its own district/.test(s)) fail.push('the apply-time proof for «منفوحة الجديدة» is gone');
  if (!/الشامية الجديد changed although it is an official name/.test(s)) fail.push('the apply-time proof for official «… الجديد» names is gone');
  return fail;
}
if (!ruleFile) { check('migration *_district_new_suffix_permanent_rule.sql exists', false); }
else {
  const rs = readFileSync(join(dir, ruleFile), 'utf8');
  const lr = ruleProblems(rs);
  check(`committed migration ${ruleFile} holds the permanent «الجديد» rule`, lr.length === 0, lr.join('; '));
  const ruleMutants: Array<[string, (s: string) => string]> = [
    ['separate «new» districts folded too', (s) => s.replace(/\n\s*and not exists \(select 1 from public\.loc_catalog_district f\s+where f\.city_id = p_city_id and f\.district_norm = norm_district_tok\(p_raw\)\)/, '')],
    ['base no longer checked against our list', (s) => s.replace('from public.loc_catalog_district b', 'from public.loc_display_district_canon b')],
    ['rule applied across cities', (s) => s.replace('and b.city_id = p_city_id', '')],
    ['spelling memory dropped', (s) => s.replace(/\(select a\.to_norm from public\.loc_district_alias a\s+where a\.city_id = p_city_id and a\.from_norm = norm_district_tok\(p_raw\)\),/, '')],
    ['«منفوحة الجديدة» proof removed', (s) => s.replace(/\n  if public\.loc_display_district_ar\(3, 'حي منفوحة الجديدة'\)[\s\S]*?end if;/, '')],
    ['catalog name replaces names that were never folded', (s) => s.replace('where t.key <> t.own and c.city_id', 'where c.city_id')],
  ];
  for (const [label, mutate] of ruleMutants) {
    const m = mutate(rs);
    mustCatch(`rule: ${label}`, m !== rs && ruleProblems(m).length > 0, m === rs ? 'mutation did not apply (pattern drifted)' : 'verdict stayed green');
  }
}

console.log(failed === 0 ? 'OK: one district has one search identity; only owner-approved spellings fold' : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
