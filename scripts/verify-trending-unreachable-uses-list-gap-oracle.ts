// The trending «unreachable by district» check counts only REAL list gaps — from the same oracle as the P1.
//
// WHY (alert trending_district #2434, open 2026-09-11 → 2026-11-04). mon_trending_district_barrier() counted every served
// ad whose district token was absent from loc_canonical_district in its own city: 968 ads, never clearable, because 943
// of them were words the LIST refuses on purpose (placeholder / bogus shape / digits / rewritten recovery) and the rest
// sat under a clustered sibling city. public.served_district_not_offered() already tells those apart (list_rule). The fix
// (20261104061311) makes the trending check count `served_district_not_offered() where list_rule is null`, so the
// trending alarm and the P1 served_district_not_offered can never disagree.
//
// WHAT THIS PINS. The NEWEST migration that touches mon_trending_district_barrier must read the oracle with the
// list_rule filter, and must not bring back the own-city loc_canonical_district anti-join. Hermetic, with a mutation proof.
//
//   node --experimental-strip-types scripts/verify-trending-unreachable-uses-list-gap-oracle.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

function problems(sql: string): string[] {
  const fail: string[] = [];
  if (!/from public\.served_district_not_offered\(\) w\s+where w\.list_rule is null/.test(sql)) {
    fail.push('the unreachable count does not read served_district_not_offered() with list_rule is null');
  }
  if (/left join public\.loc_canonical_district c\s+on c\.city_id = l\.city_id and c\.district_norm = l\.tok/.test(sql)
      && !/a_start constant text/.test(sql)) {
    fail.push('the own-city anti-join (which counts the list\'s own refusals as gaps) is back');
  }
  return fail;
}

const newest = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes('mon_trending_district_barrier')).at(-1);
let bad = 0;
if (!newest) { console.log('FAIL  no migration defines mon_trending_district_barrier'); process.exit(1); }
const sql = readFileSync(join(dir, newest), 'utf8');
for (const p of problems(sql)) { console.log(`FAIL  ${newest}: ${p}`); bad++; }

// Mutation proofs: dropping the list_rule filter, or the oracle itself, must go red.
if (problems(sql.replace(/where w\.list_rule is null/g, '')).length === 0) { console.log('FAIL  mutation: no list_rule filter still passes'); bad++; }
if (problems(sql.replace(/public\.served_district_not_offered\(\)/g, 'public.search_listings_ar')).length === 0) {
  console.log('FAIL  mutation: counting search_listings_ar directly still passes'); bad++;
}

if (bad) process.exit(1);
console.log(`✓ trending unreachable-by-district (${newest}) counts only real list gaps, via served_district_not_offered()`);
