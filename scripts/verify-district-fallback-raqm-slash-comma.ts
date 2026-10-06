// The district resolver's fallback strips «رقم N», «/ <letter>» and «، <own city>» — and nothing else.
//
// Migration 20261006134519 (QA & Repair, 2026-10-06) extends the 20261005131351 fallback with three
// suffixes measured on 579 of 8,567 no-district listings: a plan number after «رقم» («الراشدية رقم 809
// / أ»), a block letter after a slash («النزهة / ب»), and the listing's own city after an Arabic comma
// («العزيزية ، الهفوف»). 101 of them then name a district already attested in that city.
//
// The risk is the WRONG district, never an invented one (the retry still goes through the attested
// lookup). So this barrier EXECUTES the migration's own patterns — lifted from the committed SQL, not
// retyped — together with the unchanged digit and compass guards of 20261005131351, in both directions,
// and proves that loosening any of them is caught.
//
//   node --experimental-strip-types scripts/verify-district-fallback-raqm-slash-comma.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const mig = readFileSync(
  join(root, 'supabase/migrations/20261006134519_district_resolver_strips_raqm_slash_letter_and_comma_city.sql'), 'utf8');
const base = readFileSync(
  join(root, 'supabase/migrations/20261005131351_district_resolver_city_suffix_and_plan_number_fallback.sql'), 'utf8');

function problems(mig: string, base: string): string[] {
  const fail: string[] = [];
  const lift = (src: string, re: RegExp, what: string): string => {
    const m = src.match(re);
    if (!m) { fail.push(`could not find ${what}`); return '(?!)'; }
    return m[1];
  };
  const planRe = lift(base, /v2 := regexp_replace\(v, '([^']+)', ''\);/, 'the base plan-number pattern');
  const digitGuard = lift(base, /v2 !~ '(\[0-9[^']+)'/, 'the digit guard');
  const compassGuard = lift(base, /v2 !~ '(\^\(حي[^']+)'/, 'the compass-word guard');
  const newPlan = mig.match(/new_plan text := \$q\$([\s\S]*?)\$q\$;/)?.[1] ?? '';
  const raqmRe = lift(newPlan, /v2 := regexp_replace\(v2, '(\\s\*رقم[^']+)', ''\);/, 'the «رقم» pattern');
  const slashRe = lift(newPlan, /v2 := regexp_replace\(v2, '(\\s\*\/[^']+)', ''\);/, 'the slash-letter pattern');
  const cityPrefix = lift(mig, /new_city text := \$q\$v2 := regexp_replace\(v2, '([^']+)' \|\| c/, 'the new city-suffix pattern');
  if (!/\(length\(old_def\) - length\(replace\(old_def, old_plan, ''\)\)\) \/ length\(old_plan\) <> 1/.test(mig))
    fail.push('the plan-line replace is no longer occurrence-guarded');
  if (!/\(length\(old_def\) - length\(replace\(old_def, old_city, ''\)\)\) \/ length\(old_city\) <> 1/.test(mig))
    fail.push('the city-line replace is no longer occurrence-guarded');

  const js = (p: string) => new RegExp(p, 'u');
  // One fallback step as the function runs it (the function then recurses through the attested lookup).
  function retry(v: string, city: string): string | null {
    let v2 = v.replace(js(planRe), '');
    v2 = v2.replace(js(raqmRe), '');
    v2 = v2.replace(js(slashRe), '');
    v2 = v2.replace(new RegExp(cityPrefix + city + '$', 'u'), '');
    v2 = v2.trim();
    if (v2 !== v && v2 !== '' && !js(digitGuard).test(v2) && !js(compassGuard).test(v2)) return v2;
    return null;
  }
  const must: Array<[string, string, string]> = [
    ['النزهة / ب', 'الاحساء', 'النزهة'],
    ['الراشدية رقم 809 / أ', 'الاحساء', 'الراشدية'],
    ['الفيصلية رقم 2', 'الاحساء', 'الفيصلية'],
    ['العزيزية ، الهفوف رقم 741 / أ', 'الهفوف', 'العزيزية'],
    ['السلام ، المبرز', 'المبرز', 'السلام'],
    ['شرق حي الملك فهد رقم 17/2', 'الاحساء', 'شرق حي الملك فهد'],
    // the 20261005131351 cases still hold
    ['الامراء الهفوف', 'الهفوف', 'الامراء'],
    ['منيفة - الهفوف', 'الهفوف', 'منيفة'],
    ['الراشدية (126/4) أ', 'الاحساء', 'الراشدية'],
  ];
  const mustNot: Array<[string, string, string]> = [
    ['الغسانية 2 رقم 5', 'الهفوف', 'the retry keeps a number'],
    ['الصفا ١ (93/14)', 'الاحساء', 'a number the source prints as part of the name'],
    ['شمال بريدة', 'بريدة', 'a compass word is a part of town'],
    ['جنوب رقم 4', 'الاحساء', 'a compass word alone after the strip'],
    ['النزهة / 2', 'الاحساء', 'a slash number is not a block letter'],
    ['السلام ، الرياض', 'المبرز', 'another city after the comma is not stripped'],
    ['الرابية', 'الهفوف', 'nothing to strip, so no retry'],
    ['المحدود رقم 3 ، النزهة', 'الاحساء', 'a second place after the comma: which one is meant is unknown'],
  ];
  for (const [v, c, want] of must) {
    const got = retry(v, c);
    if (got !== want) fail.push(`«${v}» in ${c}: expected retry «${want}», got ${got === null ? 'no retry' : `«${got}»`}`);
  }
  for (const [v, c, why] of mustNot) {
    const got = retry(v, c);
    if (got !== null && !(why.startsWith('a slash number') && js(digitGuard).test(got)))
      fail.push(`«${v}» in ${c} must NOT retry (${why}), got «${got}»`);
  }
  return fail;
}

const fail = problems(mig, base);
function mustCatch(label: string, m: string, b: string = base): void {
  if (m === mig && b === base) { fail.push(`mutation «${label}» did not change the SQL (stale needle)`); return; }
  if (problems(m, b).length === 0) fail.push(`mutation NOT caught: ${label}`);
}
mustCatch('«رقم» strip removed', mig.replace(/\n {8}v2 := regexp_replace\(v2, '\\s\*رقم[^\n]+/, ''));
mustCatch('slash strip admits any character', mig.replace('[أابجدهو]', '.'));
mustCatch('«رقم» strip eats across a comma', mig.replace('[^،]*$', '.*$'));
mustCatch('city strip loses the comma', mig.replace("'\\s*[-–/،,]*\\s*ب?' || c", "'\\s*[-–/]?\\s*ب?' || c"));
mustCatch('city-line replace not occurrence-guarded', mig.replace('length(old_city) <> 1', 'length(old_city) < 0'));
mustCatch('digit guard dropped in the base', mig, base.replace(" and v2 !~ '[0-9٠-٩]'", ''));

if (fail.length) {
  console.error('❌ district fallback «رقم» / slash-letter / comma-city:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('✅ district fallback «رقم» / slash-letter / comma-city: 9 strips + 8 refusals hold; 6 mutations caught');
