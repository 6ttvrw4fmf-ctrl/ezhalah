// SECURITY (owner-approved plan, Phase 1.4, 2026-10-20): one search call cannot return the whole inventory.
//
// THE HOLE. location_search_candidates_ar only clamped NEGATIVE p_limit/p_offset, so the publishable key could pull
// tens of thousands of listing ids per call (measured: p_limit 20,000 → 20,000 rows) and page through all of them.
// Migration *_search_page_is_capped.sql edits the TEMPLATE (af_rpc_templates — the AF RPCs are generated, never
// hand-edited) and re-renders with rebuild_af_filter_rpcs(): at most 5,000 rows per call (our own largest caller,
// scrapers/common/af_score.py RPC_LIMIT), nothing beyond offset 25,000 (the app's DRAIN_ROW_BUDGET). Measured as the
// anon role after apply: 20,000 → 5,000; 1,500 → 1,500; offset 30,000 → 0; total_count unchanged; a real Riyadh
// Filter search shows 90,791 results and «عرض المزيد» pages on.
//   node --experimental-strip-types scripts/verify-search-page-is-capped.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_search_page_is_capped\.sql$/.test(f)).sort().at(-1);
if (!file) { console.log('FAIL  migration *_search_page_is_capped.sql is missing'); process.exit(1); }
const sql = readFileSync(join(dir, file), 'utf8');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const MAX_LIMIT = 5000;
const MAX_OFFSET = 25000;

function problems(s: string, scoreLimit: number, drainBudget: number, appPage: number): string[] {
  const fail: string[] = [];
  const m = /new_lim constant text := 'limit \(case when greatest\(p_offset, 0\) > (\d+) then 0 else least\(greatest\(p_limit, 0\), (\d+)\) end\) offset greatest\(p_offset, 0\)';/.exec(s);
  if (!m) { fail.push('the capped LIMIT clause is missing or reshaped'); return fail; }
  const [off, lim] = [Number(m[1]), Number(m[2])];
  if (lim > MAX_LIMIT) fail.push(`page cap ${lim} is above ${MAX_LIMIT}`);
  if (off > MAX_OFFSET) fail.push(`offset cap ${off} is above ${MAX_OFFSET}`);
  // Never cap below what our own callers need — that would silently break them.
  if (lim < scoreLimit) fail.push(`page cap ${lim} is below af_score RPC_LIMIT ${scoreLimit} (the AF score robot would break)`);
  if (lim < appPage) fail.push(`page cap ${lim} is below the app's QUERY_LIMIT ${appPage}`);
  if (off < drainBudget) fail.push(`offset cap ${off} is below the app's DRAIN_ROW_BUDGET ${drainBudget} («عرض المزيد» would stop early)`);
  if (!/update public\.af_rpc_templates set template = replace\(tpl, old_lim, new_lim\)/.test(s)) fail.push('the template is not the thing being edited');
  if (!/perform public\.rebuild_af_filter_rpcs\(\);/.test(s)) fail.push('the function is not re-rendered through rebuild_af_filter_rpcs()');
  if (/create\s+or\s+replace\s+function/i.test(s)) fail.push('hand-edits an AF RPC (forbidden — go through the template)');
  if (!/if occ <> 2 then raise exception/.test(s)) fail.push('no fail-closed needle count');
  return fail;
}

const scoreLimit = Number(/RPC_LIMIT = (\d+)/.exec(read('scrapers/common/af_score.py'))?.[1] ?? NaN);
const drain = Number((/DRAIN_ROW_BUDGET = ([\d_]+)/.exec(read('src/data/resultCount.ts'))?.[1] ?? 'NaN').replace(/_/g, ''));
const appPage = Number(/const QUERY_LIMIT = (\d+)/.exec(read('src/data/remote.ts'))?.[1] ?? NaN);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

check('the callers\' own page sizes were read', Number.isFinite(scoreLimit) && Number.isFinite(drain) && Number.isFinite(appPage), `${scoreLimit}/${drain}/${appPage}`);
const p = problems(sql, scoreLimit, drain, appPage);
check(`one search returns at most ${MAX_LIMIT} rows and nothing past offset ${MAX_OFFSET}, via the template`, p.length === 0, p.join('; '));
mustCatch('the cap raised back to "unlimited" (50,000)', problems(sql.replace('least(greatest(p_limit, 0), 5000)', 'least(greatest(p_limit, 0), 50000)'), scoreLimit, drain, appPage).length > 0);
mustCatch('a cap so low it breaks the AF score robot', problems(sql.replace('least(greatest(p_limit, 0), 5000)', 'least(greatest(p_limit, 0), 1000)'), scoreLimit, drain, appPage).length > 0);
mustCatch('an offset cap that stops «عرض المزيد» early', problems(sql.replace('> 25000 then 0', '> 10000 then 0'), scoreLimit, drain, appPage).length > 0);
mustCatch('a hand-edit of the RPC instead of the template', problems(sql + '\ncreate or replace function public.location_search_candidates_ar() returns void language sql as $$ $$;', scoreLimit, drain, appPage).length > 0);

if (failed) { console.error(`\n❌ verify-search-page-is-capped: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-search-page-is-capped: one search cannot return the whole inventory.');
