// A REPAIR THAT DELETES LOCATION ROWS MUST BE UNABLE TO STRIP A LIVE LISTING.
//
// WHAT THIS GUARDS (ops_incident #134)
// ------------------------------------
// A hard delete archives the listing but propagates nothing into the derived per-listing location
// stores, so `listing_native_location_v1` still resolves listings that no longer exist — 1,486 rows
// across three tables on 2026-09-06, the oldest deleted 2026-08-02.
//
// The forward fix is safe by construction: the propagation runs inside the DELETE that causes it,
// keyed on `tg_table_name` and `old.id`, so identity cannot be wrong and no absence is inferred.
//
// THE BACKLOG IS THE DANGEROUS HALF, and it is what this file exists for. Those 1,486 rows have no
// DELETE to ride along with, so a repair must identify them by predicate — and a wrong predicate
// strips a LIVE listing of its location, which silently drops it out of search. The alert says so
// itself: "do NOT delete an orphan row whose raw listing is actually still present: that is a
// different (and opposite) bug."
//
// So the guard requires TWO independent facts and is anchored on PROOF, never on absence:
//   1. `cleanup_deletion_log` carries this exact (source_table, listing_id) — we can prove WE
//      deleted it. A live listing has no such row and is unreachable by construction.
//   2. it really is absent from the table it names — which catches a deleted-then-REUSED id, the
//      one case (1) cannot see.
// Absence ALONE is never sufficient, exactly as it is never sufficient to deactivate a listing.
//
// WHAT THIS FILE CAN AND CANNOT CLAIM. The SQL is staged, not yet applied (see the header of the
// file it reads and ops_incident #134): applying it now would stack a third deploy block behind
// the two mirror PRs already waiting for human merge. So this barrier asserts the STAGED TEXT
// carries every guard — the two-fact predicate, the injection seam, the trigger propagation, and
// the self-test that refuses to delete when any direction fails. The four-way behavioural proof of
// the predicate was executed against production as pure SQL before the file was written (a live
// listing, a proven-deleted one, a deleted-then-reused id, and absence with no proof: only the
// second was removable), and the in-database self-test re-executes it before every single run.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SQL = join(ROOT, 'sql', 'proposed', 'orphan_location_propagation.sql');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  const suffix = ok || !detail ? '' : ' — ' + detail;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + what + suffix);
  if (!ok) failed++;
};

console.log('verify-orphan-location-guard-protects-live-listings: absence alone may not delete a location.');

check(existsSync(SQL), 'the staged repair is committed', SQL);
if (!existsSync(SQL)) { console.log('\n❌ nothing to check.'); process.exit(1); }
const live = readFileSync(SQL, 'utf8');

// The rules, as a pure function so the mutations below execute the same judgement.
type Rule = { id: string; ok: boolean };
const judge = (s: string): Rule[] => [
  // (1) PROOF of deletion is required, and it is the deletion LEDGER, not a listing table.
  { id: 'requires-proof-of-deletion', ok: /cleanup_deletion_log/.test(s) },
  { id: 'refuses-without-that-proof',
    ok: /if not proven_deleted then\s*\n\s*return false;/.test(s) },
  // (2) …and the row must really be absent, which is what catches a REUSED id.
  { id: 'also-requires-real-absence', ok: /return not still_present;/.test(s) },
  // A table it cannot resolve is not an answer — it must refuse, not assume absence.
  { id: 'unresolvable-table-refuses',
    ok: /to_regclass\('public\.' \|\| p_source_table\) is null then\s*\n\s*return false;/.test(s) },
  // The injection seam the self-test needs, so the guard can be executed without writing rows.
  { id: 'guard-is-injectable', ok: /p_inject\s+jsonb/.test(s) },
  // The propagation runs inside the delete, keyed on the row being deleted.
  { id: 'trigger-propagates-on-delete',
    ok: /delete from public\.listings_arabic_locations\s*\n\s*where source_table = tg_table_name and listing_id = id;/.test(s) },
  { id: 'trigger-covers-the-second-store',
    ok: /delete from public\.listing_location_relations\s*\n\s*where source_table = tg_table_name and listing_id = id;/.test(s) },
  // …and it still archives, or the delete loses its audit trail.
  { id: 'trigger-still-archives', ok: /insert into public\.purged_listings_archive/.test(s) },
  // The propagation must NOT swallow its own failure: an aborted propagation must abort the delete.
  // NOTE the `s`, not `live`: this rule closed over the ORIGINAL text on its first draft, so the
  // mutant that adds an exception handler was invisible to it and the mutation survived. A judge
  // that reads anything other than the input it was handed is not judging the input.
  { id: 'propagation-is-not-swallowed',
    ok: !/exception\s+when\s+others/i.test(s.slice(s.indexOf('tg_archive_hard_deleted_listing'))) },
  // The self-test, all four directions, executed before anything is deleted.
  { id: 'selftest-removable-case', ok: /would never drain/.test(s) },
  { id: 'selftest-reused-id-case', ok: /deleted-then-REUSED id was treated as an orphan/.test(s) },
  { id: 'selftest-live-listing-case', ok: /a LIVE listing was treated as an orphan/.test(s) },
  { id: 'selftest-absence-alone-case', ok: /ABSENCE ALONE was treated as proof of deletion/.test(s) },
  { id: 'selftest-unresolvable-case',
    ok: /an unresolvable source_table was treated as proof of absence/.test(s) },
  // …and a failing self-test REFUSES rather than proceeding.
  { id: 'refuses-when-guard-is-blind',
    ok: /'refused', true/.test(s) && /NOTHING was deleted/.test(s) },
  // The repair is bounded and defaults to a dry run, so an accidental call does nothing.
  { id: 'bounded', ok: /limit p_limit/.test(s) },
  { id: 'dry-run-by-default', ok: /p_dry_run boolean default true/.test(s) },
];

const base = judge(live);
for (const r of base) check(r.ok, r.id);
const TOTAL = base.filter((r) => r.ok).length;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF — each mutant is a real way this repair could start deleting live listings'
// locations, applied to the staged SQL and re-judged.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, mutant: string) => {
  check(judge(mutant).filter((r) => r.ok).length < TOTAL, '(mutation) catches ' + what,
    'MUTANT SURVIVED — every rule above still held with the defect present');
};

// The single most dangerous edit: drop the proof requirement and delete on absence alone.
mustCatch('the repair deleting on ABSENCE alone, with no proof of deletion',
  live.replace(/if not proven_deleted then\s*\n\s*return false;\s*\n\s*end if;/, 'if false then\n    return false;\n  end if;'));
// Drop the reuse guard: a recycled id would take a live listing's location with it.
mustCatch('the repair ignoring that a deleted id may have been REUSED by a live listing',
  live.replace('return not still_present;', 'return true;'));
// An unresolvable table read as "absent".
mustCatch('an unresolvable source_table being treated as proof of absence',
  live.replace(/to_regclass\('public\.' \|\| p_source_table\) is null then\s*\n\s*return false;/,
               "to_regclass('public.' || p_source_table) is null then\n    return true;"));
// The self-test loses the case that protects live listings.
mustCatch('the self-test dropping its LIVE-listing direction',
  live.replace('a LIVE listing was treated as an orphan', 'something else'));
mustCatch('the self-test dropping its reused-id direction',
  live.replace('a deleted-then-REUSED id was treated as an orphan', 'something else'));
mustCatch('the self-test dropping its absence-alone direction',
  live.replace('ABSENCE ALONE was treated as proof of deletion', 'something else'));
// A blind guard that proceeds anyway.
mustCatch('the repair proceeding even when its own guard is blind',
  live.replace("'refused', true", "'refused', false"));
// The propagation swallowing its own failure, so a delete can half-happen.
mustCatch('the delete propagation swallowing its own failure',
  live.replace('  if id is not null then', '  begin\n  exception when others then null;\n  end;\n  if id is not null then'));
// The bound and the dry-run default removed.
mustCatch('the repair becoming unbounded', live.replace(/limit p_limit/g, ''));
mustCatch('the repair defaulting to deleting rather than reporting',
  live.replace('p_dry_run boolean default true', 'p_dry_run boolean default false'));

// The control: an edit that changes nothing relevant must NOT read as caught.
check(judge(live + '\n-- an ordinary trailing comment\n').filter((r) => r.ok).length === TOTAL,
  '(control) an irrelevant edit does NOT trip the judgement',
  'the rules go red on any change at all, so their red carries no information');

console.log(failed === 0
  ? '\n✅ verify-orphan-location-guard-protects-live-listings: proof of deletion is required, twice over.'
  : '\n❌ verify-orphan-location-guard-protects-live-listings: ' + failed + ' check(s) failed.');
process.exit(failed === 0 ? 0 : 1);
