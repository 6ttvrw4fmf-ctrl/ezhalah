// EVERY SEARCHABLE TABLE MUST HAVE ITS OWN BRANCH IN listing_extra_attrs — LIVE HALF.
//
// The production-reading half of verify-all-platforms-have-extra-attrs-branch.ts (see that file for
// the bug class and why this is TABLE-grained, not platform-grained). The hermetic predicate and its
// mutation proofs stay in the required `npm test`; this file, which can only answer by asking
// production, runs in .github/workflows/loader-active-platforms-check.yml with the other per-platform
// coverage reads (ops_incident #104 family).
//
// NO NEW RPC, NO NEW MIGRATION. Unlike ops_af_attribute_coverage() (which needs pg_depend/pg_class —
// privileged catalog access the anon key cannot have), table-level branch existence is answered from
// DATA that is already anon-selectable: does listing_extra_attrs carry ANY row for this exact
// source_table? Both listing_extra_attrs and search_listings_ar already grant anon SELECT.
//
// A table that is genuinely wired but momentarily holds zero rows would read as "absent" by
// data-presence alone — measured live 2026-09-12 while building this file: 10 tables
// (alta/fursaghyr/gathern/jazwtn/jurash/october/ramzalqasim/satel/shmoualshmal_commercial_listings and
// amlakalahsa_commercial_listings) looked like gaps by data-presence, but every one has a real branch
// in the view's own text (pg_get_viewdef) and simply has zero currently-ACTIVE rows (small
// single-office platforms, or a monthly-only-by-design commercial arm). That is exactly why
// searchable_rows gates the verdict (extraAttrsTableGaps in scripts/lib/coverageGaps.ts): only a
// table that HAS searchable rows in search_listings_ar and STILL shows zero under listing_extra_attrs
// is a gap.
//
// SAME COUNTING TECHNIQUE AS verify-searchable-scope-matches-inventory.ts's own rows() helper — a
// PostgREST count-exact GET with `limit=1`, read off the Content-Range header. Deliberately NOT the
// RPC-POST fail-closed vocabulary (rpcProbeOutcome/outcomeIsUsable) the OTHER ops_incident #104 live
// halves use: that pair assumes success is exactly HTTP 200, which this call shape is not — PostgREST
// answers a `Prefer: count=exact` + `limit` combination with 206 Partial Content on SUCCESS (measured
// live building this file), and routing 206 through rpcProbeOutcome() misclassified it as
// 'unreachable'. `r.ok` (2xx) is the correct, already-established test for THIS shape, exactly as
// verify-searchable-scope-matches-inventory.ts already uses it — reused here, not re-decided.
//
// MUTATION-PROOF-EXEMPT: this file has no logic of its own to mutate — it counts rows over the
// network and hands the counts to extraAttrsTableGaps()/describeExtraAttrsTableGaps(), which live
// in scripts/lib/coverageGaps.ts and its hermetic sibling (verify-all-platforms-have-extra-attrs-
// branch.ts) already proves sound with 5 mutations against that same shared predicate — including
// the exact platform-grained blind spot (one table missing while its sibling is wired) this rule
// exists to catch. A proof duplicated here would exercise nothing this file itself decides.
//   node --experimental-strip-types scripts/verify-all-platforms-have-extra-attrs-branch-live.ts
import { join } from 'node:path';
import { liftSearchScope } from './lib/liftSearchScope.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import {
  extraAttrsTableGaps,
  describeExtraAttrsTableGaps,
  type ExtraAttrsTableRow,
} from './lib/coverageGaps.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
/** A barrier that cannot measure must never report success. Fails CLOSED (exit 1) — this is NOT
 * the banned "read a repo secret directly, exit 1 on every scheduled run forever" shape
 * verify-live-checks-self-sufficient.ts exists to catch (this file resolves its endpoint via
 * resolvePublicSupabase(), never a raw env var); it's a genuine "could not measure right now"
 * exit. Named CANNOT-MEASURE rather than that historical incident's own literal label so this
 * file's legitimate fail-closed path is never confused with the bug class it is NOT. */
const die = (why: string): never => {
  console.log(`\n✗ CANNOT-MEASURE: ${why}`);
  process.exit(1);
};

console.log('\nEvery searchable TABLE has its own branch in listing_extra_attrs (LIVE)\n');

const { url: BASE, key } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: key, Authorization: `Bearer ${key}` };

/** Exact row count for one source_table under one view/table, via the Content-Range header. Fails
 * CLOSED (die → exit 1) on any non-2xx or network error — never returns a number for a failed read,
 * so a caller can never mistake "could not measure" for "measured zero". */
async function countRows(view: string, table: string, productionReadyOnly: boolean): Promise<number> {
  const filter = productionReadyOnly ? 'production_ready=is.true&' : '';
  const r = await fetch(
    `${REST}/${view}?${filter}source_table=eq.${table}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } },
  ).catch(() => null);
  if (!r || !r.ok) return die(`could not count ${table} in ${view} — ${r ? r.status : 'network error'}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
}

const lifted = await liftSearchScope(ROOT).catch((e) => die(`could not lift SEARCHABLE_TABLES — ${(e as Error).message}`));
const SEARCHABLE_TABLES = lifted.SEARCHABLE_TABLES as string[];
check('SEARCHABLE_TABLES lifted and is plausibly the fleet', SEARCHABLE_TABLES.length >= 50,
  `got ${SEARCHABLE_TABLES.length}`);

const rows: ExtraAttrsTableRow[] = [];
for (const table of SEARCHABLE_TABLES) {
  const [searchable_rows, extra] = await Promise.all([
    countRows('search_listings_ar', table, true),
    countRows('listing_extra_attrs', table, false),
  ]);
  rows.push({ table, searchable_rows, in_extra_attrs: extra > 0 });
}

// die() above already exits on any unreachable count, so reaching here means every table measured.
check('the probe is evaluating the real fleet (sanity: it still sees searchable rows somewhere)',
  rows.some((r) => r.searchable_rows > 0), 'zero tables carried any searchable rows at all');

const gaps = extraAttrsTableGaps(rows);
check('every searchable table has a branch in listing_extra_attrs',
  gaps.length === 0, gaps.length ? describeExtraAttrsTableGaps(gaps) : '');

console.log(failed === 0
  ? '\n✅ every searchable table reaches listing_extra_attrs.\n'
  : `\n❌ ${failed} check(s) failed — a searchable table is missing its listing_extra_attrs branch.\n`);
process.exit(failed === 0 ? 0 : 1);
