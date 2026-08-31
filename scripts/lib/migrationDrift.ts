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

// ── CONDITION #5: CONTENT PARITY (routine #7, systems seam, 2026-08-30) ───────────────────────
//
// THE HOLE THIS CLOSES. Conditions #1–#4 all compare IDENTIFIERS — a version, a name, a function
// signature. Not one of them ever looks at what a migration file SAYS. So a committed file can
// contain SQL production never executed (or omit SQL production did execute) and every barrier in
// the repo stays green: the version matches, the name matches, drift reads clean.
//
// Found live on 2026-08-30: 70 of 264 strict-era files (26.5%) differ in content from the
// statements production actually ran. The consequence is not theoretical — 20260829234156's git
// file carries a `do $do$` block registering mon_detect_ai_telemetry_health in the sweep that the
// applied statements do NOT contain, and 20260829172402's file is 2,260 bytes against 24,177
// applied. Two things break: AGENTS.md's stated repair path ("recover the SQL verbatim from
// schema_migrations.statements") assumes the repo is a faithful record, and a reviewer reading the
// file has no way to know production ran something else. It is also how a detector registration can
// exist only in git — the dark-detector shape this repo has already been burned by once.
//
// NORMALISATION IS EXACT, NOT FUZZY. A faithful mirror is byte-identical to the applied statements
// modulo trailing newlines (proven on 20260829223530: file 4,004 bytes → 4,003 trimmed → md5
// identical to the applied text). So `normalizeMigrationSql` only strips trailing whitespace. No
// comment-stripping, no whitespace collapsing: a looser comparison would let real SQL differences
// hide behind "it's probably just formatting", which is the failure mode this whole barrier exists
// to prevent.
//
// RATCHET, NOT A CLIFF. The 70 pre-existing divergences are listed in
// scripts/migration-content-parity-baseline.txt as a FLOOR — the same pattern as
// scripts/test-baseline.txt and STRICT_ERA_BASELINE. They are known debt owned by the routines that
// landed them; this check does not fail on them, but it fails on any NEW one. Entries may only be
// REMOVED (as each is reconciled); adding one takes a deliberate, reviewed edit, and
// verify-migration-content-parity-wired.ts fails if the baseline ever grows.

// A faithful mirror differs from the applied statements only in trailing whitespace.
export function normalizeMigrationSql(sql: string): string {
  return sql.replace(/\s+$/, '');
}

// ── DIVERGENCE CLASSIFICATION (routine #7, 2026-08-31) ────────────────────────────────────────
//
// ADDITIVE. This does NOT relax the comparison above — `normalizeMigrationSql` still decides
// WHETHER a file diverges, byte-exactly, and the "no comment-stripping" rule stated above still
// governs that decision. What follows only CLASSIFIES a divergence the exact comparison has
// already found, so the alert can carry a dedup key per class.
//
// WHY IT EXISTS. Condition #5 raised on ONE constant dedup key. mon_raise() returns 0 and leaves
// dispatched_at SET on an already-open key that has not escalated, so with any divergence standing
// open, a NEW one only rewrote the open alert's payload — no dispatch, no GitHub issue, nobody
// told. Measured 2026-08-31: the three standing divergences were all COMMENT-ONLY (rationale
// written into the file after the migration was applied — an ordinary workflow that will recur),
// and they were occupying the key that the dark-detector shape this barrier exists for would need.
//
// Only WHOLE-LINE comments are stripped. A line starting with `--` cannot be executable SQL; a
// trailing `-- ...` on a code line is deliberately kept, so real SQL can never be reclassified as
// a comment. Must stay byte-symmetric with ops_migration_content_digests().code_md5 — the
// 2026-08-30 asymmetric-normalisation class (issue #1357) is what happens when the two sides drift.
export function stripSqlCommentsAndBlanks(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*--/.test(l))
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n');
}

export type AppliedDigest = { version: string; name: string; md5: string; codeMd5?: string };
export type RepoMigrationContent = {
  version: string;
  name: string;
  file: string;
  md5: string;
  codeMd5?: string;
};
// 'code' — the executable SQL differs: the dangerous class (SQL, or a detector registration,
//          living only in git or only in production). Always P1.
// 'comments' — only whole-line comments/blank lines differ: benign, and separately keyed so it can
//          never suppress a 'code' finding.
export type DivergenceKind = 'code' | 'comments';
export type ContentDivergence = {
  file: string;
  version: string;
  matchedBy: 'version' | 'name';
  appliedVersion: string;
  repoMd5: string;
  appliedMd5: string;
  kind: DivergenceKind;
};

// FAILS CLOSED. A divergence is only ever downgraded to 'comments' on positive proof that both
// code digests are present AND equal. A missing digest on either side (an older server that does
// not return code_md5 yet, a rollback, a malformed payload) classifies as 'code' — the class that
// alerts at P1 — rather than silently reading as benign.
export function classifyDivergence(repoCodeMd5?: string, appliedCodeMd5?: string): DivergenceKind {
  if (!repoCodeMd5 || !appliedCodeMd5) return 'code';
  return repoCodeMd5 === appliedCodeMd5 ? 'comments' : 'code';
}

// #5: committed files whose content differs from the statements production actually executed.
//
// Matching mirrors findCommittedNotApplied's version-OR-name rule so the two stay symmetric: a file
// is compared against its own version when prod has it, and otherwise against the row carrying its
// NAME. That name fallback is not a nicety — the 5 files whose hand-authored timestamp never matched
// how they were applied (the class commit 6ef5e79 was fixing) are reachable ONLY by name, and they
// are precisely the ones most likely to have drifted. A name that is ambiguous in prod (>1 row) is
// skipped rather than guessed.
export function findContentDivergence(
  repoFiles: RepoMigrationContent[],
  appliedDigests: AppliedDigest[],
  baselineVersions: Iterable<string> = [],
  baseline: string = STRICT_ERA_BASELINE,
): ContentDivergence[] {
  const exempt = baselineVersions instanceof Set ? baselineVersions : new Set(baselineVersions);
  const byVersion = new Map<string, AppliedDigest>();
  const byName = new Map<string, AppliedDigest[]>();
  for (const d of appliedDigests) {
    byVersion.set(d.version, d);
    (byName.get(d.name) ?? byName.set(d.name, []).get(d.name)!).push(d);
  }

  const out: ContentDivergence[] = [];
  for (const f of repoFiles) {
    if (!/^[0-9]{14}$/.test(f.version)) continue; // only true timestamp versions
    if (f.version <= baseline) continue;          // grandfather the pre-strict-era files
    if (exempt.has(f.version)) continue;          // known, enumerated debt — the ratchet floor

    let applied = byVersion.get(f.version);
    let matchedBy: 'version' | 'name' = 'version';
    if (!applied) {
      const named = byName.get(f.name) ?? [];
      if (named.length !== 1) continue; // never applied (condition #2's job) or ambiguous — not ours
      applied = named[0];
      matchedBy = 'name';
    }
    if (applied.md5 === f.md5) continue;
    out.push({
      file: f.file,
      version: f.version,
      matchedBy,
      appliedVersion: applied.version,
      repoMd5: f.md5,
      appliedMd5: applied.md5,
      kind: classifyDivergence(f.codeMd5, applied.codeMd5),
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
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
