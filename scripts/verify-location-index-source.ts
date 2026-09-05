#!/usr/bin/env -S node --import tsx
// ─────────────────────────────────────────────────────────────────────────────────────────
// LOCATION_INDEX REPOINT TRIPWIRE — OFFLINE (source-text check)
//
// Runs before every production build (`npm run verify` → vercel.json buildCommand). Deterministic and
// fully OFFLINE — it inspects the CODE being deployed, so it can only fail on a real regression, never
// on live-data drift or a Supabase blip.
//
// "A REAL IMPORT-AND-EXECUTE TEST ISN'T PRACTICAL HERE" — that note stood at the top of this file and
// is now STALE BY CONSTRUCTION, corrected 2026-09-04 by routine #10. It was true when written;
// `scripts/lib/liftSymbols.ts` has since made it false, and `verify-failed-location-index-is-not-a-load.ts`
// EXECUTES the very same function — ensureLocationIndex() — against a stub client that resolves
// `{ data: null, error }` the way supabase-js really does. So the execution half of this surface
// exists and is covered there; duplicating it here would be churn. What this file uniquely owns is
// the STATIC question that no execution can answer offline: which table name the query targets, and
// which columns it selects. It is kept as a source check for that reason and no longer for the
// absent-tooling one — and its predicates below are pure and mutation-proven, not bare greps.
//
// ROOT CAUSE THIS GUARDS (investigated 2026-07-14): `ensureLocationIndex()` in src/data/locations.ts
// was the ONLY live FE code path reading `public.location_index` — a materialized view refreshed by
// NO cron job (orphaned since 2026-06-23; jobid 16's actual command refreshes
// `listing_location_index` + `listing_location_canonical_mv`, never `location_index`). Fix: repoint to
// `public.location_index_live`, a plain view over the actively-refreshed
// `listing_location_canonical_mv` (see supabase/migrations/20260714_location_index_live_view.sql).
//
// CHECKS (all offline, against src/data/locations.ts):
//   1. EVERY location-index call must query `location_index_live`, not the orphaned
//      `location_index` (hardened 2026-07-16: used to validate only the first match, so a second
//      stale call after a correct one slipped through — proven empirically before fixing).
//   2. The selected columns must still be exactly `city,district,region,n` — the shape every
//      downstream consumer (LIVE_CITIES/LIVE_DISTRICTS/regionForCity/citiesInRegion/
//      topCitiesInRegion/cityHasListings-equivalent) depends on; a silent column-shape drift here
//      would break autocomplete without throwing.
//   3. No file in src/ (locations.ts included — hardened 2026-07-16, it used to be exempt) queries
//      the orphaned `location_index` table directly.
// ─────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCATIONS_PATH = join(ROOT, 'src/data/locations.ts');

const fail = (msg: string): never => {
  console.error(`\n❌ LOCATION_INDEX REPOINT TRIPWIRE FAILED: ${msg}\n   Deployment blocked until fixed.`);
  process.exit(1);
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.expo') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// ── the two predicates, pure, so the mutation proofs at the bottom can feed them broken source ────
//
// WHITESPACE-TOLERANT (repaired 2026-09-04 by routine #10). Both regexes used to demand
// `supabase.from('x').select('y')` as one unbroken run of characters, so a prettier-formatted chain
//
//     const { data } = await supabase
//       .from('location_index')
//       .select('city,district,region,n');
//
// aimed at the ORPHANED materialized view matched NEITHER check and passed the tripwire silently.
// Watched to happen: both predicates returned "clean" on exactly that text. That is not a
// hypothetical formatting style — it is what this repo's own formatter produces once a chain grows.
// The sting is that check 3's comment already CLAIMED to be the net for this case ("a stale call that
// dodges check 1's stricter from().select() shape (e.g. a multi-line chain) is still caught by this
// simpler pattern"); it used `supabase\.from\(` too, so it had the identical hole. A comment is not a
// code path.
const CALL_RE = /supabase\s*\.\s*from\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*select\(\s*['"]([^'"]+)['"]\s*\)/g;
const STALE_TABLE_RE = /supabase\s*\.\s*from\(\s*['"]location_index['"]\s*\)/;

/** Every location-index call in a source file, as [table, columns] pairs. */
export const locationIndexCalls = (src: string): Array<[string, string]> =>
  [...src.matchAll(CALL_RE)]
    .filter(([, table]) => table === 'location_index_live' || table === 'location_index')
    .map(([, table, columns]) => [table, columns] as [string, string]);

/** True when a file makes a live call against the ORPHANED `location_index` MV. */
export const queriesOrphanedTable = (src: string): boolean => STALE_TABLE_RE.test(src);

function main() {
  const src = readFileSync(LOCATIONS_PATH, 'utf8');

  // 1) ensureLocationIndex() must target the live view, not the orphaned MV.
  //
  // HARDENED 2026-07-16 (batch 4): this used to validate only the FIRST matching call
  // (`.find(...)`), so a file containing a correct location_index_live call FOLLOWED by a second,
  // stale location_index call passed the tripwire (proven with an injected second call — check 3
  // couldn't catch it either, because it deliberately skips this file). Now EVERY matching call is
  // validated, and check 3 below scans this file too.
  const locationCalls = locationIndexCalls(src);
  if (locationCalls.length === 0) fail(`no supabase.from('location_index_live'|'location_index').select(...) call found in ${LOCATIONS_PATH} — has ensureLocationIndex() been refactored? Update this tripwire alongside it.`);
  const staleCalls = locationCalls.filter(([table]) => table !== 'location_index_live');
  if (staleCalls.length > 0) {
    fail(`${staleCalls.length} of ${locationCalls.length} location-index call(s) in ${LOCATIONS_PATH} still query the orphaned 'location_index' table (refreshed by NO cron job since 2026-06-23 — see docs/ARCHITECTURE.md §13). Every call must query 'location_index_live' instead.`);
  }
  console.log(`✓ all ${locationCalls.length} location-index call(s) target 'location_index_live' (the actively-refreshed view), not the orphaned 'location_index' MV`);

  // 2) Column shape must be unchanged — every downstream consumer depends on exactly these 4 fields.
  const expectedCols = ['city', 'district', 'region', 'n'];
  for (const [, columns] of locationCalls) {
    const gotCols = columns.split(',').map((c) => c.trim());
    const sameSet = gotCols.length === expectedCols.length && expectedCols.every((c) => gotCols.includes(c));
    if (!sameSet) {
      fail(`location_index_live query selects [${gotCols.join(', ')}], expected exactly [${expectedCols.join(', ')}] (LIVE_CITIES/LIVE_DISTRICTS/regionForCity/citiesInRegion/topCitiesInRegion all depend on this exact shape).`);
    }
    console.log(`✓ location_index_live query selects the exact expected columns: ${gotCols.join(', ')}`);
  }

  // 3) No src/ file may query the orphaned table directly (only comments may mention its name).
  // HARDENED 2026-07-16 (batch 4): locations.ts is no longer exempt. The regex requires the closing
  // quote immediately after 'location_index', so the correct 'location_index_live' calls can never
  // false-positive here — and a stale call that dodges check 1's stricter from().select() shape
  // (e.g. a multi-line chain) is still caught by this simpler pattern. That last clause was FALSE
  // until 2026-09-04: this pattern demanded `supabase.from(` with no whitespace either, so it had
  // the identical hole. Both now go through the whitespace-tolerant predicates above.
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, 'src'))) {
    if (queriesOrphanedTable(readFileSync(file, 'utf8'))) offenders.push(file);
  }
  if (offenders.length > 0) {
    fail(`found live supabase.from('location_index') call(s): ${offenders.map((f) => f.replace(ROOT + '/', '')).join(', ')} — repoint these to 'location_index_live'.`);
  }
  console.log(`✓ no src/ file queries the orphaned 'location_index' table directly`);

  console.log('\n✅ location_index repoint tripwire passed — deployment may proceed.');
}

main();

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
// The predicates above are applied to source text this barrier did NOT write in the healthy case
// (it reads src/data/locations.ts); the mutants below are the formatting variants of the real,
// already-fixed defect — a call aimed at the orphaned MV.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`✓ mutation caught: ${label}`); return; }
  mutFail++;
  console.error(`✗ MUTATION SURVIVED — BLIND to ${label}`);
};

const ONE_LINE = `const { data } = await supabase.from('location_index').select('city,district,region,n');`;
const MULTI_LINE = `const { data } = await supabase\n    .from('location_index')\n    .select('city,district,region,n');`;
const HEALTHY = `const { data } = await supabase.from('location_index_live').select('city,district,region,n');`;

mustCatch('a one-line call against the orphaned location_index MV',
  locationIndexCalls(ONE_LINE).some(([t]) => t === 'location_index') && queriesOrphanedTable(ONE_LINE));
mustCatch('THE HOLE THIS REPAIRED — the same stale call written as a multi-line chain, which both ' +
  'checks used to miss while check 3 claimed in a comment to be the net for it',
  locationIndexCalls(MULTI_LINE).some(([t]) => t === 'location_index') && queriesOrphanedTable(MULTI_LINE));
mustCatch('a stale call FOLLOWING a correct one (the 2026-07-16 first-match hole stays closed)',
  locationIndexCalls(`${HEALTHY}\n${MULTI_LINE}`).filter(([t]) => t === 'location_index').length === 1);
mustCatch('a column-shape drift on the live view',
  locationIndexCalls(`supabase.from('location_index_live').select('city,region')`)[0][1] !== 'city,district,region,n');
mustCatch('the healthy call is NOT flagged (the predicates are not vacuously red)',
  locationIndexCalls(HEALTHY).length === 1 && !queriesOrphanedTable(HEALTHY));
mustCatch('…and the orphaned NAME inside a comment is not a call',
  !queriesOrphanedTable(`// the old location_index MV was orphaned; see ARCHITECTURE §13`));

if (mutFail) {
  console.error(`\n❌ ${mutFail} guard(s) are BLIND to their own defect`);
  process.exit(1);
}
