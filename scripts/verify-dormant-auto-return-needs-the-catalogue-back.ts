// BARRIER — a dormant site returns to search by itself only when its crawl re-saw at least half of
// what we hold for it (⚡ Scraping Engineer, 2026-10-08, migration 20261008051547).
//
// THE INCIDENT IT PREVENTS. dwelleo moved every listing to a new URL shape on 2026-10-07; we hold
// 12,328 rows whose pages answer 404, hidden by status 'dormant'. Its 10-08 crawl saw the 2 listings
// the site now publishes. reactivate_recovered_dormant_platforms() used to flip a dormant site active
// on any ok crawl with >= 3 rows, so the first night dwelleo shows 3 listings ~12,000 dead cards
// would return to search within the hour. A small slice is a CHANGED site, not a recovered one.
//
// WHAT THIS CHECKS. The NEWEST committed definition (repo == production under the drift guard)
// compares the crawl's rows with the rows held in search_listings_ar inside the loop's filter.
// Mutation proof: the same predicate on that definition with the clause removed must fail.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const FN = /create\s+or\s+replace\s+function\s+public\.reactivate_recovered_dormant_platforms\s*\(/i;
const GUARD = /rows_upserted\s*,\s*0\s*\)\s*\*\s*2\s*>=\s*\(\s*select\s+count\(\*\)\s+from\s+search_listings_ar/i;

const newest = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => FN.test(readFileSync(join(DIR, f), 'utf8')))
  .pop();

const problems = (sql: string): string[] => {
  const m = sql.match(FN);
  if (!m) return ['no definition of reactivate_recovered_dormant_platforms found'];
  const rest = sql.slice(m.index!);
  const tag = rest.match(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
  if (!tag) return ['the definition has no dollar-quoted body'];
  const open = rest.indexOf(tag[0]);
  const close = rest.indexOf(tag[0], open + tag[0].length);
  if (close < 0) return [`the body opened with ${tag[0]} never closes`];
  const body = rest.slice(open + tag[0].length, close);
  const filter = body.slice(body.search(/for\s+r\s+in/i), body.search(/\bloop\b\s*\n\s*perform/i));
  return GUARD.test(filter)
    ? []
    : ['the loop flips a dormant site active without comparing its crawl to the rows held for it'];
};

if (!newest) {
  console.error('✗ no migration defines reactivate_recovered_dormant_platforms');
  process.exit(1);
}
const sql = readFileSync(join(DIR, newest), 'utf8');
const found = problems(sql);
// Mutation proof: the same predicate on this definition with the guard removed must FAIL.
const mustCatch = (what: string, brokenSql: string): boolean => {
  const caught = problems(brokenSql).length > 0;
  if (!caught) console.error(`✗ mutation proof: ${what} still passed — the check is vacuous`);
  return caught;
};
const proven = mustCatch('removing the re-saw-half guard',
  sql.replace(GUARD, '(select count(*) from search_listings_ar'));
if (found.length || !proven) {
  for (const p of found) console.error(`✗ ${newest}: ${p}`);
  process.exit(1);
}
console.log(`✓ ${newest}: a dormant site returns only when its crawl re-saw half its held rows (mutation caught)`);
