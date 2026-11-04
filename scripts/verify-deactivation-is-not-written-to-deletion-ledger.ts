// A DEACTIVATION IS NOT A DELETION — a migration may not write cleanup_deletion_log unless it deletes.
//
// cleanup_deletion_log is the audit trail of an IRREVERSIBLE act: scrapers/common/cleanup.py writes
// a row there BEFORE it hard-deletes a listing (DELETION_SAFETY.md §1). A row whose listing is still
// present is a false claim of permanent destruction, and mon_detect_deletion_log_without_delete
// raises `lifecycle_deletion_log_without_delete` on it.
//
// The same mistake was made THREE times by hand-written repair migrations, each one deactivating
// listings on real DIRECT evidence and then recording that deactivation in the DELETION ledger:
//   * 20260919010944 — six wasalt rows (repaired by 20260919144320, which wrote a detector, not a guard);
//   * a 2026-09-19 manual bulk pass — 131 wasalt rows ('manual_bulk_verified');
//   * 20261104013008 — two wasalt rows, 46 days after the first repair.
// A detector catches it after production carries the false claim. This catches it at PR time.
//
// The ledger a deactivation belongs in is ops_stale_inactivation_probe (and, to keep it from being
// switched back on, ops_adjudicated_retraction). All 133 false claims were relocated there by
// migration 20261104033440 (docs/ops/LISTING_LIVENESS.md §3.2).
//
// RULE (hermetic, executed over every committed migration after the last known offender): a
// migration whose EXECUTED SQL inserts into cleanup_deletion_log must also execute a DELETE FROM a
// listing table. Comments do not count in either direction.
//
// Run: node --experimental-strip-types scripts/verify-deactivation-is-not-written-to-deletion-ledger.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
/** The last offender; everything after it is checked. Applied migrations cannot be rewritten. */
const LAST_KNOWN_OFFENDER = '20261104013008';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/** A mutation proof: `caught` is true when the predicate flags a deliberately broken input. */
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

/** Strip `-- …` line comments and `/* … *\/` blocks (prose never counts). */
export function executedSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

/** THE PREDICATE: true = this migration claims deletions it does not perform. */
export function writesLedgerWithoutDeleting(sql: string): boolean {
  const code = executedSql(sql).toLowerCase();
  const writesLedger = /insert\s+into\s+(public\.)?cleanup_deletion_log\b/.test(code);
  if (!writesLedger) return false;
  const deletesListing = /delete\s+from\s+(public\.)?[a-z0-9_]+_(residential|commercial)_listings\b/.test(code);
  return !deletesListing;
}

console.log('verify-deactivation-is-not-written-to-deletion-ledger: a deactivation belongs in');
console.log('ops_stale_inactivation_probe, never in the DELETION ledger.\n');

// ── §A mutation proof, both directions ──────────────────────────────────────────────────────
console.log('  §A the predicate');
const OFFENDER_SHAPE = `insert into public.cleanup_deletion_log (platform, source_table, listing_id) select 'wasalt', 'wasalt_residential_listings', id from public.wasalt_residential_listings where id in (1,2);
update public.wasalt_residential_listings set active = false where id in (1,2);`;
const REAL_DELETE = `insert into public.cleanup_deletion_log (platform, source_table, listing_id) select 'x','x_residential_listings', id from public.x_residential_listings where id = 1;
delete from public.x_residential_listings where id = 1;`;
const COMMENT_ONLY = `-- insert into public.cleanup_deletion_log would be wrong here
update public.x_residential_listings set active = false where id = 1;`;
const COMMENT_DELETE = `insert into cleanup_deletion_log (listing_id) values (1);
-- delete from public.x_residential_listings where id = 1;`;
const RELOCATION = `insert into public.ops_stale_inactivation_probe (source_table) select source_table from public.cleanup_deletion_log;
delete from public.cleanup_deletion_log d where d.run_id is null;`;
mustCatch('a deactivation written into the ledger (the 20261104013008 shape)', writesLedgerWithoutDeleting(OFFENDER_SHAPE));
check('a real delete with its ledger row is GREEN', !writesLedgerWithoutDeleting(REAL_DELETE));
check('a ledger insert mentioned only in a comment does not count', !writesLedgerWithoutDeleting(COMMENT_ONLY));
mustCatch('a delete that exists only in a comment, offered as an excuse for the insert', writesLedgerWithoutDeleting(COMMENT_DELETE));
check('relocating claims OUT of the ledger (read + delete from it) is GREEN', !writesLedgerWithoutDeleting(RELOCATION));

// ── §B the real offenders are caught by this exact predicate ────────────────────────────────
console.log('\n  §B replay of the real offenders');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
for (const v of ['20260919010944', LAST_KNOWN_OFFENDER]) {
  const f = files.find((x) => x.startsWith(v + '_'));
  check(`${v} is present in the tree`, Boolean(f));
  if (f) check(`${v} is classified as an offender`, writesLedgerWithoutDeleting(readFileSync(join(MIGRATIONS, f), 'utf8')));
}

// ── §C every later migration obeys the rule ─────────────────────────────────────────────────
console.log('\n  §C every migration after the last known offender');
const later = files.filter((f) => f.slice(0, 14) > LAST_KNOWN_OFFENDER);
const offenders = later.filter((f) => writesLedgerWithoutDeleting(readFileSync(join(MIGRATIONS, f), 'utf8')));
check(`${later.length} later migration(s) checked; none records a deactivation as a deletion`, offenders.length === 0,
  offenders.join(', ') + ' — record the deactivation in ops_stale_inactivation_probe (+ ops_adjudicated_retraction), not cleanup_deletion_log');

console.log('');
if (failures > 0) {
  console.error(`✗ verify-deactivation-is-not-written-to-deletion-ledger: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✓ verify-deactivation-is-not-written-to-deletion-ledger: all checks passed.');
