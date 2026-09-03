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
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
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
const lifted = await liftSymbols(
  join(ROOT, 'src/data/remote.ts'),
  [
    { header: 'const SEARCHABLE_TABLES = [', endsWith: /\];$/ },
    { header: 'const MONTHLY_ONLY_TABLE = ', endsWith: /;$/ },
    { header: 'const RES_TABLES = ', endsWith: /;$/ },
    { header: 'const COM_TABLES = ', endsWith: /;$/ },
    { header: 'function monthlyInScope(' },
    { header: 'function monthlyOnly(' },
    { header: 'function resTables(' },
    { header: 'function comTables(' },
  ],
  ['SEARCHABLE_TABLES', 'RES_TABLES', 'COM_TABLES', 'monthlyInScope', 'resTables', 'comTables'],
  'type SearchQuery = { deal?: string; rentPeriod?: string; dealCombined?: boolean };\n',
).catch((e) => die(`could not lift the scope out of src/data/remote.ts — ${(e as Error).message}`));

const SEARCHABLE_TABLES = lifted.SEARCHABLE_TABLES as string[];
const RES_TABLES = lifted.RES_TABLES as string[];
const COM_TABLES = lifted.COM_TABLES as string[];
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

/** production_ready rows a single source_table currently contributes to search_listings_ar. */
const rows = async (table: string): Promise<number> => {
  const r = await fetch(
    `${REST}/search_listings_ar?production_ready=is.true&source_table=eq.${table}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } },
  ).catch(() => null);
  if (!r || !r.ok) return die(`could not count ${table} — ${r ? r.status : 'network error'}`);
  return Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
};

// MISSING. `platform` IS the table-name prefix — asserted, not assumed: every live platform must
// resolve to at least one table carrying rows. If that convention ever breaks, this check must fail
// loudly rather than quietly conclude the platform is fine because it could not find its tables.
const missing: Array<[string, number]> = [];
const unresolved: string[] = [];
for (const p of livePlatforms) {
  const tables = [`${p}_residential_listings`, `${p}_commercial_listings`];
  const counts = await Promise.all(tables.map(rows));
  if (counts.every((n) => n <= 0)) { unresolved.push(p); continue; }
  tables.forEach((t, i) => { if (counts[i] > 0 && !everReachable.has(t)) missing.push([t, counts[i]]); });
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
