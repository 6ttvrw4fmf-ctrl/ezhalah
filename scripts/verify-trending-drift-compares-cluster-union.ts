// Barrier: the Trending drift detector compares a CITY CLUSTER's union, the number the chip shows.
//
// WHY (AF engineer 2026-10-13, backlog 462, alert 8545). The app presents a loc_city_cluster ONCE in
// Trending with the union of its members' counts (applyClusterUnion + collapseClustersForTrending in
// src/data/locations.ts), and a search for any member's name returns that same union. Measured
// 2026-10-13, commercial land / monthly rent: top_cities_by_deal_ar gave الاحساء 5 and الهفوف 1, the
// Trending chip said 6, the tap returned 6. mon_detect_trending_cohort_drift() compared the search (6)
// with ONE member's raw row (5) and held a P1 open for six days over a correct product, and that open
// dedup key would have swallowed any real city drift raised in the meantime.
//
// What is checked:
//   1. EXECUTED: the app's own applyClusterUnion + collapseClustersForTrending, lifted from
//      src/data/locations.ts, turn the measured rows into ONE chip carrying the union (6). This is the
//      promise the detector must compare against.
//   2. The LATEST committed migration defining mon_detect_trending_cohort_drift() compares the
//      search count in its city_drift branch with a value summed over loc_city_cluster siblings, not
//      with the top row's own listing_count.
//
//   node --experimental-strip-types scripts/verify-trending-drift-compares-cluster-union.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

console.log('\nTrending drift detector compares the cluster union\n');

// ── 1. the app's promise, executed ───────────────────────────────────────────────────────────────
const lifted = await liftSymbols(join(ROOT, 'src/data/locations.ts'), [
  { header: 'export function applyClusterUnion(' },
  { header: 'export function collapseClustersForTrending(' },
], ['applyClusterUnion', 'collapseClustersForTrending'], 'type CityOption = any;');
const applyClusterUnion = lifted.applyClusterUnion as (o: any[], m: Map<number, string>) => any[];
const collapse = lifted.collapseClustersForTrending as (o: any[]) => any[];

// 2026-10-13 measured rows (top_cities_by_deal_ar, إيجار / شهري / Commercial / أرض تجارية)
const rows = [
  { cityId: 3677, nameAr: 'الاحساء', listingCount: 5 },
  { cityId: 80, nameAr: 'عنيزة', listingCount: 2 },
  { cityId: 12, nameAr: 'الهفوف', listingCount: 1 },
];
const clusters = new Map<number, string>([[3677, 'al_ahsa'], [12, 'al_ahsa']]);
const chips = collapse(applyClusterUnion(rows, clusters));
const ahsaChips = chips.filter((c) => c.clusterKey === 'al_ahsa');
check('the app shows the al_ahsa cluster as exactly ONE Trending chip', ahsaChips.length === 1);
check('that chip promises the union 5 + 1 = 6 (what the tap returns)', ahsaChips[0]?.listingCount === 6);
check('an unclustered city keeps its own count', chips.find((c) => c.cityId === 80)?.listingCount === 2);

// ── 2. the detector's comparison, in the latest committed definition ─────────────────────────────
const MIG = join(ROOT, 'supabase/migrations');
const DEF = /create\s+or\s+replace\s+function\s+public\.mon_detect_trending_cohort_drift\s*\(/i;
const latest = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => DEF.test(readFileSync(join(MIG, f), 'utf8'))).pop();
check('a committed migration defines mon_detect_trending_cohort_drift()', !!latest);

// The city_drift branch: from the #18 comment's location_search_candidates_ar call to its bad := line.
export function cityDriftProblems(sql: string): string[] {
  const body = sql.slice(sql.search(DEF));
  const at = body.indexOf("'city_drift'");
  if (at < 0) return ['no city_drift branch'];
  const start = body.lastIndexOf('-- #18', at);
  if (start < 0) return ['no #18 equality block before city_drift'];
  const block = body.slice(start, at);
  const out: string[] = [];
  const cmp = block.match(/if\s+coalesce\(s_cnt,\s*0\)\s*<>\s*([a-z_.]+)\s+then/i);
  if (!cmp) return ['city_drift comparison not found'];
  const rhs = cmp[1];
  if (rhs === 'r.listing_count') out.push('city_drift compares one member row (r.listing_count), not the cluster union');
  else {
    const assign = new RegExp(`into\\s+${rhs.replace('.', '\\.')}\\b[\\s\\S]*?loc_city_cluster`, 'i');
    if (!assign.test(block)) out.push(`${rhs} is not summed over loc_city_cluster siblings before the comparison`);
  }
  return out;
}
const sql = latest ? readFileSync(join(MIG, latest), 'utf8') : '';
const probs = cityDriftProblems(sql);
check(`${latest}: city_drift compares the cluster union${probs.length ? ' -- ' + probs.join('; ') : ''}`, probs.length === 0);

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const OLD = readFileSync(join(MIG, '20260818231309_trending_rpcs_rent_period_token_owner_2026_08_19.sql'), 'utf8');
mustCatch('the 2026-08-18 detector (compares r.listing_count)', cityDriftProblems(OLD).length > 0);
mustCatch('comparing the raw row again',
  cityDriftProblems(sql.replace(/coalesce\(s_cnt, 0\) <> exp_cnt/, 'coalesce(s_cnt, 0) <> r.listing_count')).length > 0);
mustCatch('exp_cnt no longer summed over the cluster',
  cityDriftProblems(sql.replace(/join loc_city_cluster c2[^\n]*\n/, '\n').replace(/from loc_city_cluster c1/, 'from loc_catalog_city c1')
    .replace(/exists \(select 1 from loc_city_cluster c/, 'exists (select 1 from loc_catalog_city c')).length > 0);
mustCatch('the app chip losing the union',
  collapse(rows.map((r) => ({ ...r }))).filter((c) => c.cityId === 3677 || c.cityId === 12).length !== 1);

if (failed) { console.error(`\n✗ verify-trending-drift-compares-cluster-union: ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ the Trending drift detector compares the number the chip shows');
