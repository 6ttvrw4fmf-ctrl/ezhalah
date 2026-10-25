// RULE B MUST REACH EVERY ADVANCED FILTER AMENITY COLUMN, AND ONLY THOSE (owner 2026-10-25, «We trust the
// sellers sentence»; docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md «The seller's sentence — Rule B»).
//
// The ad's quoted facts reach the filter through ONE overlay merged by TWO index writers. A column can go dark
// in four quiet ways, none of which any SQL test or CI run would notice:
//   1. the AF gains a 21st amenity column and nobody adds it to the overlay → that chip stays box-only;
//   2. the nightly reader (words.py AF_COLUMNS) and the DB's allow-list (text_facts_af_columns) drift → the
//      DB CHECK refuses the job's rows, or a column is never written;
//   3. a writer merges a column in the value it WRITES but not in the change detection (or the reverse) →
//      the column flips every hour, or never;
//   4. the overlay view stops exposing a column → every merge for it reads NULL = the box.
// This reads the three committed migrations and the two code lists, offline, and fails on any of them.
//
//   node --experimental-strip-types scripts/verify-text-facts-rule-b.ts      (auto-discovered by `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AMENITY_COL } from '../src/lib/afEvidence.ts';
import { AMENITY_TOKEN_COL } from './lib/afOracleFilter.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
const STORE = readFileSync(join(MIG, '20261025203351_text_facts_overlay_store_born_off.sql'), 'utf8');
const MERGE = readFileSync(join(MIG, '20261025205008_text_facts_rule_b_merged_by_both_index_writers.sql'), 'utf8');
const WORDS = readFileSync(join(ROOT, 'scrapers', 'facts', 'words.py'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

// ── the lists ─────────────────────────────────────────────────────────────────────────────────────────
export function sqlAfColumns(sql: string): string[] {
  const m = /function public\.text_facts_af_columns\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
}
export function pyAfColumns(py: string): string[] {
  const m = /^AF_COLUMNS = \(([\s\S]*?)\)\n/m.exec(py);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// The filter's amenity columns: what the result card can prove (afEvidence) and what the oracle can filter.
const AF = [...new Set(Object.values(AMENITY_COL))];
const ORACLE = new Set(Object.values(AMENITY_TOKEN_COL));
const SQL_COLS = sqlAfColumns(STORE);
const PY_COLS = pyAfColumns(WORDS);

// ── coverage ──────────────────────────────────────────────────────────────────────────────────────────
// Group 1 = what sync_search_listings_ar writes from listing_native_location_v2; the other 12 come from
// listing_rich_attrs through sync_listing_rich_attrs, which merges every text_facts_af_columns() column it has.
const GROUP1 = ['furnished', 'elevator', 'parking', 'kitchen', 'air_conditioner', 'maid_room', 'driver_room', 'private_entrance'];

/** Columns the sync merges in the value written AND in the change detection (needle replacements only). */
export function syncMerged(sql: string): { written: Set<string>; compared: Set<string> } {
  const written = new Set<string>(), compared = new Set<string>();
  for (const m of sql.matchAll(/'or s3\.([a-z_]+) is distinct from public\.af_rule_b\(v\.\1, tf\.\1\)'/g)) compared.add(m[1]);
  // the two select-list replacements are the needle pairs whose replacement carries v.production_ready / v.property_age
  for (const m of sql.matchAll(/'((?:[^']|'')*public\.af_rule_b\(v\.(?:[^']|'')*)'/g)) {
    if (/or s3\./.test(m[1])) continue;
    for (const c of m[1].matchAll(/public\.af_rule_b\(v\.([a-z_]+), tf\.\1\)/g)) written.add(c[1]);
  }
  return { written, compared };
}
/** Columns text_facts_apply_slice merges (it must cover all 20, from the same two boxes). */
export function sliceMerged(sql: string): Set<string> {
  const body = sql.slice(sql.indexOf('function public.text_facts_apply_slice'));
  return new Set([...body.matchAll(/public\.af_rule_b\((?:e|r)\.([a-z_]+), tf\.\1\)/g)].map((m) => m[1]));
}
/** Columns the overlay view exposes, each only through text_fact_bool (quote required). */
export function viewColumns(sql: string): Set<string> {
  const v = /create or replace view public\.listing_text_facts_af as([\s\S]*?)from public\.listing_text_facts f/.exec(sql);
  return new Set(v ? [...v[1].matchAll(/text_fact_bool\(f\.facts, '([a-z_]+)'\)\s+as\s+([a-z_]+)/g)].filter((m) => m[1] === m[2]).map((m) => m[1]) : []);
}

console.log('\nRule B reaches every Advanced Filter amenity column, and only those\n');
check('the DB allow-list (text_facts_af_columns) = the filter\'s 20 amenity columns (afEvidence AMENITY_COL)',
  same(SQL_COLS, AF), `sql ${SQL_COLS.join(',')} vs af ${AF.join(',')}`);
check('the nightly reader writes exactly the same columns (words.py AF_COLUMNS)', same(PY_COLS, SQL_COLS),
  `py ${PY_COLS.join(',')}`);
check('the independent oracle can filter every one of them', SQL_COLS.every((c) => ORACLE.has(c)),
  SQL_COLS.filter((c) => !ORACLE.has(c)).join(','));
const view = viewColumns(STORE);
check('the overlay view exposes all 20, each through text_fact_bool (no quote → no value)', SQL_COLS.every((c) => view.has(c)),
  SQL_COLS.filter((c) => !view.has(c)).join(','));
const { written, compared } = syncMerged(MERGE);
check('sync_search_listings_ar WRITES af_rule_b for its 8 columns', GROUP1.every((c) => written.has(c)),
  GROUP1.filter((c) => !written.has(c)).join(','));
check('sync_search_listings_ar COMPARES af_rule_b for the same 8 (no hourly flip, no missed change)',
  GROUP1.every((c) => compared.has(c)), GROUP1.filter((c) => !compared.has(c)).join(','));
check('sync_listing_rich_attrs merges every text_facts_af_columns() column it has, in the diff and the write',
  /a\.attname = any \(public\.text_facts_af_columns\(\)\)/.test(MERGE) && /\$f\$, merged_list, p_source_table, diff_list\);/.test(MERGE));
const slice = sliceMerged(MERGE);
check('the batched switch flip (text_facts_apply_slice) merges all 20', SQL_COLS.every((c) => slice.has(c)),
  SQL_COLS.filter((c) => !slice.has(c)).join(','));
check('both live bodies are md5-guarded in the same step as the edit', (MERGE.match(/moved since this migration was written/g) ?? []).length === 2);
check('the stale-text stamp runs first in every sync pass', MERGE.includes('perform public.text_facts_mark_stale();'));

// ── mutation proofs: the predicates above, fed a deliberately broken input ─────────────────────────────
mustCatch('a 21st AF amenity column not added to the overlay is caught', !same(SQL_COLS, [...AF, 'majlis_rooms']));
mustCatch('the reader dropping a column is caught', !same(PY_COLS.slice(1), SQL_COLS));
mustCatch('a view column served without text_fact_bool is caught',
  !viewColumns(STORE.replace("public.text_fact_bool(f.facts, 'pool')                       as pool", "(f.facts->'pool'->>'v')::boolean as pool")).has('pool'));
const lost = syncMerged(MERGE.replace("'or s3.elevator is distinct from public.af_rule_b(v.elevator, tf.elevator)'", "'or s3.elevator is distinct from v.elevator'"));
mustCatch('a sync that writes the merge but compares the box is caught', !GROUP1.every((c) => lost.compared.has(c)));
const lostW = syncMerged(MERGE.replace('public.af_rule_b(v.kitchen, tf.kitchen),', 'v.kitchen,'));
mustCatch('a sync that compares the merge but writes the box is caught', !GROUP1.every((c) => lostW.written.has(c)));
mustCatch('a flip that forgets a column is caught',
  !SQL_COLS.every((c) => sliceMerged(MERGE.replace('public.af_rule_b(r.gym, tf.gym)', 'r.gym')).has(c)));

if (failures) {
  console.error(`\n✗ verify-text-facts-rule-b: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ every Advanced Filter amenity column is merged under Rule B, in both writers, in the value and the diff');
