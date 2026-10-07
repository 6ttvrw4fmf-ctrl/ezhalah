// PERMANENT BARRIER — the source's own catalog city CORRECTS a stale served city, it does not only
// fill a missing one (New Listings Engineer, 2026-10-07).
//
// PR #6218 stopped muktamel filing an unmapped town under its region's capital and records the
// town's catalog id in additional_info.catalog_city_id; resolve_small_platform_cities() (pg_cron
// jobid 55, :12) turns that id into a location row. But it only picked up rows whose served city
// was NULL. Every row scraped before the fix still carried a location row saying the region capital,
// so it was never NULL and never corrected: muktamel 15741395 (source city «بحرة», catalog 3504) was
// still served under مكة المكرمة a day later, with 23 more like it.
//
// Asserted: the LATEST committed migration that (re)defines resolve_small_platform_cities() selects
// its gap with `s.city_id is distinct from` the catalog id, and no longer with `s.city_id is null`.
// Mutation-proven by the self-test below on the old predicate.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const FN = /create\s+or\s+replace\s+function\s+public\.resolve_small_platform_cities\s*\(/i;

export function gapProblems(sql: string): string[] {
  const p: string[] = [];
  const body = sql.replace(/--[^\n]*/g, '');
  if (!/s\.city_id\s+is\s+distinct\s+from\s+\(r\.additional_info->>'catalog_city_id'\)::int/i.test(body))
    p.push('gap does not compare the served city with the source catalog city');
  if (/s\.city_id\s+is\s+null/i.test(body))
    p.push('gap still only fills NULL cities: a stale region-capital city is never corrected');
  return p;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const latest = files.filter((f) => FN.test(readFileSync(join(DIR, f), 'utf8'))).pop();
const problems: string[] = [];
if (!latest) problems.push('no committed migration defines resolve_small_platform_cities()');
else problems.push(...gapProblems(readFileSync(join(DIR, latest), 'utf8')).map((x) => `${latest}: ${x}`));

// Self-test: the pre-2026-10-07 predicate must be caught, the fixed one must pass.
const OLD = `where s.source_table = %2$L\n and s.city_id is null\n and r.additional_info->>'catalog_city_id' is not null`;
const NEW = `where s.source_table = %2$L\n and s.city_id is distinct from (r.additional_info->>'catalog_city_id')::int`;
if (gapProblems(OLD).length === 0) problems.push('self-test: the old NULL-only gap was not caught');
if (gapProblems(NEW).length !== 0) problems.push('self-test: the fixed gap was rejected');

if (problems.length) {
  console.error('❌ verify-catalog-city-corrects-a-stale-city\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`✅ verify-catalog-city-corrects-a-stale-city: ${latest} corrects a stale city from the source catalog id`);
