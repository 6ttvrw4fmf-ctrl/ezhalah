// Pure migration-drift classification (owner permanent barrier, 2026-08-21): the set-math behind
// "a production migration must have a matching git file in the same change." Kept pure (data in,
// verdict out — no fs, no network) so every condition is provable offline in
// scripts/verify-migration-mirror-integrity.ts and mutation-proof-able, exactly like src/lib/rowClick.ts.
//
// FOUR drift conditions the guard must catch (owner):
//   1. missing_in_git       — applied to prod, no git file. Computed SERVER-side by
//                             ops_deploy_preflight_checks (it alone sees schema_migrations); the
//                             live check just reads it.
//   2. missing_in_prod      — a git migration file that was never applied to prod.  ← findCommittedNotApplied
//   3. duplicate_versions   — two git files claiming the same version timestamp.     ← findDuplicateMigrationVersions
//   4. duplicate_overloads  — a public function with >1 overload (the PGRST203 shape). Server-side.
// driftIsClean() is the single definition of "no drift" (all four empty) shared by the live checker.

// The version-timestamp at which the strict "apply → recover the row VERBATIM into <version>_<name>.sql"
// era begins. Before it, filename prefixes and names routinely diverged from how a migration was
// actually applied, and hand-picked timestamps sometimes collided — all applied fine, distinguished by
// name. Judging those legacy files would cry wolf forever, so BOTH reverse-direction conditions
// (committed-not-applied and duplicate-versions) are grandfathered below this baseline, mirroring how
// ops_deploy_preflight_checks grandfathers pre-20260716093330 missing_in_git drift. Concretely this
// exempts 13 diverged-name files and 3 hand-stamped 14-digit collisions, all ≤ 20260814; every one
// was applied. Past the baseline every migration uses an exact, unique 14-digit version, so any new
// violation is real.
export const STRICT_ERA_BASELINE = '20260815000000';
// Back-compat alias (this const's original name).
export const COMMITTED_NOT_APPLIED_BASELINE = STRICT_ERA_BASELINE;

export type ParsedMigration = { version: string; name: string; file: string };

// supabase/migrations/<digits>_<name>.sql  →  {version:<digits>, name:<name>}. Anything else → null.
export function parseMigrationFilename(file: string): ParsedMigration | null {
  const base = file.replace(/\.sql$/, '');
  const m = base.match(/^([0-9]+)_(.+)$/);
  return m ? { version: m[1], name: m[2], file } : null;
}

// #3: git files that share a version timestamp. In the strict era a 14-digit version is a unique key;
// two files with the same one is always a bug (Postgres would see two migrations claiming one version,
// and a `supabase db push` would collide). Only strict-era 14-digit versions past the baseline are
// judged — legacy 8-digit date prefixes intentionally repeat (many same-day migrations), and a handful
// of pre-baseline hand-stamped 14-digit collisions were applied fine as distinct name-matched rows.
export function findDuplicateMigrationVersions(
  files: string[],
  baseline: string = STRICT_ERA_BASELINE,
): Array<{ version: string; files: string[] }> {
  const byVersion = new Map<string, string[]>();
  for (const f of files) {
    const p = parseMigrationFilename(f);
    if (!p) continue;
    if (!/^[0-9]{14}$/.test(p.version)) continue; // 8-digit date prefixes legitimately repeat
    if (p.version <= baseline) continue;          // grandfather legacy hand-stamped collisions
    (byVersion.get(p.version) ?? byVersion.set(p.version, []).get(p.version)!).push(f);
  }
  return [...byVersion.entries()]
    .filter(([, fs]) => fs.length > 1)
    .map(([version, fs]) => ({ version, files: fs.slice().sort() }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

// #2: git migration files never applied to prod. A file is APPLIED iff its version OR its name appears
// in appliedIds (every live schema_migrations.version ∪ name) — the same version-OR-name rule the
// server uses for missing_in_git, so the two directions stay symmetric. Only real 14-digit-timestamp
// filenames past the strict-era baseline are judged; legacy/oddly-named files are grandfathered.
export function findCommittedNotApplied(
  files: string[],
  appliedIds: Iterable<string>,
  baseline: string = COMMITTED_NOT_APPLIED_BASELINE,
): string[] {
  const applied = appliedIds instanceof Set ? appliedIds : new Set(appliedIds);
  const out: string[] = [];
  for (const f of files) {
    const p = parseMigrationFilename(f);
    if (!p) continue;
    if (!/^[0-9]{14}$/.test(p.version)) continue; // only true timestamp versions
    if (p.version <= baseline) continue;          // grandfather the pre-strict-era files
    if (!applied.has(p.version) && !applied.has(p.name)) out.push(f);
  }
  return out.sort();
}

export type DriftReport = {
  missing_in_git: string[];
  missing_in_prod: string[];
  duplicate_versions: Array<{ version: string; files: string[] }> | string[];
  duplicate_overloads: string[];
};

// The single source of truth for "no drift": every one of the four conditions is empty.
export function driftIsClean(r: DriftReport): boolean {
  return (
    (r.missing_in_git?.length ?? 0) === 0 &&
    (r.missing_in_prod?.length ?? 0) === 0 &&
    (r.duplicate_versions?.length ?? 0) === 0 &&
    (r.duplicate_overloads?.length ?? 0) === 0
  );
}
