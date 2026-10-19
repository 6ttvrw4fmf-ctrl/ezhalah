// LIVE half: does the bundle REAL USERS ARE SERVED reach every platform that holds live inventory?
//
// The sibling `scripts/verify-searchable-scope-matches-inventory.ts` asks the same question of the
// SOURCE TREE. This one asks it of production's own bytes. The difference is the entire point, and
// it is `ops_incident` #731: for ~7 hours on 2026-09-25 those two answers disagreed — main's scope
// named abaad's tables, the served bundle's did not, and 380 rows were unreachable while the
// source-side check read green. `scripts/lib/servedSearchScope.ts` carries the full incident and the
// three other layers that were green through it.
//
// Both halves share ONE predicate (servedScopeProblems) so the offline mutation proof is a statement
// about the function that really decides this verdict, not about a copy of it —
// `docs/ops/BARRIER_ENGINEER.md`'s split rule, and AGENTS.md's "never test a copy of production code".
//
// IT FAILS CLOSED, EVERY WAY IT CAN. An unreachable site, an unreadable bundle, an unreachable RPC,
// an implausible fleet, or an extraction that yields nothing all exit non-zero. A live check that
// reports success when it could not measure manufactures confidence, which is worse than no check —
// AGENTS.md: **A FAILED FETCH IS NOT AN EMPTY ANSWER.**
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml beside its source-side sibling.
//
//   node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-served-scope-reaches-every-live-platform-live.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import {
  extractServedSearchableTables, servedScopeProblems, type LiveTable,
} from './lib/servedSearchScope.ts';

const PROD = 'https://ezhalah-app.vercel.app';
const { url: BASE, key: KEY } = resolvePublicSupabase();
const REST = `${BASE}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  failed++;
  console.error(`  FAIL  ${label}`);
  if (why) console.error(`        ${why}`);
};
const die = (msg: string): never => {
  console.error(`\n✗ COULD NOT MEASURE — failing closed: ${msg}\n`);
  process.exit(1);
};

console.log('\nIs every platform with live inventory reachable from the SERVED bundle?\n');

// ── 1. the bundle real users are served ───────────────────────────────────────────────────────────
const fetchText = async (url: string, label: string): Promise<string> => {
  const res = await fetch(url, { headers: { 'user-agent': 'ezhalah-served-scope-check' } })
    .catch((e) => die(`${label}: ${(e as Error).message}`));
  if (!res.ok) die(`${label}: HTTP ${res.status} fetching ${url}`);
  const body = await res.text();
  // A 200 carrying an error page is the status-code-only trap; an empty body at 200 is the other
  // half of it. Neither is a readable page, and neither may pass as one.
  if (body.length === 0) die(`${label}: HTTP 200 with an EMPTY body — not a readable response`);
  return body;
};

const html = await fetchText(`${PROD}/`, 'production HTML');
const entry = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/.exec(html);
if (!entry) {
  die('production HTML references no Expo web entry bundle — the app may have moved off Expo web, '
    + "so this check's bundle discovery needs updating. It is BLIND, not clean.");
}
console.log(`  served entry bundle: ${entry[0]}`);
const bundle = await fetchText(`${PROD}${entry[0]}`, 'served entry bundle');
// The real bundle measured 7,014,751 bytes on 2026-09-25. A floor three orders of magnitude below
// that still catches an error page or a truncated transfer passing as a bundle.
if (bundle.length < 500_000) die(`served bundle is only ${bundle.length} bytes — not a real bundle`);
console.log(`  served bundle bytes: ${bundle.length.toLocaleString()}`);

const served = extractServedSearchableTables(bundle);
console.log(`  SEARCHABLE_TABLES in the served bundle: ${served.length}`);

// ── 2. production's live inventory ────────────────────────────────────────────────────────────────
// The SAME live-set source the source-side sibling uses, deliberately: two barriers disagreeing about
// what "live" means would produce a difference that is about the barriers, not about production.
const rpc = await fetch(`${REST}/rpc/loader_active_platforms_ar`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}',
}).catch((e) => die(`loader_active_platforms_ar() unreachable — ${(e as Error).message}`));
if (!rpc.ok) die(`loader_active_platforms_ar() returned ${rpc.status} — ${(await rpc.text()).slice(0, 200)}`);
const platforms = (await rpc.json()) as string[];
check('loader_active_platforms_ar() returned a plausible fleet', platforms.length >= 20,
  `got ${platforms.length} platform(s) — too few to trust as the live set`);
if (failed) process.exit(1);

/** production_ready rows a single source_table contributes to the served index. */
const rows = async (table: string): Promise<number> => {
  const r = await fetch(
    `${REST}/search_listings_ar?production_ready=is.true&source_table=eq.${table}&select=listing_id&limit=1`,
    { headers: { ...H, Prefer: 'count=exact' } },
  ).catch(() => null);
  if (!r) return die(`could not count ${table} — network error`);
  // 404/PGRST205 means the relation is absent, which is a legitimate answer of "no live rows here";
  // anything else non-2xx is a failure to measure and must not read as zero.
  if (r.status === 404) return 0;
  if (!r.ok) return die(`counting ${table} returned ${r.status}`);
  const n = Number(r.headers.get('content-range')?.split('/')[1] ?? -1);
  if (!Number.isFinite(n) || n < 0) return die(`could not read a count for ${table}`);
  return n;
};

const live: LiveTable[] = [];
for (const p of platforms) {
  for (const suffix of ['residential', 'commercial'] as const) {
    const table = `${p}_${suffix}_listings`;
    live.push({ table, productionReadyRows: await rows(table) });
  }
}
const withRows = live.filter((t) => t.productionReadyRows > 0);
check('production reports a plausible amount of live inventory', withRows.length >= 20,
  `only ${withRows.length} table(s) carry production_ready rows — treat as a failed measurement`);
if (failed) process.exit(1);
console.log(`  live tables carrying production_ready rows: ${withRows.length}`);

// ── 2b. which served tables production genuinely DOES NOT HAVE ────────────────────────────────────
// Asked as EXISTENCE, never as "absent from the active fleet" — the distinction the predicate's own
// comment records, learned by this barrier accusing الحميدان on its first live run. PostgREST answers
// 404/PGRST205 for a relation that is not there and 200 for one that is, even when empty, so a
// deliberately staged or fully-transacted platform is NOT flagged; only a genuinely absent table is.
const absentFromProduction: string[] = [];
for (const t of served) {
  const r = await fetch(`${REST}/${t}?select=id&limit=0`, { headers: H }).catch(() => null);
  if (!r) die(`could not probe ${t} — network error`);
  if (r.status === 404) absentFromProduction.push(t);
  else if (!r.ok) die(`probing ${t} returned ${r.status} — ${(await r.text()).slice(0, 160)}`);
}

// ── 3. the one comparison, through the shared predicate ───────────────────────────────────────────
const problems = servedScopeProblems(served, live, absentFromProduction);
check('every platform holding live inventory is reachable from the SERVED bundle, and the served '
  + 'scope names nothing production does not have',
  problems.length === 0, problems.join('\n        '));

// ── mutation proof, against PRODUCTION'S OWN bytes ────────────────────────────────────────────────
// The predicate's shapes are proven offline; what this proves is that the predicate is being fed the
// REAL served scope and the REAL inventory — that the two readings above actually reached production
// and are not empty, stale, or each other. So the probes are applied to the live values, and stated
// DIFFERENTIALLY: each must ADD a problem the real inputs do not already produce. An "is clean"
// control here would print BLIND on a day production has genuinely drifted, i.e. output that says the
// opposite of what is true (ops_incident #42), and today is exactly such a day.
console.log('\n  mutation proof — the live readings, probed\n');
let mut = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  (mutation) catches ${label}`); return; }
  mut++;
  console.error(`  FAIL  (mutation) BLIND to ${label}`);
};
const before = problems.length;

// M-1: THE INCIDENT's shape, against the real served scope — a platform production holds that the
// bundle really being served does not name. If this does not fire, `served` is not the live scope.
mustCatch('a live platform the REAL served bundle does not name (the incident shape, live inputs)',
  servedScopeProblems(served, [...live, { table: '__probe_residential_listings', productionReadyRows: 7 }],
    absentFromProduction)
    .some((p) => p.startsWith('UNREACHABLE') && p.includes('__probe_residential_listings')));

// M-2: PHANTOM, against a table the real served scope genuinely carries. If this does not fire,
// `served` is empty or is not the array the bundle ships.
mustCatch('a REAL served table reported absent from production (phantom shape, live inputs)',
  servedScopeProblems(served, live, [...absentFromProduction, served[0]])
    .some((p) => p.startsWith('PHANTOM') && p.includes(served[0])));

// M-3: non-vacuity in the only form that is honest today — the probes ADDED problems rather than the
// predicate being red for everything. Re-running with the untouched live inputs must reproduce
// exactly the verdict reported above, no more.
mustCatch('…while the untouched live inputs reproduce exactly the verdict above (no drift in the probe itself)',
  servedScopeProblems(served, live, absentFromProduction).length === before);

if (mut > 0) failed += mut;

if (failed) {
  console.error(
    '\n      Remedy: this is the SERVED bundle, so a green source-side check does not clear it. Either '
    + '\n      the repair is merged and unshipped — deploy it (dispatch .github/workflows/deploy-frontend.yml '
    + '\n      once the deploy gates are clear; if a gate refuses, THAT blockage is the finding) — or '
    + '\n      src/data/remote.ts genuinely disagrees with the live inventory, in which case '
    + '\n      scripts/verify-searchable-scope-matches-inventory.ts is red too and names the same tables.',
  );
}

console.log(
  failed === 0
    ? `\n✅ the served bundle's ${served.length}-table search scope reaches every one of production's `
      + `${withRows.length} live tables.\n`
    : `\n❌ ${failed} check(s) failed — real users cannot reach inventory Ezhalah holds.\n`,
);
process.exit(failed === 0 ? 0 : 1);
