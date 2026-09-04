// EVERY PLATFORM TABLE LIVE IN search_listings_ar MUST BE REACHABLE BY A REAL SEARCH.
//
// THE DEFECT THIS EXISTS FOR (2026-09-03). Five platforms were activated in production —
// abralosol, arkaan, therc, rawasidark, aouj: 4,314 production_ready rows added to
// search_listings_ar — without being added to RES_TABLES / COM_TABLES in src/data/remote.ts. The
// results RPC is called WITH p_tables, so those rows were returnable by no search at all, while
// top_cities_by_deal_ar was called WITHOUT p_tables and cheerfully counted them. Trending advertised
// inventory the results screen then refused to deliver: measured live, الهفوف / أرض سكنية / بيع
// promised 2,478 and search returned 109 — 96% of the promise undeliverable.
//
// Nothing in the repo noticed. The AF matrix barrier caught it only indirectly and only on
// `bathrooms=1` — the single predicate wide enough to admit the new rows, since abralosol and
// rawasidark are 0% on `bathrooms` and every narrower cell excluded them on BOTH sides and so agreed
// by accident. A backend activation is a database act; the client table lists are a source-code act;
// nothing joined the two. This check is that join, and it asks the question directly rather than
// hoping some predicate happens to be wide enough to expose it.
//
// WHAT IT ASSERTS. Every distinct `source_table` carrying production_ready rows in
// search_listings_ar is either (a) reachable — present in the table set the client can send, which
// is RES_TABLES ∪ COM_TABLES plus the two monthly-only sources resTables() appends on a
// monthly-inclusive Rent search — or (b) named in ACKNOWLEDGED below with a reason. There is no
// silent third case. An ACKNOWLEDGED table that has gone away also fails, so the list cannot rot
// into a permanent excuse.
//
// WHY AN ACKNOWLEDGED LIST AT ALL. A platform is not necessarily searchable the moment its rows
// land — it needs a liveness strategy that actually runs, end-to-end registration so its cards do
// not render as some other brand, and a client table-list entry. While any of that is outstanding the
// honest state is "live in the view, deliberately not searched", and the point of this barrier is
// that the state is DECLARED and counted on every run instead of being a silent hole nobody can see.
// The list is empty today: PR #1548 closed the 2026-09-03 gap by finishing that work and adding the
// five to the client lists.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-every-live-table-is-searchable.ts
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;                     // resolvePublicSupabase returns the project ORIGIN only
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/**
 * Tables live in search_listings_ar that the client deliberately does NOT search yet.
 *
 * Each entry must state WHY, so the debt reads as a decision rather than an oversight. Remove an
 * entry the moment its platform joins RES_TABLES/COM_TABLES — the barrier then guards it for real.
 *
 * ponytail: a declared-debt list, not a fix. The 4,314 rows below stay unreachable until each
 * platform is certified; the upgrade path is per-platform certification, after which its two lines
 * are deleted here and its tables added to remote.ts.
 */
const ACKNOWLEDGED: Record<string, string> = {
  // EMPTY, and that is the point. It held all ten tables of the five platforms activated on
  // 2026-09-03 for the few hours between their rows going live in search_listings_ar and PR #1548
  // adding them to RES_TABLES/COM_TABLES. The hole is CLOSED: every platform live in the view is now
  // reachable by a real search, so nothing needs excusing. A future entry here is a DECLARATION that
  // some inventory is deliberately unreachable, never a place to park an oversight.
};

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// ── the table set the client can actually send ───────────────────────────────────────────────────
// Read from the REAL source. A hand-kept copy here would drift exactly the way the thing under test
// drifted, and the parse is asserted non-empty so a rename fails loudly instead of matching nothing
// and declaring every live table unreachable (or, worse, none of them).
const remote = readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8');
const listOf = (name: string): string[] => {
  const m = remote.match(new RegExp(`^const ${name} = (\\[[^\\]]*\\]);`, 'm'));
  if (!m) throw new Error(`could not parse ${name} out of src/data/remote.ts — has it been renamed?`);
  return JSON.parse(m[1].replace(/'/g, '"'));
};
const RES_TABLES = listOf('RES_TABLES');
const COM_TABLES = listOf('COM_TABLES');
// resTables() appends these two on any monthly-inclusive Rent search; they ARE reachable.
const MONTHLY_ONLY = [...remote.matchAll(/'((?:gathern|aqarmonthly)_residential_listings)'/g)].map((m) => m[1]);

check('RES_TABLES parsed', RES_TABLES.length > 20, `got ${RES_TABLES.length}`);
check('COM_TABLES parsed', COM_TABLES.length > 20, `got ${COM_TABLES.length}`);
check('the monthly-only sources resTables() appends were found',
  MONTHLY_ONLY.includes('gathern_residential_listings') && MONTHLY_ONLY.includes('aqarmonthly_residential_listings'),
  `got ${MONTHLY_ONLY.join(', ') || '(none)'} — without these, every monthly-only row reads as unreachable`);

const REACHABLE = new Set([...RES_TABLES, ...COM_TABLES, ...MONTHLY_ONLY]);

// The platform→table naming convention this check reasons through. Asserted, not assumed: if a
// platform ever files its rows under an off-pattern table name, the membership test below would call
// it unreachable when it is not, and this check would cry wolf until someone stopped believing it.
const TABLE_NAME = /^([a-z0-9]+)_(residential|commercial)_listings$/;
const offPattern = [...REACHABLE].filter((t) => !TABLE_NAME.test(t));
check('every client table name follows <platform>_(residential|commercial)_listings',
  offPattern.length === 0,
  `${offPattern.join(', ')} — the platform→table mapping below cannot see these`);

// ── what production actually serves ──────────────────────────────────────────────────────────────
// loader_active_platforms_ar() is production's own answer to "which platforms are live in search" —
// the same RPC the loading strip filters itself with (see verify-loader-platforms-match-active.ts).
// Asking it beats scanning search_listings_ar for distinct source_tables: PostgREST has no DISTINCT,
// so the alternative is a `not.in.(…64 table names…)` filter — a ~2KB URL rebuilt on every page, and
// one that silently stops covering a platform the moment its rows land under an unexpected name.
const rpc = await fetch(`${REST}/rpc/loader_active_platforms_ar`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}',
});
if (!rpc.ok) {
  // A production error is a REAL failure, not a skip: reported through check() like any other, so a
  // run that could not measure can never be mistaken for a run that measured and found nothing.
  check('loader_active_platforms_ar() is reachable via the anon key real clients use', false,
    `HTTP ${rpc.status} — ${(await rpc.text()).slice(0, 200)}`);
  console.log('\n✗ verify-every-live-table-is-searchable: could not reach the truth source.\n');
  process.exit(1);
}
const livePlatforms = (await rpc.json()) as string[];
check('loader_active_platforms_ar() returned a plausible fleet', livePlatforms.length > 20,
  `got ${livePlatforms.length} platform(s) — too few to trust as the live set`);

// A platform is unreachable when NEITHER of its two tables is in the set the client can send. Row
// counts come one table at a time, so the URLs stay short and only the unreachable ones are queried.
const count = async (table: string): Promise<number> => {
  const r = await fetch(
    `${REST}/search_listings_ar?production_ready=is.true&source_table=eq.${table}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } },
  );
  if (!r.ok) return -1;
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};
const found = new Map<string, number>();
for (const p of livePlatforms) {
  const tables = [`${p}_residential_listings`, `${p}_commercial_listings`];
  if (tables.some((t) => REACHABLE.has(t))) continue;
  for (const t of tables) {
    const n = await count(t);
    if (n > 0) found.set(t, n);
  }
}

// ── the two directions ───────────────────────────────────────────────────────────────────────────
const unexplained = [...found].filter(([t]) => !(t in ACKNOWLEDGED)).sort((a, b) => b[1] - a[1]);
check('every live source_table is searchable, or acknowledged as deliberately not searched',
  unexplained.length === 0,
  unexplained.map(([t, n]) => `${t} (${n} production_ready rows reachable by NO search)`).join('; '));

const stale = Object.keys(ACKNOWLEDGED).filter((t) => !found.has(t)).sort();
check('no ACKNOWLEDGED entry has gone stale',
  stale.length === 0,
  `${stale.join(', ')} — now reachable (or gone). Delete the entr${stale.length === 1 ? 'y' : 'ies'} so the barrier guards ${stale.length === 1 ? 'it' : 'them'} for real`);

// The debt, quantified on every run — an unreachable row is inventory Ezhalah holds and cannot show.
const acknowledgedRows = [...found].filter(([t]) => t in ACKNOWLEDGED).reduce((n, [, c]) => n + c, 0);
if (acknowledgedRows) {
  console.log(`\n  ⓘ ${acknowledgedRows.toLocaleString()} production_ready rows across ${found.size} acknowledged table(s) are live in search_listings_ar and reachable by no search:`);
  for (const [t, n] of [...found].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${t.padEnd(38)} ${String(n).padStart(6)}  ${ACKNOWLEDGED[t] ?? '(UNEXPLAINED)'}`);
  }
}

console.log(failures === 0
  ? '\n✅ verify-every-live-table-is-searchable: no silent inventory holes.\n'
  : `\n✗ verify-every-live-table-is-searchable: ${failures} check(s) failed — production holds listings no search can return.\n`);
process.exit(failures === 0 ? 0 : 1);
