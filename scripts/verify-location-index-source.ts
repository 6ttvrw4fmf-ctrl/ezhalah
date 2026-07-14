#!/usr/bin/env -S node --import tsx
// ─────────────────────────────────────────────────────────────────────────────────────────
// LOCATION_INDEX REPOINT TRIPWIRE — OFFLINE (source-text check)
//
// Runs before every production build (`npm run verify` → vercel.json buildCommand). Deterministic and
// fully OFFLINE — it inspects the CODE being deployed, so it can only fail on a real regression, never
// on live-data drift or a Supabase blip. locations.ts pulls in the full taxonomy/data layer, so a real
// import-and-execute test isn't practical here; a source-text check is the same pattern already used
// by verify-gathern-rent-only.ts for a similar heavy-dependency file.
//
// ROOT CAUSE THIS GUARDS (investigated 2026-07-14): `ensureLocationIndex()` in src/data/locations.ts
// was the ONLY live FE code path reading `public.location_index` — a materialized view refreshed by
// NO cron job (orphaned since 2026-06-23; jobid 16's actual command refreshes
// `listing_location_index` + `listing_location_canonical_mv`, never `location_index`). Fix: repoint to
// `public.location_index_live`, a plain view over the actively-refreshed
// `listing_location_canonical_mv` (see supabase/migrations/20260714_location_index_live_view.sql).
//
// CHECKS (all offline, against src/data/locations.ts):
//   1. ensureLocationIndex() must query `location_index_live`, not the orphaned `location_index`.
//   2. The selected columns must still be exactly `city,district,region,n` — the shape every
//      downstream consumer (LIVE_CITIES/LIVE_DISTRICTS/regionForCity/citiesInRegion/
//      topCitiesInRegion/cityHasListings-equivalent) depends on; a silent column-shape drift here
//      would break autocomplete without throwing.
//   3. No other file in src/ queries the orphaned `location_index` table directly (guards against a
//      second caller reappearing without this tripwire being updated).
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

function main() {
  const src = readFileSync(LOCATIONS_PATH, 'utf8');

  // 1) ensureLocationIndex() must target the live view, not the orphaned MV.
  const supabaseFromCalls = [...src.matchAll(/supabase\.from\(['"]([^'"]+)['"]\)\.select\(['"]([^'"]+)['"]\)/g)];
  const locationCall = supabaseFromCalls.find(([, table]) => table === 'location_index_live' || table === 'location_index');
  if (!locationCall) fail(`no supabase.from('location_index_live'|'location_index').select(...) call found in ${LOCATIONS_PATH} — has ensureLocationIndex() been refactored? Update this tripwire alongside it.`);
  const [, table, columns] = locationCall!;
  if (table !== 'location_index_live') {
    fail(`ensureLocationIndex() still queries the orphaned '${table}' table (refreshed by NO cron job since 2026-06-23 — see docs/ARCHITECTURE.md §13). It must query 'location_index_live' instead.`);
  }
  console.log(`✓ ensureLocationIndex() targets 'location_index_live' (the actively-refreshed view), not the orphaned 'location_index' MV`);

  // 2) Column shape must be unchanged — every downstream consumer depends on exactly these 4 fields.
  const expectedCols = ['city', 'district', 'region', 'n'];
  const gotCols = columns.split(',').map((c) => c.trim());
  const sameSet = gotCols.length === expectedCols.length && expectedCols.every((c) => gotCols.includes(c));
  if (!sameSet) {
    fail(`location_index_live query selects [${gotCols.join(', ')}], expected exactly [${expectedCols.join(', ')}] (LIVE_CITIES/LIVE_DISTRICTS/regionForCity/citiesInRegion/topCitiesInRegion all depend on this exact shape).`);
  }
  console.log(`✓ location_index_live query selects the exact expected columns: ${gotCols.join(', ')}`);

  // 3) No other file should query the orphaned table directly (only comments may mention its name).
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, 'src'))) {
    if (file === LOCATIONS_PATH) continue; // already checked above, and it's expected to mention the name in comments
    const text = readFileSync(file, 'utf8');
    const liveCodeHit = /supabase\.from\(['"]location_index['"]\)/.test(text);
    if (liveCodeHit) offenders.push(file);
  }
  if (offenders.length > 0) {
    fail(`found live supabase.from('location_index') call(s) outside locations.ts: ${offenders.map((f) => f.replace(ROOT + '/', '')).join(', ')} — repoint these too.`);
  }
  console.log(`✓ no other src/ file queries the orphaned 'location_index' table directly`);

  console.log('\n✅ location_index repoint tripwire passed — deployment may proceed.');
}

main();
