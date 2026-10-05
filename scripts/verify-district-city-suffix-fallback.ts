// The district resolver's city-suffix fallback must strip ONLY what is not part of a district's name.
//
// Migration 20261005131351 taught resolve_district_ar() to retry once when a source prints the district
// followed by its city («الامراء الهفوف», «منيفة - الهفوف», «الدانة بالهفوف») or by a land-plan number and
// block letter («الراشدية (126/4) أ»). The retry still accepts only a district attested in that city, so
// the danger is not invention but the WRONG district: «الصفا ١» stripped to «الصفا», or «شمال بريدة»
// (north Buraydah) read as a district called الشمال.
//
// This barrier EXECUTES the migration's own patterns (lifted from the committed SQL, not retyped) against
// both directions, and fails if a guard is removed or a pattern loosened.
//
//   node --experimental-strip-types scripts/verify-district-city-suffix-fallback.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const sql = readFileSync(
  join(root, 'supabase/migrations/20261005131351_district_resolver_city_suffix_and_plan_number_fallback.sql'),
  'utf8',
);

const fail: string[] = [];
const lift = (re: RegExp, what: string): string => {
  const m = sql.match(re);
  if (!m) { fail.push(`could not find ${what} in the migration`); return '(?!)'; }
  return m[1];
};

const planRe = lift(/v2 := regexp_replace\(v, '([^']+)', ''\);/, 'the plan-number pattern');
const cityPrefix = lift(/v2 := regexp_replace\(v2, '([^']+)' \|\| c \|\| '\$', ''\);/, 'the city-suffix pattern');
const cityGuard = lift(/if c ~ '([^']+)' then/, 'the plain-Arabic city guard');
const digitGuard = lift(/v2 !~ '(\[0-9[^']+)'/, 'the digit guard');
const compassGuard = lift(/v2 !~ '(\^\(حي[^']+)'/, 'the compass-word guard');

if (!/if result is null then/.test(sql)) fail.push('the fallback no longer runs only when the first lookup failed');
if (!/return public\.resolve_district_ar\(p_city_id, v2\)/.test(sql)) fail.push('the retry no longer goes back through the attested-district lookup');

// Postgres ARE → JS: \s and the bracket classes mean the same here.
const js = (p: string) => new RegExp(p, 'u');

// The fallback as the migration runs it. Returns the retry text, or null when it must not retry.
function retry(v: string, city: string): string | null {
  let v2 = v.replace(js(planRe), '');
  if (js(cityGuard).test(city)) v2 = v2.replace(new RegExp(cityPrefix + city + '$', 'u'), '');
  v2 = v2.trim();
  if (v2 !== v && v2 !== '' && !js(digitGuard).test(v2) && !js(compassGuard).test(v2)) return v2;
  return null;
}

const must: Array<[string, string, string]> = [
  ['الامراء الهفوف', 'الهفوف', 'الامراء'],
  ['منيفة - الهفوف', 'الهفوف', 'منيفة'],
  ['الحمراء الاول/الهفوف', 'الهفوف', 'الحمراء الاول'],
  ['الدانة بالهفوف', 'الهفوف', 'الدانة'],
  ['الراشدية (126/4) أ', 'الاحساء', 'الراشدية'],
  ['الجرن (53/14)', 'الاحساء', 'الجرن'],
  ['حي النور الدمام', 'الدمام', 'حي النور'],
];
const mustNot: Array<[string, string, string]> = [
  ['الصفا ١ (93/14)', 'الاحساء', 'a number the source prints as part of the name'],
  ['الغسانية 2', 'الهفوف', 'a bare trailing number'],
  ['شمال بريدة', 'بريدة', 'a compass word is a part of town, not a district'],
  ['وسط بريدة', 'بريدة', 'a compass word is a part of town, not a district'],
  ['الطائف', 'الطائف', 'the city alone is not a district'],
  ['الرابية', 'الهفوف', 'nothing to strip, so no retry'],
  ['الهفوف الجديدة', 'الهفوف', 'a LEADING city word is part of the name'],
];

for (const [v, c, want] of must) {
  const got = retry(v, c);
  if (got !== want) fail.push(`«${v}» in ${c}: expected retry «${want}», got ${got === null ? 'no retry' : `«${got}»`}`);
}
for (const [v, c, why] of mustNot) {
  const got = retry(v, c);
  if (got !== null) fail.push(`«${v}» in ${c} must NOT retry (${why}), got «${got}»`);
}
// A city name with regex metacharacters must never be spliced in.
if (js(cityGuard).test('مدينة (الملك)')) fail.push('the city guard admits regex metacharacters');

if (fail.length) {
  console.error('❌ district city-suffix fallback:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`✅ district city-suffix fallback: ${must.length} strips + ${mustNot.length} refusals hold`);
