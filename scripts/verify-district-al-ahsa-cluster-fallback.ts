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
// The sanctioned cluster (public.loc_city_cluster) as production holds it: الهفوف 12 + الاحساء 3677.
const CLUSTER: Record<number, string> = { 12: 'al_ahsa', 3677: 'al_ahsa' };
const CATALOG: Cat = [
  { city: 3677, norm: 'رفاع', name: 'الرفاع' },
  { city: 2748, norm: 'جوهره الهادي', name: 'جوهرة الهادي' },   // المبرز: NOT in the cluster
  { city: 3677, norm: 'صفا', name: 'الصفا' }, { city: 12, norm: 'صفا', name: 'حي الصفا' },
  { city: 3677, norm: 'غسانيه', name: 'الغسانية' },
  { city: 13, norm: 'رفاع', name: 'الرفاع' },
  { city: 3677, norm: 'رابيه', name: 'الرابية' }, { city: 3677, norm: 'رابيه', name: 'حي الرابية' }, // two forms
];

function problems(sql: string): string[] {
  const fail: string[] = [];
  const block = sql.match(/-- al-ahsa cluster[\s\S]*?-- end al-ahsa cluster/);
  if (!block) return [`${newest}: the Al-Ahsa cluster block is missing from the newest resolve_district_ar`];
  const b = block[0].split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  if (!/if result is null and/.test(b)) fail.push('the rule no longer runs only when the city lookup failed');
  // ONE source of truth for "which cities are one place": the table search reads. A hard-coded list
  // is how 20261008132125 wrongly borrowed المبرز districts for الهفوف ads.
  const readsTable = /public\.loc_city_cluster c1\s+join public\.loc_city_cluster m on m\.cluster_key = c1\.cluster_key\s+where c1\.city_id = p_city_id/.test(b);
  if (!readsTable) fail.push('the cluster is no longer read from public.loc_city_cluster');
  if (/city_id in \(\s*\d/.test(b)) fail.push('the cluster is hard-coded as a city list');
  const digit = b.match(/v !~ '([^']+)'/)?.[1];
  const unique = /having count\(distinct d\.canonical_district_ar\) = 1/.test(b);
  const notOwn = /d\.city_id <> p_city_id/.test(b);
  const hard = b.match(/city_id in \(([\d,\s]+)\)/)?.[1]?.split(',').map((x) => Number(x.trim()));

  const siblings = (city: number): number[] => hard ?? (readsTable && CLUSTER[city]
    ? Object.keys(CLUSTER).map(Number).filter((c) => CLUSTER[c] === CLUSTER[city]) : []);
  const resolve = (city: number, v: string, k: string): string | null => {
    if (digit && new RegExp(digit, 'u').test(v)) return null;
    const sib = siblings(city);
    if (hard && !hard.includes(city)) return null;
    const forms = [...new Set(CATALOG.filter((r) => sib.includes(r.city) && (!notOwn || r.city !== city) && r.norm === k).map((h) => h.name))];
    if (!forms.length || (unique && forms.length !== 1)) return null;
    return forms.sort()[0];
  };
  const expect = (city: number, v: string, k: string, want: string | null, why: string) => {
    const got = resolve(city, v, k);
    if (got !== want) fail.push(`${city} «${v}»: got ${got ?? 'NULL'}, want ${want ?? 'NULL'} (${why})`);
  };
  expect(12, 'الرفاع', 'رفاع', 'الرفاع', 'attested once in الاحساء, its cluster sibling');
  expect(12, 'جوهرة الهادي', 'جوهره الهادي', null, 'المبرز is a separate city, never borrowed from');
  expect(12, 'الغسانية ٢', 'غسانيه', null, 'a number may be the district’s own name');
  expect(13, 'الرفاع', 'رفاع', null, 'not in any cluster');
  expect(2748, 'الرفاع', 'رفاع', null, 'المبرز has no cluster');
  expect(3677, 'الصفا', 'صفا', 'حي الصفا', 'الاحساء borrows from الهفوف too');
  expect(12, 'الرابية', 'رابيه', null, 'two canonical forms in the sibling is ambiguous');
  return fail;
}

const bad = problems(sql);
if (bad.length) { console.error(`✗ Al-Ahsa cluster fallback (${newest}):\n  ` + bad.join('\n  ')); process.exit(1); }

const mutants: Array<[string, (s: string) => string]> = [
  ['uniqueness dropped', (s) => s.replace(/\n\s*having count\(distinct d\.canonical_district_ar\) = 1;/, ';')],
  ['digit guard dropped', (s) => s.replace("if result is null and v !~ '[0-9٠-٩]' then\n      select min", "if result is null then\n      select min")],
  ['hard-coded list (the 20261008132125 bug)', (s) => s.replace(/where d\.city_id in \(select m\.city_id from public\.loc_city_cluster c1\s+join public\.loc_city_cluster m on m\.cluster_key = c1\.cluster_key\s+where c1\.city_id = p_city_id\)/, 'where d.city_id in (12, 2748, 3677)')],
  ['block removed', (s) => s.replace(/-- al-ahsa cluster[\s\S]*?-- end al-ahsa cluster/, '')],
];
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ ${label} was NOT caught`); process.exit(1); }
};
for (const [name, mut] of mutants) {
  const m = mut(sql);
  if (m === sql) { console.error(`✗ mutant «${name}» did not apply — the barrier's anchors drifted`); process.exit(1); }
  mustCatch(`mutant «${name}»`, problems(m).length > 0);
}
console.log(`✓ Al-Ahsa cluster fallback intact in ${newest} (7 cases, 4 mutants caught; reads loc_city_cluster)`);
