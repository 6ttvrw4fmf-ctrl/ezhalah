// The AF full-walk robots must know the search RPC stops paging at offset 25,000 (🦅 Falcon, 2026-10-23).
//
// af-live-truth-check run 39940963632 went red on two «MISSING» checks the day after the security cap
// (*_search_page_is_capped.sql, 2026-10-21) landed: total == oracle on both, and MISSING was exactly the rows past the
// cap (27,349 − 26,000 and 28,484 − 25,500). The robots walked the result set expecting every offset to answer.
// This pins: (1) the shared verdict's arithmetic on those two measured cases, (2) its constant == the migration's
// cap, (3) both robots route their MISSING verdict through it. Mutation-proven.
//   node --experimental-strip-types scripts/verify-af-walkers-respect-search-deep-page-cap.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SEARCH_RPC_MAX_OFFSET, reachableRows, missingVerdict } from './lib/searchDeepPageCap.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

type Verdict = (missing: number, walked: number, total: number, page: number) => boolean;
const real: Verdict = (m, w, t, p) => missingVerdict(m, w, t, p).ok;

// The two measured production cases plus the in-window ones.
function problems(v: Verdict): string[] {
  const f: string[] = [];
  if (!v(1349, 26000, 27349, 1000)) f.push('Villa/Buy 27,349 with the 1,349-row tail read as a defect');
  if (!v(2984, 25500, 28484, 1500)) f.push('Apartment/RentAnnual 28,484 with the 2,984-row tail read as a defect');
  if (v(1350, 26000, 27349, 1000)) f.push('one dropped listing inside the window passed');
  if (v(1349, 25999, 27349, 1000)) f.push('a walk that stopped short of the reachable rows passed');
  if (!v(0, 9000, 9000, 1000)) f.push('a fully reachable scope with 0 missing failed');
  if (v(1, 8999, 9000, 1000)) f.push('a fully reachable scope with 1 missing passed');
  return f;
}

const p = problems(real);
check('the cap-aware MISSING verdict is exact on the measured cases', p.length === 0, p.join('; '));
check('reachable rows: PAGE 1000 → 26,000 · PAGE 1500 → 25,500', reachableRows(1e6, 1000) === 26000 && reachableRows(1e6, 1500) === 25500,
  `${reachableRows(1e6, 1000)} / ${reachableRows(1e6, 1500)}`);
mustCatch('the old verdict «missing == 0»', problems((m) => m === 0).length > 0);
mustCatch('a verdict that waves through any missing count', problems(() => true).length > 0);
mustCatch('a verdict that forgets to check the walk length', problems((m, _w, t, pg) => m === Math.max(0, t - reachableRows(t, pg))).length > 0);

// The constant must be the migration's cap, so a future change to the cap moves the robots with it.
const dir = join(root, 'supabase', 'migrations');
const file = readdirSync(dir).filter((f) => /^\d{14}_search_page_is_capped\.sql$/.test(f)).sort().at(-1);
const capOf = (sql: string) => Number(/greatest\(p_offset, 0\) > (\d+) then 0/.exec(sql)?.[1] ?? NaN);
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
check('SEARCH_RPC_MAX_OFFSET equals the cap in *_search_page_is_capped.sql', capOf(sql) === SEARCH_RPC_MAX_OFFSET, `migration=${capOf(sql)} lib=${SEARCH_RPC_MAX_OFFSET}`);
mustCatch('the migration cap moving without the lib', capOf(sql.replace('> 25000 then 0', '> 30000 then 0')) !== SEARCH_RPC_MAX_OFFSET);

// Both robots must route their MISSING verdict through the shared helper.
const routes = (src: string) => /from '\.\/lib\/searchDeepPageCap\.ts'/.test(src) && /missingVerdict\(/.test(src);
for (const f of ['scripts/verify-af-live-truth.ts', 'scripts/verify-af-property-type-differential.ts']) {
  const src = readFileSync(join(root, f), 'utf8');
  check(`${f} judges MISSING through missingVerdict()`, routes(src), 'import or call missing');
  mustCatch(`${f} reverting to a bare missing == 0`, !routes(src.replace(/missingVerdict\(/g, 'Math.max(')));
}

if (failed) { console.error(`\n❌ verify-af-walkers-respect-search-deep-page-cap: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-af-walkers-respect-search-deep-page-cap: the AF walks read the offset cap as a cap, not as lost listings.');
