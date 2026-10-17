// «حي 1النرجس» must fold onto «نرجس» (🆕 2026-10-17, backlog #595), and a numbered plan code must keep its
// number (two plans never become one district).
//
// norm_district_tok stripped a leading number BEFORE it stripped «حي», so a number behind «حي» survived:
// dealapp's «حي 1النرجس» (تاروت ×5) folded to «1 النرجس» and never matched the catalog's «حي النرجس».
// The fix drops a leading number after the «حي» strip, and ONLY when an «ال» word follows: «حي 33ج» and
// «حي 34ج» stay two tokens. This pins both halves in the newest committed definition, and the migration's
// own check block EXECUTES the function on the same cases at apply time.
//
//   node --experimental-strip-types scripts/verify-district-tok-number-behind-hai.ts   (in `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase/migrations');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`  ${ok ? '✓' : '❌'} ${label}`); if (!ok) failed++; };

const newest = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create or replace function public\.norm_district_tok\(/i.test(readFileSync(join(dir, f), 'utf8')))
  .pop()!;
const sql = readFileSync(join(dir, newest), 'utf8');
const body = (s: string) => (s.match(/create or replace function public\.norm_district_tok[\s\S]*?\$function\$([\s\S]*?)\$function\$/i) ?? [])[1] ?? '';

const HAI = "'^(حي\\s+)+'";
const AFTER_HAI = "'^[0-9]+\\s+(?=ال)'";
const foldsBehindHai = (b: string) => b.includes(HAI) && b.includes(AFTER_HAI) && b.indexOf(AFTER_HAI) > b.indexOf(HAI);
const executesCases = (s: string) => s.includes("norm_district_tok('حي 1النرجس') <> 'نرجس'")
  && s.includes("norm_district_tok('حي 33ج') = public.norm_district_tok('حي 34ج')");

console.log(`\nnorm_district_tok folds a number behind «حي» only before an «ال» word (${newest})\n`);
check('the newest definition drops a leading number after the «حي» strip, only before «ال»', foldsBehindHai(body(sql)));
check('the migration check block executes «حي 1النرجس» → نرجس and keeps «حي 33ج» ≠ «حي 34ج»', executesCases(sql));

const mustCatch = (label: string, caught: boolean) =>
  check(`MUTATION ${label} — the check catches it`, caught);
// (a) the pre-fix order: no strip after «حي» → «حي 1النرجس» stays «1 النرجس».
mustCatch('the strip removed', !foldsBehindHai(body(sql.replace(`regexp_replace(\n`, '(\n').replace(`, ${AFTER_HAI}, '')`, ''))));
mustCatch('the strip without its «ال» guard (plan codes collapse)',
  !foldsBehindHai(body(sql.replace(AFTER_HAI, "'^[0-9]+\\s*'"))));
mustCatch('the strip placed before the «حي» strip', !foldsBehindHai(`x ${AFTER_HAI} y ${HAI}`));
mustCatch('a check block that stops executing the plan-code case',
  !executesCases(sql.replace("norm_district_tok('حي 33ج')", "norm_district_tok('x')")));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ district token: a number behind «حي» folds before «ال», plan codes keep their number');
