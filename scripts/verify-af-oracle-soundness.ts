// THE INDEPENDENT ORACLE MUST BE SOUND, NOT MERELY PRESENT.
//
// `verify-af-live-truth.ts` certifies daily that Advanced Filter returns exactly the right listings,
// by diffing (source_table, listing_id) sets against PostgREST directly. That certification is only
// worth what the oracle is worth, and two live findings on 2026-08-28 showed it was worth less than
// it claimed. Both were found by widening live cohort coverage — neither was visible from a green
// suite, because both fail in the direction of a FALSE ALARM or a SILENT AGREEMENT, never a crash.
//
// ── 1. UNSTABLE PAGING ────────────────────────────────────────────────────────────────────────────
// `oracleIds()` walks the result set with `Range: off-off+999`. A PostgREST query with no `order=`
// has NO defined row order, so Postgres may return a different sequence per page request and paging
// then drops (or repeats) rows across page boundaries. Measured on جدة / Villa+Duplex / Buy:
//
//     unordered paging -> 3,866 · 3,866 · 3,866      (three consecutive passes)
//     ordered paging   -> 3,867 · 3,867 · 3,867      (RPC truth: 3,867)
//
// One phantom "MISSING eligible ID" on the exact check that exists to prove no listing is lost. It
// reads as a product defect, costs a run to chase, and the same instability could equally have
// hidden a genuinely missing row. (source_table, listing_id) is unique, so it is a total order.
//
// ── 2. CATEGORY PURITY TREATED AS PAGING METADATA ────────────────────────────────────────────────
// `p_category` sat in the translator's "genuinely irrelevant … always safe" list and was skipped.
// It is not irrelevant: af_eligibility_clause() joins known_type_ar and admits a `both`-macro type
// ONLY from the table matching the requested category. Measured on المدينة المنورة / Residential
// Building / Buy: oracle 708 vs RPC 707, stable across passes; the extra row was
// dealapp_commercial_listings:8218315, type_ar «عمارة», macro `both`, in a COMMERCIAL table on a
// RESIDENTIAL search. Production excluded it correctly; the oracle kept it.
//
// The second cost is the one that matters: an oracle blind to category purity would have AGREED
// with a real category leak — the very defect verify-null-category-purity.ts exists for — instead
// of catching it. So p_category now either applies the predicate (given a type_ar → macro map read
// from known_type_ar) or reports UNHANDLED. It is never silently dropped.
//
//   node --experimental-strip-types scripts/verify-af-oracle-soundness.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOracleQS } from './lib/afOracleFilter.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-af-oracle-soundness: the independent oracle pages deterministically and applies');
console.log('  category purity — the two ways it was quietly unsound on 2026-08-28.');

const live = read('scripts/verify-af-live-truth.ts');

// ── 1. EVERY Range-PAGED QUERY CARRIES A TOTAL ORDER ─────────────────────────────────────────────
// Find every PostgREST fetch that pages with a Range header and assert it also sets `order=`.
const pagedFetches = [...live.matchAll(/fetch\(`([^`]*\/rest\/v1\/[^`]*)`[\s\S]{0,200}?Range:/g)].map((m) => m[1]);
check('the live check still pages the oracle with Range (the pattern this guards)', pagedFetches.length > 0,
  `${pagedFetches.length} Range-paged request(s)`);
for (const url of pagedFetches) {
  // `Range: '0-0'` is the count-only probe: it reads the content-range header and never walks pages,
  // so it needs no order. Everything that actually PAGES does. The detail string must read true on a
  // pass as well as a failure — printing "NO order=" under a green check is how a reader gets told
  // the opposite of what happened (the same trap fixed in verify-af-live-truth.ts earlier today).
  const countOnly = !url.includes('source_table') && url.includes('select=listing_id&');
  const ordered = url.includes('order=');
  const short = url.slice(url.indexOf('/rest/v1'), url.indexOf('/rest/v1') + 55);
  check(`Range query is deterministic: ${short}…`, ordered || countOnly,
    ordered ? 'pages with an explicit order'
      : countOnly ? 'count-only probe (Range 0-0), never paged — no order needed'
      : 'PAGES WITH NO order= — non-deterministic across page boundaries');
}
check('the order is a TOTAL order — (source_table, listing_id) is unique, a single column is not',
  /order=source_table\.asc,listing_id\.asc/.test(live));

// ── 2. CATEGORY PURITY IS APPLIED OR REPORTED, NEVER DROPPED ─────────────────────────────────────
const BASE = { p_deal: 'بيع', p_types: ['فيلا'], p_cities: ['جدة'] };
const noMap = buildOracleQS({ ...BASE, p_category: 'Residential' });
check('p_category with no macro map is UNHANDLED (fails loud, never silently ignored)',
  noMap.unhandled.some((u) => u.includes('p_category')), JSON.stringify(noMap.unhandled));

const macros = { 'فيلا': 'Residential', 'عمارة': 'both', 'محل': 'Commercial' };
check('p_category WITH a macro map is fully handled',
  buildOracleQS({ ...BASE, p_category: 'Residential' }, { typeMacros: macros }).unhandled.length === 0);

// The asymmetry is the whole point: `both` survives in the category's own tables and dies in the
// other category's tables, which is exactly what the clause's CASE expression says.
const scoped = {
  ...BASE, p_category: 'Residential',
  p_tables: ['aqar_residential_listings'], p_types: ['فيلا', 'عمارة'],
  p_tables2: ['aqar_commercial_listings'], p_types2: ['فيلا', 'عمارة'],
};
const qs = decodeURIComponent(buildOracleQS(scoped, { typeMacros: macros }).qs);
const arms = qs.match(/and\(source_table\.in\.\([^)]*\),type_ar\.in\.\([^)]*\)\)/g) ?? [];
check('scope A (the category\'s own tables) KEEPS a `both`-macro type',
  arms.some((a) => a.includes('residential_listings') && a.includes('عمارة')), arms.join(' | ') || 'no arms built');
check('scope B (the other category\'s tables) DROPS a `both`-macro type — the 708-vs-707 row',
  arms.some((a) => a.includes('commercial_listings') && !a.includes('عمارة')) || !arms.some((a) => a.includes('commercial_listings')),
  arms.join(' | '));
check('a wrong-category type never enters a scope at all',
  !decodeURIComponent(buildOracleQS({ ...scoped, p_types: ['فيلا', 'محل'] }, { typeMacros: macros }).qs).includes('محل'));

// ── 3. THE LIVE CHECK ACTUALLY SUPPLIES THE MAP ──────────────────────────────────────────────────
// Without this, every journey (they all carry p_category) would go INCONCLUSIVE and the daily
// certification would silently stop certifying anything.
check('the live check reads known_type_ar — the same reference table the RPC joins',
  /known_type_ar\?select=type_ar,macro/.test(live));
check('…and passes it to BOTH oracle entry points (count and ids)',
  (live.match(/buildOracleQS\([^)]*ORACLE_OPTS\)/g) ?? []).length >= 2,
  `${(live.match(/buildOracleQS\([^)]*ORACLE_OPTS\)/g) ?? []).length} call site(s)`);
check('an unreadable reference table stops the run instead of degrading to "no purity"',
  /known_type_ar unreadable/.test(live));

console.log(failures === 0
  ? '\n✅ verify-af-oracle-soundness: all checks passed.'
  : `\n❌ verify-af-oracle-soundness: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
