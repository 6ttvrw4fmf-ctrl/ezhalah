// REAL regression barrier for the PERMANENT migration-mirror rule (owner 2026-08-21):
//   "Any production migration application must have a matching git migration file in the same change."
//
// The four drift conditions the guard promises to catch are pure set-math over (repo files, live
// applied ids), so they are proven here WITHOUT touching the network — the live half (does prod
// actually agree) is scripts/verify-migration-drift-vs-production.ts, run on schedule + on every push
// that touches supabase/migrations/. This offline test pins the DETECTION LOGIC itself (so a refactor
// can't silently blind a condition) and the repo's own duplicate-version cleanliness, and it is wired
// into `npm test` so every PR runs it — mirroring verify-migration-drift-guard-wired.ts's split.
//
//   node --experimental-strip-types scripts/verify-migration-mirror-integrity.ts
import {
  findDuplicateMigrationVersions, findCommittedNotApplied, driftIsClean,
  COMMITTED_NOT_APPLIED_BASELINE, type DriftReport,
} from './lib/migrationDrift.ts';
import { listMigrationFiles } from './build-repo-migration-versions.cjs';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── #3 duplicate migration versions ────────────────────────────────────────────────────────────────
{
  const dup = findDuplicateMigrationVersions([
    '20260821010101_alpha.sql', '20260821010101_beta.sql', '20260821020202_gamma.sql',
  ]);
  check('#3 two files sharing a version are flagged', dup.length === 1 && dup[0].version === '20260821010101');
  check('#3 the collision lists BOTH files', dup[0]?.files.length === 2);
  check('#3 unique versions → no duplicates',
    findDuplicateMigrationVersions(['20260821010101_a.sql', '20260821020202_b.sql']).length === 0);
  // grandfathering: legacy collisions predating the strict era are exempt (they were applied fine as
  // distinct name-matched rows); repeated 8-digit date prefixes are the old same-day convention.
  check('#3 a PRE-baseline 14-digit collision is grandfathered',
    findDuplicateMigrationVersions(['20260727150000_a.sql', '20260727150000_b.sql']).length === 0);
  check('#3 repeated 8-digit date prefixes are not collisions',
    findDuplicateMigrationVersions(['20260714_a.sql', '20260714_b.sql', '20260714_c.sql']).length === 0);
}

// ── #2 committed-but-not-applied ─────────────────────────────────────────────────────────────────────
{
  const applied = new Set(['20260901120000', 'was_applied_by_name']);
  // version matches live → applied
  check('#2 a file whose VERSION is live is not flagged',
    findCommittedNotApplied(['20260901120000_anything.sql'], applied).length === 0);
  // name matches live (version diverged) → applied
  check('#2 a file whose NAME is live is not flagged (version-or-name, like missing_in_git)',
    findCommittedNotApplied(['20260902130000_was_applied_by_name.sql'], applied).length === 0);
  // neither matches, past baseline → committed but NOT applied
  check('#2 a file applied nowhere (past baseline) IS flagged',
    findCommittedNotApplied(['20260903140000_never_applied.sql'], applied).length === 1);
  // grandfathered: same miss but before the strict-era baseline → not flagged
  check('#2 a pre-baseline legacy file is grandfathered',
    findCommittedNotApplied(['20260814090000_legacy_diverged.sql'], applied).length === 0);
  // non-timestamp version (e.g. a hand-named seed) → never judged
  check('#2 a non-14-digit-versioned file is ignored',
    findCommittedNotApplied(['0001_seed.sql'], applied).length === 0);
  check('#2 the baseline is the strict-era cutoff', COMMITTED_NOT_APPLIED_BASELINE === '20260815000000');
}

// ── driftIsClean: the single "no drift" verdict is true ONLY when all four are empty ─────────────────
const CLEAN: DriftReport = { missing_in_git: [], missing_in_prod: [], duplicate_versions: [], duplicate_overloads: [] };
check('clean report (all four empty) → driftIsClean true', driftIsClean(CLEAN) === true);
check('missing_in_git non-empty → not clean', driftIsClean({ ...CLEAN, missing_in_git: ['20260821x'] }) === false);
check('missing_in_prod non-empty → not clean', driftIsClean({ ...CLEAN, missing_in_prod: ['f.sql'] }) === false);
check('duplicate_versions non-empty → not clean', driftIsClean({ ...CLEAN, duplicate_versions: [{ version: 'v', files: ['a', 'b'] }] }) === false);
check('duplicate_overloads non-empty → not clean', driftIsClean({ ...CLEAN, duplicate_overloads: ['fn'] }) === false);

// ── the repo itself must be free of duplicate migration versions (offline, deterministic) ────────────
{
  const realDup = findDuplicateMigrationVersions(listMigrationFiles());
  check(`repo has 0 duplicate migration versions${realDup.length ? ' — FOUND: ' + realDup.map(d => d.version).join(',') : ''}`,
    realDup.length === 0);
}

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────────
// Re-introduce a plausible bug: a driftIsClean that forgets to check missing_in_prod (the newest of the
// four conditions). A report that is drifted ONLY on missing_in_prod would sail through as "clean" — the
// exact silent regression this barrier exists to prevent. The real verdict MUST catch it.
function buggyDriftIsClean(r: DriftReport): boolean {
  return (r.missing_in_git?.length ?? 0) === 0
    // && (r.missing_in_prod?.length ?? 0) === 0   ← BUG: committed-but-not-applied no longer gates
    && (r.duplicate_versions?.length ?? 0) === 0
    && (r.duplicate_overloads?.length ?? 0) === 0;
}
{
  const drifted: DriftReport = { ...CLEAN, missing_in_prod: ['20260901010101_orphan.sql'] };
  check('MUTATION PROOF: the buggy verdict WOULD pass a committed-not-applied drift (barrier detects it)',
    buggyDriftIsClean(drifted) === true);
  check('MUTATION PROOF: the real verdict CATCHES it (barrier is meaningful)',
    driftIsClean(drifted) === false && buggyDriftIsClean(drifted) === true);
}

console.log(failed === 0 ? '\n✓ migration-mirror-integrity: all assertions passed' : `\n✗ ${failed} assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
