// An English district name must be translated INSIDE ITS CITY before the country-wide bridge.
//
// 2026-10-06 (New Listings Engineer): 61 of 549 new wasalt listings had no district although the source
// published one («Al-Arid», «Al-Malqa», «Qurtubah», all Riyadh). The bridge was keyed by the English token
// alone, so «Al Malqa» → حي الملك فهد in MEDINA (18 ads) made Riyadh's «Al-Malqa» → حي الملقا (865 ads)
// "ambiguous" everywhere. The fix adds city-scoped keys '<en>@<city_id>' (unambiguous in that city,
// >= 2 ads per pair, generic labels never keyed) and the resolver reads them first.
//
// This barrier lifts the rules out of the committed migration and EXECUTES them on the measured pairs,
// in both directions, then proves each guard by mutation.
//
//   node --experimental-strip-types scripts/verify-en-district-bridge-is-city-scoped.ts   (in `npm test`)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('_wasalt_en_district_city_scoped_bridge.sql'));
if (files.length !== 1) {
  console.error(`❌ expected exactly one *_wasalt_en_district_city_scoped_bridge.sql migration, found ${files.length}`);
  process.exit(1);
}
const sql = readFileSync(join(dir, files[0]), 'utf8');

type Pair = { en: string; city: number | null; dk: string; n: number };

// The measured pairs (district_name_bridge, 2026-10-06), already normalised; city = the pinned city id.
const PAIRS: Pair[] = [
  { en: 'malqa', city: 3, dk: 'ملقا', n: 726 }, { en: 'malqa', city: 3, dk: 'ملقا', n: 121 },
  { en: 'malqa', city: 3, dk: 'نرجس', n: 1 }, // one stray ad: below the >= 2 floor
  { en: 'malqa', city: 14, dk: 'ملك فهد', n: 18 },
  { en: 'arid', city: 3, dk: 'عارض', n: 1136 }, { en: 'arid', city: 14, dk: 'عريض', n: 19 },
  { en: 'wadi', city: 9, dk: 'وادي', n: 21 }, { en: 'wadi', city: 9, dk: 'ودي', n: 6 }, // truly ambiguous in one city
  { en: 'the', city: 15, dk: 'منهل', n: 2 }, // «The District»: a generic label, never a key
  { en: 'solo', city: 3, dk: 'سولو', n: 1 }, // seen once: never a key
  { en: 'nocity', city: null, dk: 'لا', n: 50 }, // city did not pin: never a key
];

function problems(sql: string): string[] {
  const fail: string[] = [];
  const minN = sql.match(/where b\.n >= (\d+)/);
  const minLen = sql.match(/length\(z\.en_norm\) >= (\d+)/);
  const generic = sql.match(/z\.en_norm not in \(([^)]*)\)/);
  if (!minN) fail.push('could not find the >= N ads floor (where b.n >= N)');
  if (!minLen) fail.push('could not find the minimum token length');
  if (!generic) fail.push('could not find the generic-label exclusion list');
  if (!/having count\(distinct z\.dk\) = 1;/.test(sql)) fail.push('a city key is no longer required to name ONE Arabic district');
  if (!/having count\(distinct cc\.city_id\) = 1/.test(sql)) fail.push('the city pin no longer requires exactly one catalog city');
  if (!/z\.en_norm \|\| '@' \|\| z\.city_id/.test(sql)) fail.push('city rows are no longer keyed <en>@<city_id>');
  // The resolver: city key first, and the result must still be attested in THIS city.
  const ci = sql.indexOf("where en_norm = en || '@' || p_city_id and n_distinct = 1");
  const gi = sql.indexOf('where en_norm = en and n_distinct = 1');
  if (ci < 0) fail.push('the resolver no longer reads the city-scoped key');
  if (gi < 0) fail.push('the resolver no longer reads the country-wide key');
  if (ci >= 0 && gi >= 0 && ci > gi) fail.push('the city-scoped key is no longer read BEFORE the country-wide key');
  const cityBlock = ci >= 0 ? sql.slice(ci, sql.indexOf('-- end city-scoped translation', ci)) : '';
  if (!/from public\.loc_canonical_district\s+where city_id = p_city_id and district_norm = k;/.test(cityBlock)) {
    fail.push('a city-scoped translation is no longer checked against the city catalog (could invent a district)');
  }
  if (fail.length) return fail;

  const N = Number(minN![1]);
  const L = Number(minLen![1]);
  const gen = new Set([...generic![1].matchAll(/'([^']*)'/g)].map((m) => m[1]));
  // The refresh, as the migration runs it.
  const groups = new Map<string, Set<string>>();
  for (const p of PAIRS) {
    if (p.city === null || p.n < N || p.en.length < L || gen.has(p.en) || p.en.includes('@')) continue;
    const k = `${p.en}@${p.city}`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(p.dk);
  }
  const keys = new Map<string, string>();
  for (const [k, s] of groups) if (s.size === 1) keys.set(k, [...s][0]);

  const want: Array<[string, string | undefined, string]> = [
    ['malqa@3', 'ملقا', 'Riyadh «Al-Malqa» must resolve despite Medina and one stray ad'],
    ['arid@3', 'عارض', 'Riyadh «Al-Arid» must resolve despite Medina'],
    ['malqa@14', 'ملك فهد', 'each city keeps its own source translation'],
    ['wadi@9', undefined, 'two districts in ONE city stay ambiguous'],
    ['the@15', undefined, 'a generic label is never a key'],
    ['solo@3', undefined, 'a pair seen once is never a key'],
  ];
  for (const [k, v, why] of want) {
    if (keys.get(k) !== v) fail.push(`${k}: expected ${v ?? 'no key'}, got ${keys.get(k) ?? 'no key'} (${why})`);
  }
  if ([...keys.keys()].some((k) => k.startsWith('nocity'))) fail.push('a pair whose city did not pin produced a key');
  return fail;
}

const fail = problems(sql);
function mustCatch(label: string, mut: string): void {
  if (mut === sql) { fail.push(`mutation «${label}» did not change the SQL (stale needle)`); return; }
  if (problems(mut).length === 0) fail.push(`mutation NOT caught: ${label}`);
}
mustCatch('>= 2 ads floor lowered to 1', sql.replace('where b.n >= 2', 'where b.n >= 1'));
mustCatch('ambiguity check removed', sql.replace('having count(distinct z.dk) = 1;', 'having true;'));
mustCatch('generic label «the» admitted', sql.replace("not in ('the', ", "not in ("));
mustCatch('city lookup moved after the global key', sql.replace("where en_norm = en || '@' || p_city_id and n_distinct = 1", 'where false'));
mustCatch('city translation skips the catalog check', sql.replace(
  /(-- city-scoped translation first[\s\S]*?)from public\.loc_canonical_district\s+where city_id = p_city_id and district_norm = k;/,
  '$1from (select k as canonical_district_ar) x;'));

if (fail.length) {
  console.error('❌ English district bridge city scope:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('✅ English district bridge city scope: 6 decisions + no-city refusal hold; 5 mutations caught');
