// AN AD LICENCE WE ALREADY SAVED REACHES SEARCH (owner 2026-11-10: «fetch everything»).
//
// 107 arms of listing_extra_attrs / _v0 / _v1 read «NULL::text AS license_number» while their tables held the site's
// REGA ad licence (the license_number column, the card's additional_info.rega_ad_license_number, or both). The card
// showed it; search, the «مرخص» filter and the «same licence = one home» rules did not. About 4,800 ads.
//
// The rule lives in ONE SQL function, rega_ad_licence_saved(col, extras). This check
//   1. lifts the licence SHAPE out of the committed function and EXECUTES it on the values really seen saved
//      (a broker FAL licence, a commercial register number, two licences glued together and a place name must stay out);
//   2. holds the rest of the rule in place (the card key, a list-shaped extras box states ONE licence, a column that
//      disagrees with the card is empty) — each with a mutation that must be caught;
//   3. holds the barrier in place: af_view_dropped_answers() names an arm that reads NULL over saved licences;
//   4. fails on any LATER migration that writes a hard-coded NULL licence into a listing_extra_attrs arm.
//
//   node --experimental-strip-types scripts/verify-saved-licence-reaches-search.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? '.', '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  → ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const dir = join(root, 'supabase/migrations');
const migs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const text = (f: string) => readFileSync(join(dir, f), 'utf8');
const DEF = /create or replace function public\.rega_ad_licence_saved\(p_col text, p_info jsonb\)[\s\S]*?as \$f\$([\s\S]*?)\$f\$;/;
const defining = migs.filter((f) => DEF.test(text(f)));
check('a committed migration defines rega_ad_licence_saved(col, extras)', defining.length > 0);
const first = defining[0] ?? '';
const body = defining.length ? (text(defining[defining.length - 1]).match(DEF)?.[1] ?? '') : '';

// ── 1. the shape, executed ───────────────────────────────────────────────────────────────────────────────────────────
const shapes = [...body.matchAll(/from '(\^[^']+\$)'/g)].map((m) => m[1]);
const shapeProblems = (list: string[]): string[] => {
  const out: string[] = [];
  if (list.length !== 3) out.push(`expected the shape on the column, the card key and the list value (3), found ${list.length}`);
  if (new Set(list).size > 1) out.push('the three reads do not share one shape');
  let re: RegExp;
  try { re = new RegExp(list[0] ?? '(?!)'); } catch { return [...out, 'the shape is not a readable pattern']; }
  for (const ok of ['7200123456', '7100000001']) if (!re.test(ok)) out.push(`a REGA ad licence (${ok}) is not read`);
  // every value below was seen saved in a licence column or under the card key, and is NOT an ad licence
  for (const bad of ['1100043722', '2100022228', '6200695758', '6200923742', '1200012345', '7200931943-7200931934', 'عنيزة', '122312432434', '72001234567', '720012345', '7300123456', ''])
    if (re.test(bad)) out.push(`«${bad}» is read as an ad licence`);
  return out;
};
check('only a REGA ad licence shape is read (10 digits starting 71 or 72), the same on all three reads', shapeProblems(shapes).length === 0, shapeProblems(shapes).join('; '));
mustCatch('a broker FAL licence (12…) or a register number (11…, 62…) accepted', shapeProblems(shapes.map(() => '^[0-9]{10}$')).length > 0);
mustCatch('two licences glued together accepted (no anchors)', shapeProblems(shapes.map(() => '7[12][0-9]{8}')).length > 0);
mustCatch('the column read with a looser shape than the card', shapeProblems(['^[0-9]+$', ...shapes.slice(1)]).length > 0);

// ── 2. the rest of the rule ──────────────────────────────────────────────────────────────────────────────────────────
const RULES: Array<[string, RegExp]> = [
  ['a column and a card that disagree are EMPTY (we do not pick one)', /case when a\.col is not null and a\.key is not null and a\.col <> a\.key then null\s+else coalesce\(a\.col, a\.key\) end/],
  ['the card key is rega_ad_license_number (never a fal_/broker key)', /when 'object' then substring\(btrim\(p_info ->> 'rega_ad_license_number'\)/],
  ['a list-shaped extras box counts only its rega_ad_license_number entries', /jsonb_typeof\(e\) = 'object' and e ->> 'key' = 'rega_ad_license_number'/],
  ['…and only when it states ONE licence', /select case when count\(distinct q\.v\) = 1 then min\(q\.v\) end/],
  ['anything that is not an object or a list is silent (no else branch)', /end as key\) a\s*$/],
];
const problems = (sql: string) => RULES.filter(([, re]) => !re.test(sql)).map(([l]) => l);
for (const [l, re] of RULES) check(l, re.test(body));
for (const [label, from, to] of [
  ['a disagreement resolved by picking the column', 'a.col <> a.key then null', 'a.col <> a.key then a.col'],
  ['a broker key read as the ad licence', "p_info ->> 'rega_ad_license_number'", "p_info ->> 'fal_licence'"],
  ['any list entry\'s value read as a licence', " and e ->> 'key' = 'rega_ad_license_number'", ''],
  ['a list stating two licences answered with one of them', 'case when count(distinct q.v) = 1 then min(q.v) end', 'min(q.v)'],
] as const) { const m = body.replace(from, to); mustCatch(label, m !== body && problems(m).length > 0); }

const whole = defining.length ? text(defining[defining.length - 1]) : '';
check('the migration proves the rule in the database when it is applied (reads, refusals, disagreement)', /PROOF: a saved REGA ad licence was not read/.test(whole) && /PROOF: something that is not a REGA ad licence was read as one/.test(whole) && /PROOF: two different licences on one ad were not left empty/.test(whole));
check('…and refuses to finish while any arm still hard-codes a NULL licence', /PROOF: % arm\(s\) still hard-code a NULL licence/.test(whole));

// ── 3. the barrier ───────────────────────────────────────────────────────────────────────────────────────────────────
const BARRIER = /create or replace function public\.af_view_dropped_answers\(\)[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/;
const barrierFile = [...migs].reverse().find((f) => BARRIER.test(text(f))) ?? '';
const barrier = barrierFile ? (text(barrierFile).match(BARRIER)?.[1] ?? '') : '';
const B: Array<[string, RegExp]> = [
  ['the barrier still watches the eight yes/no answers', /NULL::boolean AS \(furnished\|elevator\|parking\|kitchen\|air_conditioner\|maid_room\|driver_room\|private_entrance\)/],
  ['the barrier names an arm that reads NULL for the licence', /position\('NULL::text AS license_number' in a\.p\) > 0/],
  ['…counted by the SAME rule the arms use, over active rows', /where x\.active and public\.rega_ad_licence_saved\(%s, x\.additional_info\) is not null/],
  ['…and reports it as license_number', /col := 'license_number'; stored_answers := n;/],
];
const bProblems = (sql: string) => B.filter(([, re]) => !re.test(sql)).map(([l]) => l);
check('the latest af_view_dropped_answers() is committed', barrier.length > 0);
for (const [l, re] of B) check(l, re.test(barrier));
mustCatch('the licence loop dropped from the barrier', bProblems(barrier.replace("position('NULL::text AS license_number' in a.p) > 0", 'false')).length > 0);
mustCatch('the barrier counting any saved text as a licence', bProblems(barrier.replace('public.rega_ad_licence_saved(%s, x.additional_info) is not null', 'x.license_number is not null')).length > 0);

// ── 4. no later migration writes a hard-coded NULL licence into an arm ───────────────────────────────────────────────
const HARD_NULL = /null::text\s+as\s+license_number/i;
const laterProblems = (files: Array<[string, string]>) => files.filter(([f, sql]) => f > first && !DEF.test(sql) && /listing_extra_attrs/.test(sql) && HARD_NULL.test(sql)).map(([f]) => f);
const later = laterProblems(migs.map((f) => [f, text(f)]));
check('no migration after the fix adds a listing_extra_attrs arm with a hard-coded NULL licence', first !== '' && later.length === 0,
  `${later.join(', ')} — write «rega_ad_licence_saved(x.license_number, x.additional_info) AS license_number» (or NULL::text for the column when the table has none)`);
mustCatch('a new platform arm added tomorrow with NULL::text AS license_number',
  laterProblems([['99999999999999_new_site_into_listing_extra_attrs.sql', "create or replace view public.listing_extra_attrs as … NULL::text AS license_number …"]]).length === 1);
check('…while an arm that reads the saved licence passes', laterProblems([['99999999999999_new_site_into_listing_extra_attrs.sql', 'create or replace view public.listing_extra_attrs as … rega_ad_licence_saved(NULL::text, x.additional_info) AS license_number …']]).length === 0);

if (failed) { console.error(`\n❌ verify-saved-licence-reaches-search: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-saved-licence-reaches-search: a saved REGA ad licence reaches search from every arm, and nothing else is read as one');
