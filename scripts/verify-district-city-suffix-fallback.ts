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

// ── Al-Ahsa dahiyah ordinals (20261005131858): «الضاحية الحي X» → the attested «ضاحية هجر(الحي X)» / «هجر X».
const ord = readFileSync(
  join(root, 'supabase/migrations/20261005131858_district_resolver_al_ahsa_dahiyah_ordinals.sql'),
  'utf8',
);
const ordM = ord.match(/and k ~ '([^']+)' then/);
if (!ordM) fail.push('could not find the Al-Ahsa ordinal pattern');
if (!/if result is null and p_city_id = 3677/.test(ord)) fail.push('the ordinal rule is no longer scoped to Al-Ahsa (3677) or no longer runs only on a miss');
// Both targets must be LOOKUPS in the attested catalog, never a string returned as-is.
if ((ord.match(/from public\.loc_canonical_district d\s+where d\.city_id = 3677/g) ?? []).length !== 2) {
  fail.push('the ordinal targets are no longer both looked up in the attested catalog for 3677');
}
if (ordM) {
  const re = js(ordM[1]);
  for (const k of ['ضاحيه الحي الرابع', 'ضاحيه هجر الحي الحادي عشر', 'ضاحيه الحي الاول']) {
    if (!re.test(k)) fail.push(`ordinal «${k}» must match`);
  }
  for (const k of ['ضاحيه الحي الثاني عشر', 'ضاحيه الامير سلطان', 'ضاحيه هجر', 'ضاحيه الحي الرابع ج']) {
    if (re.test(k)) fail.push(`«${k}» must NOT match (unattested ordinal, another place, or no ordinal)`);
  }
}

if (fail.length) {
  console.error('❌ district city-suffix fallback:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`✅ district city-suffix fallback: ${must.length} strips + ${mustNot.length} refusals hold`);
