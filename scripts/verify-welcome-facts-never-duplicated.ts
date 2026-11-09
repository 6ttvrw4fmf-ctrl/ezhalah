// ONE FACT, ONCE PER PACK (owner 2026-11-01: «is the fact true … up to date and no duplicates»). welcome_insights_pick's pool
// is a UNION of three branches; the first carries a row_number() column and the other two a constant 0, so UNION could not
// collapse a fact picked by two branches and the pack carried it twice (measured 171 rows / 169 ids). The served definition
// is the LAST committed migration that creates the function; it must aggregate the insights from a pool that is distinct by
// id. Hermetic: reads the committed SQL only (the migration itself proves it against production at apply time).
import { readdirSync, readFileSync } from 'node:fs';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const DIR = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const defining = files.filter((f) => /create or replace function public\.welcome_insights_pick\s*\(/i.test(readFileSync(new URL(f, DIR), 'utf8')));
const latest = defining.at(-1) ?? '';
const sql = latest ? readFileSync(new URL(latest, DIR), 'utf8') : '';

/** The function body's `'insights'` aggregate reads a pool deduplicated by id. */
function distinctPack(src: string): boolean {
  const body = (src.match(/create or replace function public\.welcome_insights_pick[\s\S]*?\$function\$([\s\S]*?)\$function\$/i) ?? [])[1];
  if (!body) return false;
  const ins = body.slice(body.indexOf("'insights'"));
  if (!ins || body.indexOf("'insights'") < 0) return false;
  // the aggregate's FROM must be a distinct-by-id view of the pool, never the raw pool
  return /from\s*\(\s*select\s+distinct\s+on\s*\(\s*id\s*\)\s+\*\s+from\s+pool\s*\)\s*pool\s*\)\s*\)\s*;\s*$/i.test(ins.trim())
    && !/from\s+pool\s*\)\s*\)\s*;\s*$/i.test(ins.trim().replace(/from\s*\(\s*select\s+distinct\s+on\s*\(\s*id\s*\)\s+\*\s+from\s+pool\s*\)\s*pool/i, 'X'));
}

check(`the served welcome_insights_pick (${latest || 'none found'}) builds the pack from a pool distinct by id`, !!latest && distinctPack(sql));
// The proof runs in the migration that made the pack distinct; a later redefinition (20261109055302 added day_bound
// to the templates) must keep the distinct pool, checked above, and the fix migration must still carry its proof.
const firstDistinct = defining.find((f) => distinctPack(readFileSync(new URL(f, DIR), 'utf8'))) ?? '';
const fixSql = firstDistinct ? readFileSync(new URL(firstDistinct, DIR), 'utf8') : '';
check(`the migration that made the pack distinct (${firstDistinct || 'none'}) proves no duplicate id against production when applied`,
  /if n <> u then raise exception 'one fact once/.test(fixSql));
check('every definition from that fix on keeps the distinct pool',
  !!firstDistinct && defining.slice(defining.indexOf(firstDistinct)).every((f) => distinctPack(readFileSync(new URL(f, DIR), 'utf8'))));
const MUT = '(select distinct on (id) * from pool) pool';
mustCatch('back to the raw pool (171 rows, 169 facts)', !distinctPack(sql.replace(MUT, 'pool')));
mustCatch('distinct on a different column', !distinctPack(sql.replace(MUT, '(select distinct on (kind) * from pool) pool')));
const previous = firstDistinct ? defining[defining.indexOf(firstDistinct) - 1] : undefined;
mustCatch(`the definition before this fix (${previous}) fails`, !!previous && !distinctPack(readFileSync(new URL(previous, DIR), 'utf8')));

if (failed) { console.error(`\n❌ verify-welcome-facts-never-duplicated: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-welcome-facts-never-duplicated: each fact appears once in the pack.');
