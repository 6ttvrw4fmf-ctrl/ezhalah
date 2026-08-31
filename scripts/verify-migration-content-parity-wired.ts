// DRIFT CONDITION #5 must stay wired, and its baseline must only ever shrink.
// Routine #7 (Daily Systems Seam Engineer), 2026-08-30. Offline, deterministic, in `npm test`.
//
// Conditions #1–#4 compare identifiers only; #5 is the one that reads what a migration file
// actually SAYS (see scripts/verify-migration-content-parity.ts's header for the 75-of-269
// measurement that motivated it). This is its merge-time half: it proves the pure logic still
// behaves, mutation-proves that logic, and pins the three pieces that have to keep pointing at each
// other — the live check, the workflow that runs it, and the exclusion entry that keeps it OUT of
// `npm test`. A refactor that renames or unhooks any one of them would otherwise silently disable
// the whole condition while every file still LOOKS present.
//
// Run: node --experimental-strip-types scripts/verify-migration-content-parity-wired.ts
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { npmTestRuns } from './lib/testRegistry.ts';
import { findContentDivergence, normalizeMigrationSql, STRICT_ERA_BASELINE } from './lib/migrationDrift.ts';
import { digestOf, readBaseline, BASELINE_FILE } from './verify-migration-content-parity.ts';

const ROOT = join(import.meta.dirname, '..');
const LIVE_CHECK = 'scripts/verify-migration-content-parity.ts';
const WORKFLOW = '.github/workflows/migration-drift-guard.yml';
const EXCLUSIONS = 'scripts/test-exclusions.txt';
const MIGRATION = 'supabase/migrations/20260830022719_migration_content_parity_condition_five_and_heartbeat.sql';

// THE RATCHET. 75 files already disagreed with production when this barrier was created; they are
// enumerated in the baseline as known debt. The baseline is a FLOOR: reconciling a file means
// DELETING its line, so this number may only go DOWN. Raising it takes a deliberate edit here, in a
// reviewed diff — which is precisely what stops a new divergence from being silenced by appending
// to a text file. Same shape as scripts/test-baseline.txt.
const MAX_BASELINE_ENTRIES = 75;

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ── 1. Every piece exists ─────────────────────────────────────────────────────────────────────
for (const f of [LIVE_CHECK, WORKFLOW, EXCLUSIONS, MIGRATION, 'scripts/migration-content-parity-baseline.txt']) {
  check(existsSync(join(ROOT, f)), `${f} exists`, `${f} is missing — condition #5 has a dead link`);
}

// ── 2. The live check runs in the workflow, and NOT in `npm test` ─────────────────────────────
const wf = existsSync(join(ROOT, WORKFLOW)) ? readFileSync(join(ROOT, WORKFLOW), 'utf8') : '';
check(
  wf.includes('verify-migration-content-parity.ts'),
  `${WORKFLOW} invokes the content-parity check`,
  `${WORKFLOW} no longer invokes verify-migration-content-parity.ts — condition #5 runs nowhere`,
);
// Never string-match package.json for wiring (the registry guard rejects that pattern outright);
// ask the registry, which is the actual source of truth for what `npm test` runs.
check(
  !npmTestRuns(ROOT, 'verify-migration-content-parity'),
  'the live check is correctly excluded from `npm test`',
  'the live content-parity check is running inside `npm test` — production divergence would fail every unrelated PR',
);
check(
  npmTestRuns(ROOT, 'verify-migration-content-parity-wired'),
  'this offline barrier itself runs in `npm test`',
  'this barrier is not discovered by `npm test` — it protects nothing',
);
const exclusions = existsSync(join(ROOT, EXCLUSIONS)) ? readFileSync(join(ROOT, EXCLUSIONS), 'utf8') : '';
const exclusionLine = exclusions
  .split('\n')
  .find((l) => l.trim().startsWith('verify-migration-content-parity.ts'));
check(
  !!exclusionLine && exclusionLine.includes('migration-drift-guard.yml'),
  'the exclusion entry names migration-drift-guard.yml as its real home',
  'verify-migration-content-parity.ts has no exclusion entry naming where it DOES run',
);

// ── 3. The ratchet ────────────────────────────────────────────────────────────────────────────
const baseline = readBaseline(BASELINE_FILE);
check(
  baseline.size <= MAX_BASELINE_ENTRIES,
  `baseline holds ${baseline.size} entries (floor ${MAX_BASELINE_ENTRIES}, may only shrink)`,
  `baseline GREW to ${baseline.size} entries (max ${MAX_BASELINE_ENTRIES}). A new divergence must be FIXED, not baselined.`,
);
check(
  [...baseline].every((v) => /^[0-9]{14}$/.test(v)),
  'every baseline entry is a 14-digit version',
  'a baseline entry is not a 14-digit version — it would silence nothing and hide a real file',
);

// ── 4. The digest must be computed the same way on both sides ─────────────────────────────────
// The server does left(md5(regexp_replace(array_to_string(statements, E'\n'), '\s+$', '')), 10) —
// it normalizes trailing whitespace too, since 2026-08-30 closed the asymmetric-normalization
// false-positive class (issue #1357). digestOf must be md5 of the
// trailing-whitespace-stripped text, truncated to 10. If these ever diverge, EVERY file reads as
// divergent and the check gets disabled as noise — so pin the exact contract with a known vector.
check(digestOf('select 1;') === digestOf('select 1;\n\n  '), 'digestOf ignores trailing whitespace', 'digestOf is sensitive to trailing whitespace — a faithful mirror would read as diverged');
check(digestOf('select 1;') !== digestOf('select 2;'), 'digestOf distinguishes different SQL', 'digestOf collides on different SQL');
check(/^[0-9a-f]{10}$/.test(digestOf('select 1;')), 'digestOf returns the server-matching 10-hex-char prefix', 'digestOf does not return a 10-hex-char md5 prefix — it cannot match the server');
check(normalizeMigrationSql('a\n\n') === 'a', 'normalizeMigrationSql strips only trailing whitespace', 'normalizeMigrationSql no longer strips exactly trailing whitespace');
check(normalizeMigrationSql('  a  b') === '  a  b', 'normalizeMigrationSql leaves interior and leading text alone', 'normalizeMigrationSql is mutating more than trailing whitespace');

// ── 5. The pure logic, and its MUTATION PROOF ─────────────────────────────────────────────────
const V = '20260901000000'; // strict era
const repo = [{ version: V, name: 'thing', file: `${V}_thing.sql`, md5: 'aaaaaaaaaa' }];
const same = [{ version: V, name: 'thing', md5: 'aaaaaaaaaa' }];
const differs = [{ version: V, name: 'thing', md5: 'bbbbbbbbbb' }];

check(findContentDivergence(repo, same).length === 0, 'identical content → clean', 'identical content reported as diverged');
check(findContentDivergence(repo, differs).length === 1, 'different content → flagged', 'DIFFERENT CONTENT NOT FLAGGED — condition #5 is blind');
check(
  findContentDivergence(repo, differs, [V]).length === 0,
  'a baselined version is exempt',
  'the baseline does not exempt its entries',
);
// Never applied at all is condition #2's job, not this one — flagging it here would double-report.
check(
  findContentDivergence(repo, [{ version: '20260902000000', name: 'other', md5: 'cccccccccc' }]).length === 0,
  'a file never applied is left to condition #2',
  'condition #5 is double-reporting never-applied files',
);
// The name fallback is the load-bearing half: the files whose hand-authored timestamp never matched
// how they were applied are reachable ONLY by name, and are the likeliest to have drifted.
const byName = findContentDivergence(repo, [{ version: '20260902000000', name: 'thing', md5: 'bbbbbbbbbb' }]);
check(
  byName.length === 1 && byName[0].matchedBy === 'name' && byName[0].appliedVersion === '20260902000000',
  'a file applied under a different version is still compared, by name',
  'the name fallback is gone — hand-stamped mirrors escape the check entirely',
);
// An ambiguous name must be skipped, never guessed.
check(
  findContentDivergence(repo, [
    { version: '20260902000000', name: 'thing', md5: 'bbbbbbbbbb' },
    { version: '20260903000000', name: 'thing', md5: 'dddddddddd' },
  ]).length === 0,
  'an ambiguous name is skipped rather than guessed',
  'an ambiguous name is being guessed at',
);
// Pre-strict-era files stay grandfathered, exactly like conditions #2 and #3.
const legacy = [{ version: '20260101000000', name: 'old', file: '20260101000000_old.sql', md5: 'aaaaaaaaaa' }];
check(
  findContentDivergence(legacy, [{ version: '20260101000000', name: 'old', md5: 'zzzzzzzzzz' }]).length === 0,
  `pre-${STRICT_ERA_BASELINE} files are grandfathered`,
  'the strict-era baseline is not being honoured — legacy files would cry wolf forever',
);

// ── 6. The database half must still be registered on the roster ───────────────────────────────
const mig = existsSync(join(ROOT, MIGRATION)) ? readFileSync(join(ROOT, MIGRATION), 'utf8') : '';
check(
  mig.includes('mon_detect_migration_content_parity_stale') && mig.includes('mon_run_all_detectors'),
  'the detector is registered in mon_run_all_detectors in its own migration',
  'the detector migration no longer registers itself on the roster — a detector nothing reaches',
);
check(
  mig.includes('ops_migration_content_digests'),
  'the digests RPC ships in the same migration',
  'the digests RPC is missing — the live check has nothing to read',
);

for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length) {
  console.error(`\n✗ migration content-parity barrier is not intact:`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log(`\n✓ migration content-parity (drift condition #5) barrier intact — ${ok.length} checks passed.`);
