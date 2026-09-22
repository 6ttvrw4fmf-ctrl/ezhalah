// A MIGRATION MAY NOT CITE A MIGRATION THAT DOES NOT EXIST (routine #2, 2026-09-22).
//
// WHY THIS EXISTS
// ---------------
// Committed SQL cites other migrations constantly — "see 20260912010600 for why", "completes
// 20260921163024", "apply 20260921180000 first". 382 of the 411 such citations in this tree resolve
// to a real committed migration. Twenty-nine did not, and three of those are not prose at all:
//
//     raise exception 'table % does not exist - apply 20260921180000 first', r.tbl;
//     RAISE EXCEPTION 'table % does not exist - apply 20260921180000 first', t;
//     raise exception 'listing_native_location_v1 was replayed WITHOUT the eleven arms
//                      - apply 20260921180100 first';
//
// Those are the guards in the eleven-platform migrations (20260921185629 … 191349). They fire on a
// REPLAY against a database that lacks the tables — a fresh Supabase branch, or a rebuild — and at
// that moment they instruct the operator to apply 20260921180000, which exists neither in this repo
// nor in supabase_migrations.schema_migrations. Dead-end guidance at the one moment someone is
// following it literally. This is AGENTS.md's own "a pointer reads as coverage" shape (BARRIER_
// ENGINEER PART 1.11), in the layer that survives longest: a number, written down, that nothing
// ever dereferenced.
//
// WHY NOTHING SAW IT. Every migration-drift condition compares a migration against PRODUCTION —
// its version, its name, its function signatures, its text. Not one of them reads a migration's
// citations, because a citation is not a schema object: the eleven-platform files are byte-exact
// with what production executed, so drift conditions #1-#5 are all green on them and always were.
// The defect is entirely INSIDE the repo, which is why the check is entirely offline.
//
// WHAT THIS CHECKS. Every `20\d{12}` token appearing in supabase/migrations/*.sql must be the
// version prefix of some committed migration file — unless it is a declared CONSTANT (below) or
// carries a line in scripts/migration-reference-baseline.txt, which is a FLOOR that may only shrink.
//
// COMMENTS ARE NOT STRIPPED, deliberately and unlike verify-committed-sql-defines-what-it-calls.ts.
// A false citation in a comment is the defect, not an exemption from it: the reader it misleads is
// reading the comment. Measured: 25 of the 29 baselined entries are comment-only; only four survive
// comment-stripping (20260803194308, 20260912010600, 20260921180000, 20260921180100). A check that
// stripped comments first would therefore be blind to seven-eighths of this class.
//
// WHY THE EXISTING ENTRIES ARE BASELINED AND NOT REPAIRED: editing a committed migration's text to
// correct a pointer would make it disagree with what production executed, i.e. it would manufacture
// content-parity drift (condition #5) on files that are clean today. The history stays as it ran.
// What this check buys is that the NEXT one cannot merge.
//
//   node --experimental-strip-types scripts/verify-migration-references-resolve.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const BASELINE_FILE = join(ROOT, 'scripts', 'migration-reference-baseline.txt');

/** The floor may only shrink. Lowering it means a dangling citation was genuinely repaired. */
const MAX_BASELINE_ENTRIES = 29;

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

type SqlFile = { file: string; sql: string };

const readMigrations = (): SqlFile[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }));

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
export const danglingCitations = (files: SqlFile[]): Map<string, string[]> => {
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

let failed = 0;
const check = (ok: boolean, pass: string, fail: string) => {
  if (ok) console.log(`  ✓ ${pass}`);
  else { console.error(`  ✗ ${fail}`); failed++; }
};

// ── 1. MEASURE THE REAL CORPUS ────────────────────────────────────────────────────────────────
const files = readMigrations();
const dangling = danglingCitations(files);
const baseline = new Set(
  readFileSync(BASELINE_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')),
);

const totalCitations = new Set(
  files.flatMap(({ sql }) => sql.match(VERSION_TOKEN) ?? []),
).size;
console.log(
  `migration citations: ${totalCitations} distinct versions cited across ${files.length} files; ` +
  `${dangling.size} resolve to nothing (baseline ${baseline.size}).`,
);

// ── 2. NO NEW DANGLING CITATION ───────────────────────────────────────────────────────────────
const unbaselined = [...dangling.keys()].filter((v) => !baseline.has(v)).sort();
check(unbaselined.length === 0,
  'every dangling citation is a known, baselined one',
  `NEW dangling migration citation(s) — these name a migration no committed file carries:\n` +
  unbaselined.map((v) => `      ${v}  cited by ${dangling.get(v)!.join(', ')}`).join('\n') +
  `\n    Cite the version the migration was ACTUALLY applied under (apply_migration mints it; it is\n` +
  `    in supabase_migrations.schema_migrations), not a hand-picked timestamp. Do NOT baseline it.`);

// ── 3. THE RATCHET ────────────────────────────────────────────────────────────────────────────
check(baseline.size <= MAX_BASELINE_ENTRIES,
  `baseline holds ${baseline.size} entries (floor ${MAX_BASELINE_ENTRIES}, may only shrink)`,
  `baseline GREW to ${baseline.size}. A new dangling citation must be CORRECTED, not baselined.`);

const stale = [...baseline].filter((v) => !dangling.has(v)).sort();
check(stale.length === 0,
  'every baseline entry is still genuinely dangling',
  `these now resolve and their baseline lines must be DELETED (and MAX_BASELINE_ENTRIES lowered): ` +
  stale.join(', '));

// ── MUTATION PROOF ────────────────────────────────────────────────────────────────────────────
// Executed against the predicate, not asserted about it — AGENTS.md: a source-TEXT tripwire passed
// for the entire time each of the 2026-09-04 defects was live.
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The real defect, on the real corpus: the eleven-platform replay guard names a migration that has
// never existed in git or in production.
mustCatch('the eleven-platform RAISE EXCEPTION citing 20260921180000, which exists nowhere',
  dangling.has('20260921180000') &&
  dangling.get('20260921180000')!.some((f) => f.includes('eleven_platforms_wiring_into_search')));

// A citation of a migration the corpus really carries must stay silent, or this check is a constant
// red that someone will eventually delete.
const RESOLVES: SqlFile[] = [
  { file: '20260101000000_target.sql', sql: 'select 1;' },
  { file: '20260102000000_citer.sql', sql: '-- see 20260101000000 for why\nselect 2;' },
];
mustCatch('a resolvable citation being reported as dangling (false positive)',
  !danglingCitations(RESOLVES).has('20260101000000'));

// The same corpus with the cited migration removed: the citation must go red.
mustCatch('a citation whose target migration is absent from the corpus',
  danglingCitations(RESOLVES.slice(1)).has('20260101000000'));

// A dangling citation inside a COMMENT must count. Twenty-six of the twenty-nine baselined entries are
// comment-only, and stripping comments — which the sibling check does for its own good reasons —
// would have made this check blind to almost the entire class it was built for.
const COMMENT_ONLY: SqlFile[] = [
  { file: '20260102000000_citer.sql', sql: '-- completes 20260101999999; see it for the reasoning\nselect 1;' },
];
mustCatch('a dangling citation that appears only inside a comment',
  danglingCitations(COMMENT_ONLY).has('20260101999999'));

// THE BLIND SPOT THIS CHECK SHIPPED WITH, pinned so it cannot come back. A citation spelled the way
// the filename spells it is the common case, and `\b20\d{12}\b` matches none of it. This is the one
// mutation that the first cut survived on the real corpus.
const UNDERSCORE_FORM: SqlFile[] = [
  { file: '20260102000000_citer.sql', sql: '-- follow-up to 20260101999999_a_migration_that_never_existed\nselect 1;' },
];
mustCatch('a dangling citation written as `<version>_<name>` (the `\\b` blind spot)',
  danglingCitations(UNDERSCORE_FORM).has('20260101999999'));

// A file citing ITSELF resolves — the duration-clock migration (20260920080113) does exactly this,
// and a check that flagged self-citation would cry wolf on a correct file.
const SELF: SqlFile[] = [
  { file: '20260101000000_self.sql', sql: "comment on table t is 'see 20260101000000';" },
];
mustCatch('a self-citation being reported as dangling (false positive)',
  !danglingCitations(SELF).has('20260101000000'));

console.log(failed === 0
  ? '\n✅ verify-migration-references-resolve: every migration this tree cites is a migration this tree has.'
  : `\n❌ verify-migration-references-resolve: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
