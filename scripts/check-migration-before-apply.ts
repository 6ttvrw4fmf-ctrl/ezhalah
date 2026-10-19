// RUN THE CITATION CHECK BEFORE apply_migration, NOT AFTER.
//
// THE GAP THIS CLOSES. verify-migration-references-resolve.ts already owns the predicate: every
// `20\d{12}` a migration cites must be a version some committed migration declares. But it only ever
// sees COMMITTED files, so it speaks for the first time in CI — after the SQL has been applied to
// production. By then neither option is free:
//
//   * correcting the pointer makes the file disagree with what production executed, which
//     manufactures content-parity drift (condition #5) on a file that is otherwise clean;
//   * keeping it costs a line in migration-reference-baseline.txt and a bump to MAX_BASELINE_ENTRIES,
//     a ratchet whose own header says it may only shrink.
//
// That is why the baseline stands at 31 with two entries admitted purely because parity is mandatory
// and the pointer is not repairable. Both were authored, applied, and only then read.
//
// THE SHAPE OF THE MISTAKE. `apply_migration` MINTS the version. So at authoring time a migration
// cannot know its own, and any 14-digit number written for "this migration" is a guess. Measured by
// the session that hit it: twice in one evening, four hours apart, by the same author — the second
// time after being caught by the first, writing the fix-up, recording a permanent note, and telling
// two other sessions "mint the version you cite, or cite nothing". Knowing the failure mode, having
// just paid for it, and having written it down did not prevent the repeat. The two instances differed
// in cost by one thing only, and it was not care: the first was found post-apply, the second
// pre-push. Same mistake, same author, same day — one was cheap because a check ran earlier.
//
// SO THIS ADDS NO PREDICATE. It imports danglingCitations() from the barrier and runs it one step
// earlier, against SQL that is still only text. A check that sits after the point of no return is
// not a check (AGENTS.md: a guard after the point of no return is not a guard).
//
// HOW IT DIFFERS FROM THE CI BARRIER, deliberately:
//   1. The candidate contributes its SQL but NOT a version, because it does not have one yet. So a
//      migration citing the timestamp it HOPES to be applied under is reported — that is the defect,
//      not a false positive.
//   2. migration-reference-baseline.txt is NOT honoured. It grandfathers history; newly authored SQL
//      may never draw on it. The barrier's own header: "No newly authored migration may use this."
//
// USE, before calling apply_migration:
//   node --experimental-strip-types scripts/check-migration-before-apply.ts path/to/new.sql
//   node --experimental-strip-types scripts/check-migration-before-apply.ts --self-test
//
// Exit 0 = safe to apply. Exit 1 = a citation resolves to nothing; fix it BEFORE applying.
// Named check-* rather than verify-* on purpose: it takes an argument, so it must not be picked up by
// the npm test discovery glob (/^verify-.*\.(ts|mjs)$/ in scripts/lib/testRegistry.ts).
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { danglingCitations, readMigrations,
         type SqlFile } from './lib/migrationCitations.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

const committed = (): SqlFile[] => readMigrations(MIGRATIONS_DIR);

// The candidate is labelled so that declaredVersion() inside the predicate finds no `^\d{8,14}_`
// prefix and it therefore contributes NO version. This is the whole trick: an unapplied migration
// declares nothing, so citing the version it expects to get cannot resolve.
const CANDIDATE = 'CANDIDATE (not yet applied): ';

/** Dangling citations attributable to the candidate SQL. THE ONE DECISION. */
export const danglingInCandidate = (
  candidateSql: string,
  label: string,
  corpus: SqlFile[],
): string[] => {
  const tagged = `${CANDIDATE}${label}`;
  const all = danglingCitations([...corpus, { file: tagged, sql: candidateSql }]);
  return [...all.entries()]
    .filter(([, where]) => where.includes(tagged))
    .map(([version]) => version)
    .sort();
};

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
// One runnable check, in both directions, over a synthetic corpus — so this file's own claim is
// executed rather than asserted. `--self-test` touches no real migration.
if (process.argv.includes('--self-test')) {
  const CORPUS: SqlFile[] = [{ file: '20260101000000_real.sql', sql: 'select 1;' }];
  const cases: [string, boolean][] = [
    // Cites a migration that exists -> clean.
    ['-- see 20260101000000 for why\nselect 1;', false],
    // Cites a version nobody declares -> reported.
    ['-- completes 20260999999999\nselect 1;', true],
    // The real-world shape: a hand-picked timestamp for THIS migration, which apply_migration has
    // not minted yet. The CI barrier cannot see this until the file is committed; this must.
    [`comment on table t is 'set by migration 20260928014300';`, true],
    // The `<version>_<name>` spelling, the blind spot the barrier shipped with.
    ['-- follow-up to 20260999999999_never_existed\nselect 1;', true],
    // A citation inside a comment still counts: the reader it misleads is reading the comment.
    ['-- apply 20260999999999 first\nselect 1;', true],
    // No citation at all -> clean ("cite nothing" is always a valid answer).
    ['select 1;', false],
  ];
  let bad = 0;
  for (const [sql, shouldFlag] of cases) {
    const got = danglingInCandidate(sql, 'self-test.sql', CORPUS).length > 0;
    const ok = got === shouldFlag;
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${shouldFlag ? 'flags' : 'allows'}: ${sql.split('\n')[0]}`);
  }
  // The predicate must also stay usable on the REAL corpus, or this tool is green by being blind.
  const real = committed();
  if (real.length < 100) { console.error(`  FAIL  only ${real.length} migrations read`); bad++; }
  else console.log(`  PASS  reads the real corpus (${real.length} migrations)`);
  console.log(bad === 0
    ? '\n✅ check-migration-before-apply: self-test passed.'
    : `\n❌ check-migration-before-apply: ${bad} self-test case(s) failed.`);
  process.exit(bad === 0 ? 0 : 1);
}

const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (paths.length === 0) {
  console.error('usage: check-migration-before-apply.ts <new-migration.sql> [...]  |  --self-test');
  process.exit(2);
}

const corpus = committed();
let failed = 0;
for (const p of paths) {
  if (!existsSync(p)) { console.error(`  ✗ ${p}: no such file`); failed++; continue; }
  const bad = danglingInCandidate(readFileSync(p, 'utf8'), basename(p), corpus);
  if (bad.length === 0) {
    console.log(`  ✓ ${basename(p)}: every migration it cites is one this tree has`);
    continue;
  }
  failed++;
  console.error(
    `  ✗ ${basename(p)}: cites ${bad.length} version(s) that resolve to nothing — ${bad.join(', ')}\n` +
    `      apply_migration MINTS the version, so a timestamp written for THIS migration cannot\n` +
    `      resolve yet. Mint the version you cite, or cite nothing. Fix it BEFORE applying: once\n` +
    `      applied, correcting the text re-opens content-parity drift and keeping it costs a\n` +
    `      migration-reference-baseline.txt entry, a ratchet that may only shrink.`,
  );
}

console.log(failed === 0
  ? `\n✅ check-migration-before-apply: ${paths.length} file(s) safe to apply.`
  : `\n❌ check-migration-before-apply: ${failed} of ${paths.length} file(s) must be fixed before applying.`);
process.exit(failed === 0 ? 0 : 1);
