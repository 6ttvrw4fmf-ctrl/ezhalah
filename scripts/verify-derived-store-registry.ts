// REAL barrier for the derived-store registry (phase 1 of docs/ops/DERIVED_STORE_FRESHNESS.md).
//
// THE DEFECT THIS CLOSES (2026-08-31). Two per-listing derived stores — phasea_src_arabic and
// listings_arabic_locations — fed live location resolution with NOTHING comparing them against the
// source. Both went stale; listings were served in the wrong city and the wrong district for weeks
// while every barrier read green. The store that had a monitor at all
// (mon_district_contradicts_source) had it as a VIEW with no detector and no roster entry.
//
// The registry (ops_derived_store_registry) makes that impossible in the DB: every registered store
// must name a watcher detector that exists, or an explicit unwatched_reason, and
// mon_detect_unwatched_derived_store() raises P1 otherwise.
//
// But a registry only helps if it is COMPLETE. A new store wired into the resolver and never
// registered would be invisible again — the same bug wearing a different hat. This check closes
// that, offline and deterministically, by reading two files the repo already maintains:
//
//   1. sql/mirrors/listing_native_location_v1.sql — byte-exact with the live resolver, and kept
//      that way by verify-sql-mirrors-not-stale.ts + mon_detect_sql_mirror_drift.
//   2. the migration that seeds ops_derived_store_registry.
//
// Every per-listing derived store the resolver READS must appear in the registry seed. No DB
// connection, so it runs on every PR.
//
// SCOPE. Curated geography catalogs (loc_catalog_*, loc_*_map, loc_city_alias_ar) are excluded by
// design: they describe Saudi Arabia, not listings, and being static is correct for them. So are
// the resolver's own CTE aliases and the live-truth canonical side.
//
//   node --experimental-strip-types scripts/verify-derived-store-registry.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MIRROR = join(ROOT, 'sql', 'mirrors', 'listing_native_location_v1.sql');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

/** SQL only — the mirror's header is prose that mentions md5(pg_get_viewdef(...)) and the like. */
const stripComments = (sql: string) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

/** Names the resolver reads that are NOT per-listing derived stores. */
const NOT_A_STORE = (name: string) =>
  name.startsWith('loc_') ||                       // curated geography catalogs
  name.endsWith('_listings') ||                    // the source tables themselves
  name.startsWith('listing_location_canonical') || // live-truth side, not a snapshot
  ['lateral', 'only', 'unnest', 'generate_series'].includes(name) ||          // SQL keywords
  ['native', 'legacy', 'ranked', 'best', 'v', 'p', 's', 'a', 'c', 'r', 't', 'z', 'lal', 'llc', 'cr',
   'pin', 'cc', 'q', 'dup', 'risk', 'base', 'res', 'mv'].includes(name); // CTE / alias tokens

/** Per-listing derived stores the committed resolver mirror actually reads. */
export function storesReadByResolver(mirrorSql: string): string[] {
  const found = new Set<string>();
  for (const m of stripComments(mirrorSql)
      .matchAll(/\b(?:FROM|JOIN)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    const name = m[1].toLowerCase();
    if (!NOT_A_STORE(name)) found.add(name);
  }
  return [...found].sort();
}

/** Store names + resolver-facing aliases seeded into the registry.
 *  Scoped to the INSERT ... VALUES block: elsewhere the migration contains mon_raise('P1', …),
 *  which matches the same row shape and would otherwise be read as a registered store. */
export function registeredStores(migrationSql: string): { names: Set<string>; aliases: Set<string> } {
  const names = new Set<string>();
  const aliases = new Set<string>();
  const start = migrationSql.search(/insert\s+into\s+public\.ops_derived_store_registry/i);
  const end = migrationSql.indexOf('on conflict', start < 0 ? 0 : start);
  const block = start < 0 ? '' : migrationSql.slice(start, end < 0 ? undefined : end);
  // Rows look like:  ('store_name', 'appears_in_resolver_as' | null, ...
  for (const m of block.matchAll(/\(\s*'([a-z_][a-z0-9_]*)'\s*,\s*(?:'([a-z_][a-z0-9_]*)'|null)/gi)) {
    names.add(m[1].toLowerCase());
    if (m[2]) aliases.add(m[2].toLowerCase());
  }
  return { names, aliases };
}

const mirror = readFileSync(MIRROR, 'utf8');
const seedFile = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => readFileSync(join(MIG_DIR, f), 'utf8').includes('ops_derived_store_registry'))
  .sort()
  .pop();

check('a migration creates/seeds ops_derived_store_registry', Boolean(seedFile));
const seed = seedFile ? readFileSync(join(MIG_DIR, seedFile), 'utf8') : '';

const read = storesReadByResolver(mirror);
const { names, aliases } = registeredStores(seed);

// ── 1. COMPLETENESS — the whole point ────────────────────────────────────────────────────────────
check('#1 the resolver mirror yields at least one derived store (parser still works)', read.length > 0);
const unregistered = read.filter((s) => !names.has(s) && !aliases.has(s));
check(`#1 every derived store the resolver reads is registered${
  unregistered.length ? ` — UNREGISTERED: ${unregistered.join(', ')}` : ''}`, unregistered.length === 0);
console.log(`      resolver reads: ${read.join(', ')}`);
console.log(`      registered:     ${[...names].sort().join(', ')}`);

// ── 2. EVERY ENTRY IS WATCHED OR EXPLAINED — enforced in SQL, pinned here ────────────────────────
check('#2 the table constraint requires a watcher or a reason',
  /constraint\s+watched_or_explained\s+check\s*\(\s*watcher_detector is not null or unwatched_reason is not null\s*\)/i
    .test(seed));
check('#2 a detector raises when a store is unwatched',
  /create or replace function public\.mon_detect_unwatched_derived_store/i.test(seed)
  && /mon_raise\(\s*'P1'/.test(seed));
check('#2 it also catches a watcher that no longer exists',
  seed.includes('watcher_missing') && seed.includes('pg_proc'));
check('#2 it self-heals via mon_resolve_key', seed.includes('mon_resolve_key'));

// ── 3. ROSTER WIRING — an unrostered detector is decoration ──────────────────────────────────────
check('#3 the detector is wired into mon_run_all_detectors in the same migration',
  seed.includes('mon_run_all_detectors') && seed.includes('mon_detect_unwatched_derived_store'));
check('#3 roster insertion is idempotent',
  /position\('mon_detect_unwatched_derived_store' in def\)\s*=\s*0/.test(seed));
check('#3 roster wiring fails closed if its anchor is gone',
  /raise exception/i.test(seed) && seed.includes('refusing to guess'));

// ── 4. NO SILENT EXPIRY — phase 4b is not approved ───────────────────────────────────────────────
// max_age_hours exists as a column but must not be acted on by anything yet.
check('#4 max_age_hours is declared but nothing acts on it (phase 4b needs owner approval)',
  seed.includes('max_age_hours') && !/max_age_hours\s*(<|>|is not null)/i.test(
    seed.slice(seed.indexOf('create or replace function'))));

// ── 5. MUTATION PROOF — an incomplete registry must FAIL ─────────────────────────────────────────
{
  const fakeMirror = "FROM public.listings_arabic_locations x JOIN some_new_frozen_store y ON true";
  const leaked = storesReadByResolver(fakeMirror)
    .filter((s) => !names.has(s) && !aliases.has(s));
  check('#5 a newly-wired unregistered store is caught', leaked.includes('some_new_frozen_store'));
  // and the catalogs must NOT be dragged in
  check('#5 curated catalogs are not treated as derived stores',
    storesReadByResolver('JOIN loc_catalog_city c JOIN loc_district_map m').length === 0);
}

// ── 6. Wired into the suite ──────────────────────────────────────────────────────────────────────
check('#6 this check is discovered by npm test', npmTestRuns(ROOT, 'verify-derived-store-registry'));

console.log(failed === 0
  ? '\n✓ derived-store registry complete — no store feeds resolution unwatched'
  : `\n✗ ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
