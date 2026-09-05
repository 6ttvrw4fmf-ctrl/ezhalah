// A DEEP LINK IS A SEARCH SURFACE. It must not serve a listing the source has delisted.
//
// THE DEFECT (P1, incident #34 — found by routine #11's FIRST executed run, 2026-09-05).
// Every user-facing surface in Ezhalah resolves aliveness through `active_listing_ids_v2`, whose
// arms are all `WHERE active IS TRUE`: results, Advanced Filter, Trending, district counts,
// pagination. `fetchListingById()` did not. It read the raw table with `.eq('id', id)` and no
// predicate at all — and `LIST_SELECT` does not even fetch the `active` column, so nothing
// downstream could have noticed.
//
// 68,788 rows are `active = false` fleet-wide and every one of them rendered as a live card through
// this path. Proven against production with the ANON key, not privileged SQL: ids 585260 / 629782 /
// 4744698 each returned a full card payload carrying `"active": false`.
//
// Why this one mattered more than the same leak elsewhere: the search stack HEALS. Routine #11
// measured a 16-row leak clearing in ~47-52 minutes once the :14 sync and the :20 matview refresh
// propagated. The deep link never healed. On the four platforms with a retention policy the row
// survives 30+ days; on the other 60 tables there is no hard delete at all, so a shared or
// bookmarked link to a delisted property showed it as still on the market indefinitely.
//
// THIS BARRIER EXECUTES the real fetchListingById() against a stub client that APPLIES the filters
// the way PostgREST does, and asserts behaviour — it does not grep for `.eq('active', true)`. A
// source-text tripwire over the exact line is the shape that stayed green through all five of the
// 2026-09-04 defects (AGENTS.md, "A FAILED FETCH IS NOT AN EMPTY ANSWER"), and routine #10's first
// run found six more of them in this very suite on the same day.
//
// Run: node --experimental-strip-types scripts/verify-deeplink-cannot-serve-a-dead-listing.ts

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const REMOTE = join(ROOT, 'src/data/remote.ts');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// A stub that behaves like PostgREST: .eq() narrows, and only rows matching EVERY filter come back.
// If the production code stops asking for active=true, the inactive fixture row survives the filter
// chain and is returned — which is exactly the defect, reproduced rather than described.
const ROWS: Record<string, any[]> = {
  aqar_residential_listings: [
    { id: 111, active: true,  transaction_type: 'Rent', property_type: 'شقة', city_ar: 'الرياض' },
    { id: 222, active: false, transaction_type: 'Rent', property_type: 'شقة', city_ar: 'الرياض' },
  ],
};
const stubClient = () => ({
  from(table: string) {
    let rows = [...(ROWS[table] ?? [])];
    const api: any = {
      select: () => api,
      limit: () => Promise.resolve({ data: rows, error: null }),
      eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return api; },
    };
    return api;
  },
});

const PRELUDE = `
type Listing = Record<string, any>;
const LIST_SELECT = 'id';
const DEEPLINK_TABLES = ['aqar_residential_listings'];
const LISTING_CACHE = new Map<number, any>();
const finalize = (rows: any[]) => rows;          // identity: this barrier is about WHICH rows arrive
let supabase: any = null;
const __setClient = (c: any) => { supabase = c; };
`;

const load = async (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'ezhalah-deeplink-'));
  const f = join(dir, 'remote.ts');
  writeFileSync(f, source);
  // Explicit terminator: liftSymbols' default only recognises `function `/`export function `, so an
  // `export async function` falls through to the `};` arrow terminator and never finds one.
  return (await liftSymbols(f, [{ header: 'export async function fetchListingById(', endsWith: /^\}$/ }],
    ['fetchListingById', '__setClient'], PRELUDE)) as {
      fetchListingById: (id: number) => Promise<any>;
      __setClient: (c: any) => void;
    };
};

const real = readFileSync(REMOTE, 'utf8');
const mod = await load(real);
mod.__setClient(stubClient());

// ── 1. THE RULE ───────────────────────────────────────────────────────────────────────────────
const dead = await mod.fetchListingById(222);
check('a delisted listing (active=false) is NOT served by a deep link',
  dead === null, `got ${JSON.stringify(dead)}`);

// ── 2. NOT VACUOUS — a live listing must still resolve, or the "fix" is just a broken deep link ──
const live = await mod.fetchListingById(111);
check('a live listing (active=true) IS still served', live !== null && live?.id === 111,
  `got ${JSON.stringify(live)}`);
check('a genuinely absent id still resolves to null',
  (await mod.fetchListingById(999)) === null);

// ── 3. MUTATION PROOFS — the defect re-introduced into the REAL file and re-executed ──────────
const mustCatch = async (what: string, mutate: (s: string) => string) => {
  const mutated = mutate(real);
  if (mutated === real) { check(`MUTATION: ${what} — ANCHOR DRIFTED, mutant never applied`, false); return; }
  const m = await load(mutated);
  m.__setClient(stubClient());
  const served = await m.fetchListingById(222);
  check(`MUTATION: catches ${what}`, served !== null,
    'the mutant served no dead listing — this proof is not exercising the defect');
};

await mustCatch('the active predicate being dropped entirely (the defect verbatim)',
  (s) => s.replace(".eq('id', id).eq('active', true).limit(1)", ".eq('id', id).limit(1)"));
// Anchored on the QUERY, not the bare predicate: this file's own header quotes `.eq('active', true)`
// in prose, and String.replace takes the FIRST occurrence — so the loose form mutated a comment,
// left the code untouched, and the check below correctly refused to call that a proof.
await mustCatch('the predicate inverted to active=false',
  (s) => s.replace(".eq('id', id).eq('active', true)", ".eq('id', id).eq('active', false)"));

// ── 4. THE SIBLING PATHS. #34's root cause was ONE path skipping a rule every other path applies,
//      so the barrier checks the class, not the instance: no query in remote.ts may read a listings
//      table by id without the predicate. DEEPLINK_TABLES is the shared inventory that keeps this
//      from becoming a private list (its own comment records the aqarmonthly miss it already caused).
const byIdQueries = real.split('\n')
  .filter((l) => /\.from\(table\)|\.from\('[a-z0-9_]*_listings'\)/.test(l) && /\.eq\('id',/.test(l));
check(`every by-id listings query carries the active predicate (${byIdQueries.length} found)`,
  byIdQueries.length > 0 && byIdQueries.every((l) => /\.eq\('active', true\)/.test(l)),
  byIdQueries.filter((l) => !/\.eq\('active', true\)/.test(l)).join(' | '));

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-deeplink-cannot-serve-a-dead-listing'),
  'the guard is inert');

console.log(failed === 0
  ? `\n✅ verify-deeplink-cannot-serve-a-dead-listing: a delisted listing stays delisted.\n`
  : `\n❌ verify-deeplink-cannot-serve-a-dead-listing: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
