// THE SEARCHABLE-PLATFORM SCOPE IS ONE THING — and this is what makes it stay one thing.
//
// THE DEFECT (owner-escalated, 2026-09-03). Five platforms — therc, aouj, abralosol, arkaan,
// rawasidark — were activated in production: 4,314 production_ready rows landed in
// search_listings_ar. The results RPC is called WITH p_tables, built from two hand-maintained
// literals in src/data/remote.ts; the new tables were in neither. Trending
// (top_cities_by_deal_ar) was called with NO p_tables at all and spanned the whole index. So
// Trending counted inventory no search could return: measured on الرياض/شقة/إيجار/سنوي with
// p_bath_min:=1, Trending said 3,422 and the committed search delivered 3,340.
//
// A backend activation is a DATABASE act. The client scope was a SOURCE-CODE act. Nothing joined
// the two, so the gap was invisible until a wide enough predicate happened to expose it. This
// barrier is that join, and it asks the question directly.
//
// WHAT IT ASSERTS, in both directions:
//   MISSING — a platform live in production's search index whose tables the client never sends.
//             That is the bug above: inventory Ezhalah holds and cannot show.
//   EXTRA   — a table the client sends that production does not have. That is a rename, a drop, or
//             a typo, and it means the scope is describing an inventory that no longer exists.
// Both name the offending tables. There is no third, silent case.
//
// IT EXECUTES THE REAL FUNCTIONS. resTables/comTables and the lists they derive from are LIFTED out
// of src/data/remote.ts and run (scripts/lib/liftSymbols.ts) — never re-typed here, never regex-
// scraped out of the source. A copy of the thing under test is a check that passes while production
// breaks; that is precisely how a text-parsing earlier draft of this file would have died the moment
// the two literals became derived.
//
// WHY THE LIVE TIER, not `npm test`. The question is "does the CLIENT scope match the LIVE
// inventory", and half of that lives in production — no offline check can answer it, and one that
// pretended to would be asserting a snapshot of the DB against itself. The offline, structural half
// (the partition is total; the monthly conditional holds) is executed here too AND is duplicated
// into npm test via verify-trending-carries-full-filter-state.ts, so a pure-source regression is
// caught on every PR without waiting for a scheduled run.
//
// IT FAILS CLOSED. Every path that cannot MEASURE exits non-zero. A network barrier that reports
// success when it could not reach the network is worse than no barrier: it manufactures confidence.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-searchable-scope-matches-inventory.ts
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.
// Shared pacing (owner 2026-09-04): wraps fetch so this harness's production searches are
// spaced against every OTHER routine's, not just its own. Never drops or alters a request.
import './lib/searchPacer.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripComments } from './lib/stripComments.ts';
import { liftSearchScope } from './lib/liftSearchScope.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? `\n        ${detail}` : ''}`);
  if (!cond) failures++;
};
/** A barrier that cannot measure must never report success. */
const die = (why: string): never => {
  console.log(`\n✗ SKIP-FAIL: ${why}`);
  process.exit(1);
};

// ── the REAL scope, lifted and executed ──────────────────────────────────────────────────────────
// SearchQuery is shimmed to the three fields the lifted code actually reads. Not `any`: a rename of
// deal/rentPeriod/dealCombined must break this lift loudly rather than silently evaluate undefined
// and make every monthly assertion trivially true.
type Q = { deal?: string; rentPeriod?: string; dealCombined?: boolean };
const lifted = await liftSearchScope(ROOT).catch((e) => die(`could not lift the scope out of src/data/remote.ts — ${(e as Error).message}`));

const SEARCHABLE_TABLES = lifted.SEARCHABLE_TABLES as string[];
const RES_TABLES = lifted.RES_TABLES as string[];
const COM_TABLES = lifted.COM_TABLES as string[];
const DEEPLINK_TABLES = lifted.DEEPLINK_TABLES as string[];
const monthlyInScope = lifted.monthlyInScope as (q: Q) => boolean;
const resTables = lifted.resTables as (q: Q) => string[];
const comTables = lifted.comTables as (q: Q) => string[];

console.log('\n── the scope, executed ─────────────────────────────────────────────────────────');
check('the inventory lifted and is plausibly the fleet', SEARCHABLE_TABLES.length >= 50,
  `got ${SEARCHABLE_TABLES.length} table(s) — too few to be the real inventory`);
check('the inventory has no duplicates',
  new Set(SEARCHABLE_TABLES).size === SEARCHABLE_TABLES.length,
  'a duplicated table would double-count nothing but proves the generator or a hand-edit went wrong');

// ── 1. THE PARTITION IS TOTAL ────────────────────────────────────────────────────────────────────
// Every inventory table must be reachable in SOME mode. A table that falls out of every mode is
// exactly the original bug wearing different clothes — present in the inventory, returnable by no
// search — and it would otherwise pass the live checks below simply by being in SEARCHABLE_TABLES.
// The widest mode is a combined-deal search, which pulls the monthly-only sources in on both kinds.
const WIDEST: Q = { dealCombined: true };
const everReachable = new Set([...resTables(WIDEST), ...comTables(WIDEST)]);
const unreachableInEveryMode = SEARCHABLE_TABLES.filter((t) => !everReachable.has(t)).sort();
check('every inventory table is reachable in at least one search mode',
  unreachableInEveryMode.length === 0,
  `${unreachableInEveryMode.join(', ')} — in the inventory, returnable by NO search`);
const invented = [...everReachable].filter((t) => !SEARCHABLE_TABLES.includes(t)).sort();
check('no mode invents a table outside the inventory', invented.length === 0, invented.join(', '));

// ── 1b. THE DEEP-LINK RESOLVER READS THE SAME ONE INVENTORY ──────────────────────────────────────
// fetchListingById() is the OTHER surface that has to know the fleet: an in-app-browser deep link and
// a restored session both resolve a listing by id through it. Until 2026-09-04 it looped over a THIRD
// hand-maintained literal, and this barrier — which only ever looked at resTables/comTables — could
// not see it, which is precisely why it had drifted: MISSING aqarmonthly_residential_listings (1,731
// production_ready rows, reachable through any monthly search) and gathern_commercial_listings, while
// still probing six RETIRED tables (toor, awal, alnokhba × res+com). The user-visible effect was a
// monthly listing that search could find and no deep link could open.
//
// Two assertions, because either alone is satisfiable by the bug: the lifted DEEPLINK_TABLES must BE
// the inventory (set equality, both directions), and the resolver's own body must contain no table
// name at all — a private literal that happened to match today would pass the first check and drift
// again tomorrow.
const dlMissing = SEARCHABLE_TABLES.filter((t) => !DEEPLINK_TABLES.includes(t)).sort();
const dlExtra = DEEPLINK_TABLES.filter((t) => !SEARCHABLE_TABLES.includes(t)).sort();
check('the deep-link resolver covers every inventory table', dlMissing.length === 0,
  `${dlMissing.join(', ')} — searchable, but fetchListingById() would resolve them to NULL`);
check('the deep-link resolver names no table outside the inventory', dlExtra.length === 0,
  `${dlExtra.join(', ')} — probed by id but not searchable (a retired or renamed table)`);
check('the deep-link order is a permutation, not a filter',
  DEEPLINK_TABLES.length === SEARCHABLE_TABLES.length
    && new Set(DEEPLINK_TABLES).size === DEEPLINK_TABLES.length,
  `${DEEPLINK_TABLES.length} entries vs ${SEARCHABLE_TABLES.length} in the inventory`);

// A COMMENT IS NOT A CODE PATH: read the resolver's body with comments stripped and COUNT the table
// names left in the CODE. The prose above fetchListingById names tables on purpose; only a literal
// that the loop could actually iterate is a finding.
const remoteSrc = await readFile(join(ROOT, 'src/data/remote.ts'), 'utf8')
  .catch((e) => die(`could not read src/data/remote.ts — ${(e as Error).message}`));
const fnStart = remoteSrc.indexOf('export async function fetchListingById(');
const fnBody = fnStart < 0 ? '' : stripComments(remoteSrc.slice(fnStart, remoteSrc.indexOf('\n}', fnStart)));
check('fetchListingById() is still there to assert on', fnStart >= 0 && fnBody.length > 0);
const literalTables = fnBody.match(/['"`][a-z0-9]+_(residential|commercial)_listings['"`]/g) ?? [];
check('fetchListingById() carries NO private table literal (it iterates the one inventory)',
  literalTables.length === 0 && /for \(const table of DEEPLINK_TABLES\)/.test(fnBody),
  literalTables.length
    ? `${literalTables.length} table name(s) hardcoded in the resolver: ${[...new Set(literalTables)].join(', ')}`
    : 'the loop no longer iterates DEEPLINK_TABLES — it is reading some other list');

// ── 2. THE MONTHLY-ONLY CONDITIONAL, BY EXECUTION, IN EVERY MODE ─────────────────────────────────
// gathern_* and aqarmonthly_* are monthly-only verticals: every listing is a monthly rental. They
// enter the scope ONLY when the period scope includes monthly. This is a product rule, not an
// optimisation — Gathern is rent-only and must never appear in a Buy result (CLAUDE.md) — so it is
// asserted by running the real function over every mode the Filter can produce, not by reading it.
const MODES: Array<{ label: string; q: Q; monthly: boolean }> = [
  { label: 'Buy',                       q: { deal: 'Buy' },                                monthly: false },
  { label: 'Rent · annual',             q: { deal: 'Rent', rentPeriod: 'annual' },         monthly: false },
  { label: 'Rent · no period chosen',   q: { deal: 'Rent' },                               monthly: false },
  { label: 'Rent · monthly',            q: { deal: 'Rent', rentPeriod: 'monthly' },        monthly: true  },
  { label: 'Rent · both periods',       q: { deal: 'Rent', rentPeriod: 'both' },           monthly: true  },
  { label: 'Buy+Rent combined',         q: { dealCombined: true },                         monthly: true  },
  { label: 'Buy+Rent combined · annual', q: { dealCombined: true, rentPeriod: 'annual' },  monthly: true  },
  { label: 'Buy, monthly token stray',  q: { deal: 'Buy', rentPeriod: 'monthly' },         monthly: false },
];
const isMonthlyOnly = (t: string) => /^(gathern|aqarmonthly)_/.test(t);
const monthlyInventory = SEARCHABLE_TABLES.filter(isMonthlyOnly);
check('the inventory actually contains monthly-only sources to gate',
  monthlyInventory.length >= 2,
  `got ${monthlyInventory.join(', ') || '(none)'} — with none present every gate assertion below is vacuous`);

for (const { label, q, monthly } of MODES) {
  const got = [...resTables(q), ...comTables(q)];
  const present = got.filter(isMonthlyOnly).sort();
  const expected = monthly ? monthlyInventory.slice().sort() : [];
  check(`${label} → monthly-only sources ${monthly ? 'IN' : 'OUT'}`,
    JSON.stringify(present) === JSON.stringify(expected)
      && monthlyInScope(q) === monthly,
    `got [${present.join(', ')}], expected [${expected.join(', ')}]`);
  // The non-monthly tables must be identical in every mode: the period scope decides ONLY whether
  // the monthly-only sources join, never which ordinary platforms are searched.
  const ordinary = got.filter((t) => !isMonthlyOnly(t)).sort();
  const allOrdinary = [...RES_TABLES, ...COM_TABLES].sort();
  check(`${label} → every ordinary platform still in scope`,
    JSON.stringify(ordinary) === JSON.stringify(allOrdinary),
    `${allOrdinary.filter((t) => !ordinary.includes(t)).join(', ') || '(none missing)'} dropped`);
}

// ── 3. LIVE: what production actually serves ─────────────────────────────────────────────────────
console.log('\n── against the live inventory ──────────────────────────────────────────────────');
const rpc = await fetch(`${REST}/rpc/loader_active_platforms_ar`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}',
}).catch((e) => die(`loader_active_platforms_ar() unreachable — ${(e as Error).message}`));
if (!rpc.ok) die(`loader_active_platforms_ar() returned ${rpc.status} — ${(await rpc.text()).slice(0, 200)}`);
const livePlatforms = (await rpc.json()) as string[];
check('loader_active_platforms_ar() returned a plausible fleet', livePlatforms.length >= 20,
  `got ${livePlatforms.length} platform(s) — too few to trust as the live set`);

/** Rows a single source_table contributes to search_listings_ar; `live` restricts to production_ready. */
const rows = async (table: string, live: boolean): Promise<number> => {
  const filter = live ? 'production_ready=is.true&' : '';
  const r = await fetch(
    `${REST}/search_listings_ar?${filter}source_table=eq.${table}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } },
  ).catch(() => null);
  if (!r || !r.ok) return die(`could not count ${table} — ${r ? r.status : 'network error'}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};

// MISSING. `platform` IS the table-name prefix — asserted, not assumed: every platform production
// reports as live must resolve to at least one table carrying rows. If that convention ever breaks,
// this check must fail loudly rather than quietly conclude the platform is fine because it could not
// find its tables.
//
// RESOLUTION is tested on ALL rows and SEVERITY on production_ready rows only, deliberately. A
// platform whose rows are all currently non-production_ready is perfectly ordinary — it still
// appears in loader_active_platforms_ar, which does not filter on that column — and testing
// resolution with the production_ready filter would report it as a broken naming convention. The two
// questions are "can I find this platform's tables at all" and "does it hold inventory a user should
// be able to reach"; conflating them makes the barrier cry wolf, and a barrier nobody believes is
// worse than none.
const missing: Array<[string, number]> = [];
const unresolved: string[] = [];
for (const p of livePlatforms) {
  const tables = [`${p}_residential_listings`, `${p}_commercial_listings`];
  const anyRows = await Promise.all(tables.map((t) => rows(t, false)));
  if (anyRows.every((n) => n <= 0)) { unresolved.push(p); continue; }
  for (const [i, t] of tables.entries()) {
    if (anyRows[i] <= 0 || everReachable.has(t)) continue;
    const live = await rows(t, true);
    if (live > 0) missing.push([t, live]);
  }
}
check('every live platform resolves to its <platform>_(residential|commercial)_listings tables',
  unresolved.length === 0,
  `${unresolved.join(', ')} — live in search_listings_ar but neither table name carries rows; the naming convention this check reasons through has broken, so its MISSING result cannot be trusted`);

missing.sort((a, b) => b[1] - a[1]);
check('MISSING: no platform live in search is absent from the client scope',
  missing.length === 0,
  missing.map(([t, n]) => `${t} — ${n.toLocaleString()} production_ready rows reachable by NO search`).join('\n        '));

// EXTRA. A table the client sends that production does not have. PostgREST answers 404/PGRST205 for
// a relation that is not there and 200 for one that is (even when empty), so an intentionally
// registered zero-row platform is NOT flagged — only a genuinely absent table is.
const extra: string[] = [];
for (const t of SEARCHABLE_TABLES) {
  const r = await fetch(`${REST}/${t}?select=id&limit=0`, { headers: H }).catch(() => null);
  if (!r) die(`could not probe ${t} — network error`);
  if (r.status === 404) extra.push(t);
  else if (!r.ok) die(`probing ${t} returned ${r.status} — ${(await r.text()).slice(0, 160)}`);
}
check('EXTRA: no client table is absent from production',
  extra.length === 0,
  `${extra.join(', ')} — the client scope names ${extra.length === 1 ? 'a table' : 'tables'} production does not have. Regenerate: node --experimental-strip-types scripts/gen-searchable-tables.ts`);

console.log(failures === 0
  ? `\n✅ verify-searchable-scope-matches-inventory: ${SEARCHABLE_TABLES.length} tables, one scope, no drift.\n`
  : `\n✗ verify-searchable-scope-matches-inventory: ${failures} check(s) failed — the client scope and the live inventory disagree.\n`);
process.exit(failures === 0 ? 0 : 1);
