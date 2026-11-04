// THE RESULTS RPC PACKS af_canon FOR THE PAGE, NEVER FOR EVERY MATCHED ROW.
//
// Measured 2026-11-04 (alert 11763, af-live-truth-check red): location_search_candidates_ar with one
// Advanced-Filter answer nationwide (buy + street width >= 20, 72,628 matches) took 22 s — past anon's 20 s
// statement_timeout, so a user got an error instead of results. A non-AF search over 159,328 matches took
// 1.5 s. The `matched` CTE built the ~180-key af_canon jsonb for every matched row and carried it through the
// count(*) over() / row_number() sorts; the LIMIT then threw all but one page away. Migration 20261104033508
// moved the SAME expression to the outer SELECT, packed from search_listings_ar by primary key for the
// returned rows only (22 s -> 0.8 s, output row-for-row identical on four probes).
//
// HOW IT COMES BACK. The function is rendered from af_rpc_templates by rebuild_af_filter_rpcs(), and every
// Advanced-Filter chip migration patches that template by needle. Until 2026-11-04 the needle was
// «… end as af_canon» — the tail of the per-row projection inside `matched`. A migration that re-injects that
// shape (a copied old needle, a re-render of an old template capture) puts the per-row packing back and
// nothing hermetic would notice until a user searched.
//
// THE RULE THIS CHECKS (hermetic, over the comment-stripped SQL of the committed migrations — a hand-created function counts too): no committed migration NEWER than
// the fix may write the per-row shape «end as af_canon» into SQL it executes. A migration that changes the
// af_canon keys must splice them into the outer-select subquery
// («… end from public.search_listings_ar s where s.source_table = u.source_table and s.listing_id =
// u.listing_id) as af_canon»). The fix migration itself must exist and carry both halves of the new shape.
//
//   node --experimental-strip-types scripts/verify-af-canon-packed-for-the-page.ts   (in `npm test`)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripSqlComments, migrationVersion } from './lib/repairClassifier.ts';

const ROOT = join(import.meta.dirname, '..');
const MIG = join(ROOT, 'supabase', 'migrations');
export const FIX_VERSION = '20261104033508';
export const PER_ROW_SHAPE = /\bend\s+as\s+af_canon\b/i;
const NEW_SHAPE_MATCHED = 'null::jsonb as af_canon';
const NEW_SHAPE_OUTER = 'listing_id = u.listing_id) as af_canon';

/** Versions (newer than the fix) whose EXECUTED SQL re-introduces the per-row af_canon projection. */
export function perRowReintroductions(files: { name: string; sql: string }[], fixVersion = FIX_VERSION): string[] {
  return files
    .filter((f) => migrationVersion(f.name) > fixVersion)
    .filter((f) => PER_ROW_SHAPE.test(stripSqlComments(f.sql)))
    .map((f) => f.name);
}

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nThe results RPC packs af_canon for the returned page only\n');

const names = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const fix = names.find((f) => migrationVersion(f) === FIX_VERSION);
check(`the fix migration ${FIX_VERSION} is committed`, !!fix);
if (fix) {
  const sql = stripSqlComments(readFileSync(join(MIG, fix), 'utf8'));
  check('the fix renders `matched` with null::jsonb as af_canon', sql.includes(NEW_SHAPE_MATCHED));
  check('the fix packs af_canon in the outer SELECT by primary key', sql.includes(NEW_SHAPE_OUTER));
  check('the fix goes through the template + rebuild_af_filter_rpcs(), never a hand edit',
    /update public\.af_rpc_templates/i.test(sql) && /rebuild_af_filter_rpcs\(\)/i.test(sql));
}

const files = names.map((name) => ({ name, sql: readFileSync(join(MIG, name), 'utf8') }));
const back = perRowReintroductions(files);
check('no later migration writes the per-row «end as af_canon» shape back into the template',
  back.length === 0,
  `${back.join(', ')} — splice af_canon keys into the outer-select subquery («… end from public.search_listings_ar s where s.source_table = u.source_table and s.listing_id = u.listing_id) as af_canon»), never back into \`matched\` (22 s nationwide AF searches, alert 11763).`);

// ── mutation proof: the rule must catch the shape that caused the outage, and only that ──
console.log('\n  mutation proof\n');
let blind = 0;
const mustCatch = (label: string, ok: boolean) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL  BLIND:'}  ${label}`);
  if (!ok) blind++;
};
const oldNeedle = `do $$ begin canon_new := $x$'sports_court', s.sports_court) end as af_canon$x$; end $$;`;
const newNeedle = `do $$ begin canon_new := $x$'sports_court', s.sports_court) end from public.search_listings_ar s where s.source_table = u.source_table and s.listing_id = u.listing_id) as af_canon$x$; end $$;`;
mustCatch('a later chip migration using the old per-row needle is caught',
  perRowReintroductions([{ name: '20261201000000_chip.sql', sql: oldNeedle }]).length === 1);
mustCatch('a later chip migration splicing into the outer subquery passes',
  perRowReintroductions([{ name: '20261201000000_chip.sql', sql: newNeedle }]).length === 0);
mustCatch('the per-row shape in a COMMENT is not executed SQL and passes',
  perRowReintroductions([{ name: '20261201000000_c.sql', sql: '-- it used to say: end as af_canon\nselect 1;' }]).length === 0);
mustCatch('history before the fix is not judged',
  perRowReintroductions([{ name: '20261102100954_old.sql', sql: oldNeedle }]).length === 0);
mustCatch('the shape is caught regardless of case and spacing',
  perRowReintroductions([{ name: '20261201000000_x.sql', sql: 'select case when true then 1 END   AS  af_canon;' }]).length === 1);

if (!existsSync(MIG)) failed++;
if (failed || blind) {
  console.error(`\n❌ ${failed} check(s) failed, ${blind} mutation(s) not caught`);
  process.exit(1);
}
console.log('\n✓ af_canon is packed for the returned page only');
