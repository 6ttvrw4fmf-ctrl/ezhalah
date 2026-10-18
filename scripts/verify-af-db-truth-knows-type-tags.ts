// Barrier: the AF chip's independent DB truth knows every TYPE TOKEN the search matches through a tag
// (🔬 2026-10-17, backlog 627).
//
// «أرض خام» (raw land) is not a type_ar. Raw lands carry unit_subtype_ar = 'أرض خام', and the p_types token
// 'أرض خام' matches that tag inside af_eligibility_clause (migration 20261009235607). The independent oracle
// of mon af_chip_vs_db_truth, ops_af_cohort_predicate_sql(), was never told: it kept reading
// s.type_ar = 'أرض خام', so every Raw Land Buy cell read db_truth 0 against correct chips (P1 alert 9687,
// 14 of 490 cells, e.g. street width 20+ chip 92, real 92). A red P1 on a correct production hides the day
// a chip really is wrong. This reads the COMMITTED SQL: every token the clause matches by tag must appear in
// the newest committed oracle as the same tag rule.
//
//   node --experimental-strip-types scripts/verify-af-db-truth-knows-type-tags.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG = join(import.meta.dirname, '..', 'supabase', 'migrations');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIG, f), 'utf8');

/** Type tokens the search matches through a unit_subtype_ar tag: `unit_subtype_ar = 'X' and 'X' = any(p_types…`. */
export function tagTokens(sql: string): Set<string> {
  return new Set([...sql.matchAll(/unit_subtype_ar\s*=\s*'([^']+)'\s+and\s+'\1'\s*=\s*any\s*\(/g)].map((m) => m[1]));
}
/** The tokens an oracle predicate knows as a tag: it compares unit_subtype_ar with that literal. */
export function oracleKnows(sql: string, tok: string): boolean {
  return new RegExp(`unit_subtype_ar\\s*=\\s*'${tok}'`).test(sql);
}

const tokens = new Set<string>();
for (const f of files) for (const t of tagTokens(read(f))) tokens.add(t);
const oracleFile = files.filter((f) => /function\s+(public\.)?ops_af_cohort_predicate_sql\s*\(/i.test(read(f))).at(-1);
check('the clause matches at least one type token through a tag (the scan is not empty)', tokens.size > 0, [...tokens].join(', '));
check('a committed oracle definition exists', !!oracleFile, oracleFile ?? 'none');
const oracle = oracleFile ? read(oracleFile).slice(read(oracleFile).search(/function\s+(public\.)?ops_af_cohort_predicate_sql\s*\(/i)) : '';
for (const t of tokens) check(`the DB-truth oracle (${oracleFile}) matches the «${t}» tag the search matches`, oracleKnows(oracle, t));

mustCatch('the 2026-09-02 oracle that read only type_ar', !oracleKnows(read('20260902163957_af_chip_count_must_equal_independent_db_truth.sql'), 'أرض خام'));
mustCatch('a new tag token nobody taught the oracle', !oracleKnows(oracle, 'أرض جديدة'));
mustCatch('a clause line without the any(p_types) half is not a token', tagTokens("s.unit_subtype_ar = 'استديو'").size === 0);

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ the chip oracle knows every tag the search matches');
process.exit(failures ? 1 : 0);
