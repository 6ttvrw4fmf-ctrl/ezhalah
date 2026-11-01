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

import { readdirSync, readFileSync } from 'node:fs';
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
// A `# …` comment inside the tuple is stripped first: one ending in «)» (majlis's, 2026-10-26) used to close the
// tuple early and the reader read as 21 columns while it wrote 60 (caught 2026-11-01, the apartment chips).
const stripPyComments = (py: string) => py.replace(/#[^\n]*/g, '');
export function pyAfColumns(py: string): string[] {
  const m = /^AF_COLUMNS = \(([\s\S]*?)\)\n/m.exec(stripPyComments(py));
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// The filter's amenity columns: what the result card can prove (afEvidence) and what the oracle can filter.
const AF = [...new Set(Object.values(AMENITY_COL))];
const ORACLE = new Set(Object.values(AMENITY_TOKEN_COL));
// The allow-list, the view and the batched flip are read from the LATEST migration that defines each one (a later
// amenity — majlis, 2026-10-26 — redefines them; the version is minted at apply time, so no filename is pinned).
const latestFile = (needle: string): string => {
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => readFileSync(join(MIG, f), 'utf8').includes(needle));
  return files.length ? readFileSync(join(MIG, files[files.length - 1]), 'utf8') : '';
};
const COLS_SRC = latestFile('function public.text_facts_af_columns()') || STORE;
const VIEW_SRC = latestFile('create or replace view public.listing_text_facts_af as') || STORE;
const SLICE_SRC = latestFile('function public.text_facts_apply_slice(') || MERGE;
const SQL_COLS = sqlAfColumns(COLS_SRC);
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
  // a column behind its own switch reads `case when <switch>() then text_fact_bool(...) end as <col>` (majlis, 2026-10-26)
  return new Set(v ? [...v[1].matchAll(/text_fact_bool\(f\.facts, '([a-z_]+)'\)(?: end)?\s+as\s+([a-z_]+)/g)].filter((m) => m[1] === m[2]).map((m) => m[1]) : []);
}

console.log('\nRule B reaches every Advanced Filter amenity column, and only those\n');
check(`the DB allow-list (text_facts_af_columns) = the filter's ${AF.length} amenity columns (afEvidence AMENITY_COL)`,
  same(SQL_COLS, AF), `sql ${SQL_COLS.join(',')} vs af ${AF.join(',')}`);
check('the nightly reader writes exactly the same columns (words.py AF_COLUMNS)', same(PY_COLS, SQL_COLS),
  `py ${PY_COLS.join(',')}`);
check('the independent oracle can filter every one of them', SQL_COLS.every((c) => ORACLE.has(c)),
  SQL_COLS.filter((c) => !ORACLE.has(c)).join(','));
const view = viewColumns(VIEW_SRC);
check('the overlay view exposes every boolean column, each through text_fact_bool (no quote → no value)', SQL_COLS.every((c) => view.has(c)),
  SQL_COLS.filter((c) => !view.has(c)).join(','));
const { written, compared } = syncMerged(MERGE);
check('sync_search_listings_ar WRITES af_rule_b for its 8 columns', GROUP1.every((c) => written.has(c)),
  GROUP1.filter((c) => !written.has(c)).join(','));
check('sync_search_listings_ar COMPARES af_rule_b for the same 8 (no hourly flip, no missed change)',
  GROUP1.every((c) => compared.has(c)), GROUP1.filter((c) => !compared.has(c)).join(','));
check('sync_listing_rich_attrs merges every text_facts_af_columns() column it has, in the diff and the write',
  /a\.attname = any \(public\.text_facts_af_columns\(\)\)/.test(MERGE) && /\$f\$, merged_list, p_source_table, diff_list\);/.test(MERGE));
const slice = sliceMerged(SLICE_SRC);
check('the batched switch flip (text_facts_apply_slice) merges every boolean column', SQL_COLS.every((c) => slice.has(c)),
  SQL_COLS.filter((c) => !slice.has(c)).join(','));
check('both live bodies are md5-guarded in the same step as the edit', (MERGE.match(/moved since this migration was written/g) ?? []).length === 2);
check('the stale-text stamp runs first in every sync pass', MERGE.includes('perform public.text_facts_mark_stale();'));

// ── mutation proofs: the predicates above, fed a deliberately broken input ─────────────────────────────
mustCatch('a 21st AF amenity column not added to the overlay is caught', !same(SQL_COLS, [...AF, 'majlis_rooms']));
mustCatch('the reader dropping a column is caught', !same(PY_COLS.slice(1), SQL_COLS));
mustCatch('a tuple comment ending in «)» no longer truncates the reader\'s list (the 2026-11-01 false red)',
  pyAfColumns('AF_COLUMNS = ("a", "b",   # note (x)\n              "c")\n').join() === 'a,b,c');
mustCatch('a view column served without text_fact_bool is caught',
  !viewColumns(STORE.replace("public.text_fact_bool(f.facts, 'pool')                       as pool", "(f.facts->'pool'->>'v')::boolean as pool")).has('pool'));
const lost = syncMerged(MERGE.replace("'or s3.elevator is distinct from public.af_rule_b(v.elevator, tf.elevator)'", "'or s3.elevator is distinct from v.elevator'"));
mustCatch('a sync that writes the merge but compares the box is caught', !GROUP1.every((c) => lost.compared.has(c)));
const lostW = syncMerged(MERGE.replace('public.af_rule_b(v.kitchen, tf.kitchen),', 'v.kitchen,'));
mustCatch('a sync that compares the merge but writes the box is caught', !GROUP1.every((c) => lostW.written.has(c)));
mustCatch('a flip that forgets a column is caught',
  !SQL_COLS.every((c) => sliceMerged(MERGE.replace('public.af_rule_b(r.gym, tf.gym)', 'r.gym')).has(c)));

// ── RULE B FOR NUMBERS (owner 2026-10-25, handoff decision #1): street width fills a BLANK box ─────────────
// The numeric keys ride the same overlay. The migration that added them is found by what it DEFINES (its version
// is minted at apply time, so no filename is pinned); a later migration redefining the same objects wins.
const latestDefining = (needle: string): string => {
  const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => readFileSync(join(MIG, f), 'utf8').includes(needle));
  return files.length ? readFileSync(join(MIG, files[files.length - 1]), 'utf8') : '';
};
export function sqlAfNumColumns(sql: string): string[] {
  const m = /function public\.text_facts_af_num_columns\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
}
export function pyAfNumColumns(py: string): string[] {
  const m = /^AF_NUM_COLUMNS = \(([\s\S]*?)\)\n/m.exec(stripPyComments(py));
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}
/** Numeric columns the overlay view exposes, each only through text_fact_num (quote required) and behind the width switch. */
export function numViewColumns(sql: string): Set<string> {
  const v = /create or replace view public\.listing_text_facts_af as([\s\S]*?)from public\.listing_text_facts f/.exec(sql);
  return new Set(v ? [...v[1].matchAll(/text_facts_street_width_on\(\)\s*then public\.text_fact_num\(f\.facts, '([a-z_]+)'\)::smallint end as ([a-z_]+)/g)]
    .filter((m) => m[1] === m[2]).map((m) => m[1]) : []);
}
/** Numeric columns sync_search_listings_ar merges in the value written AND in the change detection. */
export function numSyncMerged(sql: string): { written: Set<string>; compared: Set<string> } {
  const written = new Set<string>(), compared = new Set<string>();
  for (const m of sql.matchAll(/or s3\.([a-z_]+) is distinct from public\.af_rule_b_num\(v\.\1, tf\.\1\)/g)) compared.add(m[1]);
  for (const m of sql.matchAll(/public\.af_rule_b_num\(v\.([a-z_]+), tf\.\1\), v\.floor_number,/g)) written.add(m[1]);
  return { written, compared };
}
/** The OTHER numeric writer (owner handoff 2026-10-31): apartments_count / shops_count live on listing_rich_attrs, so
 *  sync_listing_rich_attrs merges them — its merged_list gains an af_rule_b_num branch keyed on
 *  text_facts_af_num_columns(), and because the merged row feeds BOTH the diff and the write (the 2026-10-25 design),
 *  one branch covers the value and the change detection. True when the REPLACEMENT (not the needle) carries it. */
export function richNumMerged(sql: string): boolean {
  const i = sql.indexOf('repl :=');
  if (i < 0) return false;
  const repl = sql.slice(i, sql.indexOf('$x$;', i));
  return /when a\.attname = any \(public\.text_facts_af_num_columns\(\)\)\s*then format\('public\.af_rule_b_num\(r0\.%1\$I, tf\.%1\$I\) as %1\$I', a\.attname\)/.test(repl)
    && /execute replace\(src, needle, repl\);/.test(sql);
}
/** af_rule_b_num must be «fill a blank box only»: the box first, the text only where the box is NULL. */
export function numRuleFillsBlankOnly(sql: string): boolean {
  const m = /function public\.af_rule_b_num\(p_box smallint, p_text numeric\)[\s\S]*?select ([^\n]*)\n/.exec(sql);
  return !!m && /^coalesce\(p_box, round\(p_text\)::smallint\)\s*$/.test(m[1].trim());
}

// STREET is the migration that BORN the numeric rule (af_rule_b_num, the detector, the selftest, the backlog); NUM is
// the LATEST migration redefining the numeric allow-list, the view and the CHECK (20261101100930 added
// apartments_count / shops_count — and merges them through sync_listing_rich_attrs, not sync_search_listings_ar).
const STREET = latestDefining('function public.af_rule_b_num(');
const NUM = latestDefining('function public.text_facts_af_num_columns()');
const NUM_SQL = sqlAfNumColumns(NUM);
const RICH_NUM = NUM_SQL.filter((c) => c !== 'street_width_m');
const NUM_PY = pyAfNumColumns(WORDS);
console.log('\nRule B for numbers: street width fills a blank box, through the same overlay\n');
check('a migration defines the numeric allow-list (text_facts_af_num_columns) and it holds street_width_m', NUM_SQL.includes('street_width_m'));
check('the nightly reader writes exactly the same numeric keys (words.py AF_NUM_COLUMNS)', same(NUM_PY, NUM_SQL), `py ${NUM_PY.join(',')} vs sql ${NUM_SQL.join(',')}`);
check('the reader stores the number with its quote (value_num, quote) for exactly those keys',
  /f\["fact"\] in AF_NUM_COLUMNS and f\["value_num"\] is not None and \(f\["quote"\] or ""\)\.strip\(\)/.test(WORDS));
const numView = numViewColumns(NUM);
check('the overlay view exposes each numeric key through text_fact_num, behind the street-width switch', NUM_SQL.every((c) => numView.has(c)),
  NUM_SQL.filter((c) => !numView.has(c)).join(','));
check('the CHECK admits a numeric key only as a JSON number with its quote (text_facts_all_quoted redefined)',
  /text_facts_af_num_columns\(\)\)\s*and coalesce\(jsonb_typeof\(e\.value -> 'v'\), ''\) = 'number'/.test(NUM));
const numSync = numSyncMerged(STREET);
check('sync_search_listings_ar WRITES af_rule_b_num for street_width_m (its only numeric column)', numSync.written.has('street_width_m'));
check('sync_search_listings_ar COMPARES af_rule_b_num for street_width_m (no hourly flip, no missed change)', numSync.compared.has('street_width_m'));
check(`sync_listing_rich_attrs merges every other numeric key (${RICH_NUM.join(', ')}) with af_rule_b_num through merged_list — the diff and the write`,
  RICH_NUM.length === 0 || richNumMerged(latestDefining("format('public.af_rule_b_num(r0.%1$I, tf.%1$I) as %1$I', a.attname)")));
// (street_width_m is a native-location column merged by sync_search_listings_ar; the slice walks listing_rich_attrs.)
check('the batched switch flip (text_facts_apply_slice) merges every rich-attrs numeric key too',
  RICH_NUM.every((c) => new RegExp(`public\\.af_rule_b_num\\(r\\.${c}, tf\\.${c}\\) as ${c}`).test(SLICE_SRC)),
  RICH_NUM.filter((c) => !new RegExp(`public\\.af_rule_b_num\\(r\\.${c}, tf\\.${c}\\) as ${c}`).test(SLICE_SRC)).join(','));
check('af_rule_b_num fills a BLANK box only — a published number is never replaced', numRuleFillsBlankOnly(STREET));
check('the nightly reader re-reads, once, every ad read before the switch whose history holds a width (text_facts_todo backlog)',
  /not \(f\.facts \? ''street_width_m''\)[\s\S]*?f\.read_at < \(select kf\.changed_at from public\.ops_feature_flags kf where kf\.name = ''af_text_facts_street_width''\)[\s\S]*?l2\.fact = ''street_width_m'' and l2\.value_num is not null/.test(STREET));
check('the watcher views keep booleans and numbers apart (ops_text_facts_vs_index filters to the boolean keys)',
  /create or replace view public\.ops_text_facts_vs_index as[\s\S]*?where e\.key = any \(public\.text_facts_af_columns\(\)\);/.test(latestFile('create or replace view public.ops_text_facts_vs_index as'))
  && /create or replace view public\.ops_text_facts_num_vs_index as[\s\S]*?where e\.key = any \(public\.text_facts_af_num_columns\(\)\);/.test(latestFile('create or replace view public.ops_text_facts_num_vs_index as')));
check('the detector gains text_facts_width_not_applied and the selftest proves af_rule_b_num + the CHECK',
  /mon_raise\('P1', 'text_facts_width_not_applied'/.test(STREET) && /af_rule_b_num\(15::smallint, 20::numeric\) = 15/.test(STREET)
  && /text_facts_all_quoted\('\{"street_width_m": \{"v": "20"/.test(STREET) && /select public\.mon_selftest_text_facts\(\);/.test(STREET));
check('every live body the migration edits is md5-guarded in the same step (6 bodies: the CHECK, the sync, the todo, the detector, the selftest, the status)',
  (STREET.match(/'[0-9a-f]{32}'/g) ?? []).length >= 6);

mustCatch('a numeric key the reader drops is caught', !same(NUM_PY.slice(1), NUM_SQL));
mustCatch('a numeric key the SQL list gains without the reader is caught', !same(NUM_PY, [...NUM_SQL, 'property_age_years']));
mustCatch('the rich-attrs writer forgetting the numeric branch is caught',
  !richNumMerged(latestDefining("format('public.af_rule_b_num(r0.%1$I, tf.%1$I) as %1$I', a.attname)").replace("then format('public.af_rule_b_num(r0.%1$I, tf.%1$I) as %1$I', a.attname)", "then format('r0.%I', a.attname)")));
mustCatch('a view column served without text_fact_num / outside the switch is caught',
  !numViewColumns(STREET.replace("then public.text_fact_num(f.facts, 'street_width_m')::smallint end as street_width_m", "then (f.facts->'street_width_m'->>'v')::smallint end as street_width_m")).has('street_width_m'));
mustCatch('a sync that writes the merge but compares the box is caught',
  !numSyncMerged(STREET.replace('or s3.street_width_m is distinct from public.af_rule_b_num(v.street_width_m, tf.street_width_m)', 'or s3.street_width_m is distinct from v.street_width_m')).compared.has('street_width_m'));
mustCatch('a sync that compares the merge but writes the box is caught',
  !numSyncMerged(STREET.replace('    public.af_rule_b_num(v.street_width_m, tf.street_width_m), v.floor_number,', '    v.street_width_m, v.floor_number,')).written.has('street_width_m'));
mustCatch('the text REPLACING a published number (coalesce swapped) is caught',
  !numRuleFillsBlankOnly(STREET.replace('select coalesce(p_box, round(p_text)::smallint)', 'select coalesce(round(p_text)::smallint, p_box)')));

if (failures) {
  console.error(`\n✗ verify-text-facts-rule-b: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ every Advanced Filter amenity column is merged under Rule B, in both writers, in the value and the diff');
