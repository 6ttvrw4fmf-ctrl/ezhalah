// The Al-Ahsa cluster fallback in resolve_district_ar() must stay narrow: NULL-only, the three
// Al-Ahsa cities, unique across siblings, never a name carrying a number.
//
// HOW THIS WAS EARNED (🔧 Quality & Repair, 2026-10-08, backlog #206/#101). ~1,500 searchable
// abralosol ads had no district: the source named it («الرفاع», «الجابرية», «جوهرة الهادي») but the ad
// sat in الهفوف (office default) while the district is attested only under الاحساء / المبرز. Search
// already treats the three cities as one place, so migration 20261008132125 lets the resolver accept
// a name attested in EXACTLY ONE form across the other two cluster cities.
//
// The danger is the WRONG district, so this barrier (1) finds the NEWEST committed migration that
// defines resolve_district_ar — a later redefinition that drops the rule goes RED here — (2) lifts the
// rule's city set, digit guard and uniqueness clause from that SQL, (3) runs them against a model
// catalog in both directions, and (4) plants four mutants and requires each to be caught.
//
//   node --experimental-strip-types scripts/verify-district-al-ahsa-cluster-fallback.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase/migrations');
const definers = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create or replace function public\.resolve_district_ar\s*\(/i.test(readFileSync(join(dir, f), 'utf8')));
const newest = definers[definers.length - 1];
const sql = readFileSync(join(dir, newest), 'utf8');

type Cat = Array<{ city: number; norm: string; name: string }>;
const CATALOG: Cat = [
  { city: 3677, norm: 'رفاع', name: 'الرفاع' },
  { city: 2748, norm: 'جوهره الهادي', name: 'جوهرة الهادي' },
  { city: 2748, norm: 'صفا', name: 'الصفا' }, { city: 3677, norm: 'صفا', name: 'حي الصفا' }, // two forms → ambiguous
  { city: 3677, norm: 'غسانيه', name: 'الغسانية' },
  { city: 13, norm: 'رفاع', name: 'الرفاع' },          // outside the cluster: never borrowed
];

function problems(sql: string): string[] {
  const fail: string[] = [];
  const block = sql.match(/-- al-ahsa cluster[\s\S]*?-- end al-ahsa cluster/);
  if (!block) return [`${newest}: the Al-Ahsa cluster block is missing from the newest resolve_district_ar`];
  const b = block[0];
  if (!/if result is null and p_city_id in \(/.test(b)) fail.push('the rule no longer runs only when the city lookup failed');
  const set = b.match(/p_city_id in \(([^)]*)\)/)?.[1]?.split(',').map((s) => Number(s.trim())) ?? [];
  const sibSet = b.match(/d\.city_id in \(([^)]*)\)/)?.[1]?.split(',').map((s) => Number(s.trim())) ?? [];
  const digit = b.match(/v !~ '([^']+)'/)?.[1];
  const unique = /having count\(distinct d\.canonical_district_ar\) = 1/.test(b);
  const notOwn = /d\.city_id <> p_city_id/.test(b);
  if (JSON.stringify([...set].sort()) !== JSON.stringify([12, 2748, 3677])) fail.push(`cluster cities are ${JSON.stringify(set)}, want [12,2748,3677]`);

  // The rule as the SQL runs it, over the model catalog.
  const resolve = (city: number, v: string, k: string): string | null => {
    if (!set.includes(city)) return null;
    if (digit && new RegExp(digit, 'u').test(v)) return null;
    const hits = CATALOG.filter((r) => sibSet.includes(r.city) && (!notOwn || r.city !== city) && r.norm === k);
    const forms = [...new Set(hits.map((h) => h.name))];
    if (!forms.length) return null;
    if (unique && forms.length !== 1) return null;
    return forms.sort()[0];
  };
  const expect = (city: number, v: string, k: string, want: string | null, why: string) => {
    const got = resolve(city, v, k);
    if (got !== want) fail.push(`${city} «${v}»: got ${got ?? 'NULL'}, want ${want ?? 'NULL'} (${why})`);
  };
  expect(12, 'الرفاع', 'رفاع', 'الرفاع', 'attested once in الاحساء');
  expect(12, 'جوهرة الهادي', 'جوهره الهادي', 'جوهرة الهادي', 'attested once in المبرز');
  expect(12, 'الصفا', 'صفا', null, 'two forms across siblings is ambiguous');
  expect(12, 'الغسانية ٢', 'غسانيه', null, 'a number may be the district’s own name');
  expect(13, 'الرفاع', 'رفاع', null, 'not an Al-Ahsa city');
  expect(2748, 'الرفاع', 'رفاع', 'الرفاع', 'any cluster city borrows from its siblings');
  return fail;
}

const bad = problems(sql);
if (bad.length) { console.error(`✗ Al-Ahsa cluster fallback (${newest}):\n  ` + bad.join('\n  ')); process.exit(1); }

const mutants: Array<[string, (s: string) => string]> = [
  ['uniqueness dropped', (s) => s.replace(/\n\s*having count\(distinct d\.canonical_district_ar\) = 1;/, ';')],
  ['digit guard dropped', (s) => s.replace(/ and v !~ '\[0-9٠-٩\]' then\n      select min/, ' then\n      select min')],
  ['cluster widened', (s) => s.replace('p_city_id in (12, 2748, 3677)', 'p_city_id in (12, 13, 2748, 3677)').replace('d.city_id in (12, 2748, 3677)', 'd.city_id in (12, 13, 2748, 3677)')],
  ['block removed', (s) => s.replace(/-- al-ahsa cluster[\s\S]*?-- end al-ahsa cluster/, '')],
];
for (const [name, mut] of mutants) {
  const m = mut(sql);
  if (m === sql) { console.error(`✗ mutant «${name}» did not apply — the barrier's anchors drifted`); process.exit(1); }
  if (problems(m).length === 0) { console.error(`✗ mutant «${name}» was NOT caught`); process.exit(1); }
}
console.log(`✓ Al-Ahsa cluster fallback intact in ${newest} (6 cases, 4 mutants caught)`);
