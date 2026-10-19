// THE MIGRATION-CITATION PREDICATE — one copy, two callers.
//
// Extracted from verify-migration-references-resolve.ts so it can also run BEFORE apply_migration
// (scripts/check-migration-before-apply.ts). The barrier is a script: it measures the tree and calls
// process.exit, so importing it to reuse the predicate would run the whole check and exit the caller.
// Shared predicates live here, next to stripComments.ts / migrationDrift.ts / testRegistry.ts.
//
// Behaviour is unchanged and stays mutation-proven in the barrier, which owns the corpus measurement,
// the baseline ratchet and the proofs. This file owns only the decision.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type SqlFile = { file: string; sql: string };

/**
 * 14-digit literals that are NOT citations of a migration. Each needs a reason, because the whole
 * value of this check is that an unexplained number is a broken pointer.
 *
 *  - 20260815000000 is STRICT_ERA_BASELINE (scripts/lib/migrationDrift.ts, pinned in AGENTS.md):
 *    the cutoff below which committed-not-applied / duplicate-version / content-parity are
 *    grandfathered. It is a boundary constant and no migration will ever carry it.
 */
const CONSTANTS = new Set<string>(['20260815000000']);

/**
 * A version literal, bounded by DIGITS only — never `\b`.
 *
 * `\b20\d{12}\b` is the obvious spelling and it is WRONG, proven by planting the mutant: the most
 * natural way to cite a migration is the way the filename spells it,
 * `20260920075900_correct_the_stated_reason_for_the_unindexed_duration_clock`, and `_` is a word
 * character — so `\b` does not match after the digits and the whole citation is invisible. A first
 * cut of this check shipped that regex, passed all five of its own synthetic mutation proofs (every
 * one of which happened to use a BARE number), and then stayed GREEN when a real dangling
 * `20260922050000_a_migration_that_never_existed` was appended to a real migration in this tree.
 * That is AGENTS.md's ops_incident #391 shape applied to this file's own proof: a mutation planted
 * inside the population the predicate could already see proves the predicate and nothing about its
 * coverage. Measured: EIGHT baselined entries are cited ONLY in the `<version>_<name>` form and
 * have zero bare occurrences anywhere in the tree — `\b` could not see one of them.
 */
const VERSION_TOKEN = /(?<!\d)20\d{12}(?!\d)/g;

/** The version prefix a migration file declares, e.g. `20260921185629_eleven_platforms.sql`. */
const declaredVersion = (file: string): string | null => {
  const m = /^(\d{8,14})_/.exec(file);
  return m ? m[1] : null;
};

/**
 * Versions this corpus actually carries. A citation resolves against the file NAME, which is what a
 * reader greps — deliberately not against production, so the check stays hermetic and can sit in
 * `npm test` on every PR (AGENTS.md, "the required suite is HERMETIC").
 */
const declaredVersions = (files: SqlFile[]): Set<string> => {
  const out = new Set<string>();
  for (const { file } of files) {
    const v = declaredVersion(file);
    if (v) out.add(v);
  }
  return out;
};

/** Every cited version that no file in the corpus declares. THE PREDICATE. */
const danglingCitationsImpl = (files: SqlFile[]): Map<string, string[]> => {
  const declared = declaredVersions(files);
  const out = new Map<string, string[]>();
  for (const { file, sql } of files) {
    for (const tok of sql.match(VERSION_TOKEN) ?? []) {
      if (declared.has(tok) || CONSTANTS.has(tok)) continue;
      const where = out.get(tok) ?? [];
      if (!where.includes(file)) where.push(file);
      out.set(tok, where);
    }
  }
  return out;
};


/** Every committed migration, sorted — the corpus both callers resolve citations against. */
export const readMigrations = (migrationsDir: string): SqlFile[] =>
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), 'utf8') }));

export { VERSION_TOKEN };

export const danglingCitations = danglingCitationsImpl;
