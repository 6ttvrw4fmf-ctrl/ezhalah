// WHAT `npm test` RUNS — one definition, derived from the filesystem, used by everything.
//
// WHY THIS EXISTS (owner-approved 2026-08-28)
// ------------------------------------------
// `package.json`'s "test" was a single 201-command `&&` chain on ONE line. Every engineer routine
// that adds a barrier had to edit that exact line, so any two sessions adding a barrier in the same
// window produced a git conflict — not occasionally, but essentially always. PR #1196 took FIVE
// conflict/rebase rounds to land, and #1177 three; in this repo the CI cycle is longer than the
// interval between merges to main, so a session can lose that race repeatedly. Each round is pure
// waste: the conflict is never a real disagreement, just two additions to one line.
//
// The fix removes the shared line entirely rather than shortening it. A test file is run BECAUSE IT
// EXISTS. Adding a barrier is now: create `scripts/verify-my-thing.ts`. No shared file is touched,
// so there is nothing to conflict over.
//
// THE TWO RULES THAT MAKE THAT SAFE
//
//   1. DISCOVERY IS THE DEFAULT, AND IT FAILS CLOSED. Every `scripts/verify-*.{ts,mjs}` runs unless
//      it is listed in `test-exclusions.txt` WITH a reason and a place it does run instead. A new
//      file that nobody thought about RUNS — the failure mode is a loud red, never a barrier that
//      silently never executes. That is the direction this repo has been burned by before: nine
//      "dark" detectors reading as a clean bill of health (AGENTS.md).
//
//   2. THE BASELINE IS A FLOOR, NOT A LIST. `test-baseline.txt` records the 201 scripts the old
//      chain ran. Every one of them must still be discovered and run. Deleting a test therefore
//      takes a deliberate, reviewed edit to the baseline — it cannot happen as a side effect of a
//      rename, a bad glob, or a merge resolution. Adding a test needs no baseline edit at all.
//
// ORDER is the sorted filename order, so a run is reproducible and a diff of two runs is readable.
// No current check declares an ordering dependency — they are independent verifiers that read files
// and exit. If one ever genuinely needs to run after another, that dependency must be made explicit
// here rather than smuggled in as "it happened to be earlier in the chain".

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type Exclusion = { name: string; reason: string; where: string };
export type Registry = { run: string[]; excluded: Exclusion[]; baseline: string[] };

const TEST_FILE = /^verify-.*\.(ts|mjs)$/;

/** Parse `scripts/test-exclusions.txt`: `name | where | reason`, `#` comments, blank lines ignored. */
export function parseExclusions(text: string): Exclusion[] {
  const out: Exclusion[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [name, where, ...rest] = line.split('|').map((s) => s.trim());
    out.push({ name, where: where ?? '', reason: rest.join('|').trim() });
  }
  return out;
}

export function parseBaseline(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

export function loadRegistry(root: string): Registry {
  const scriptsDir = join(root, 'scripts');
  const all = readdirSync(scriptsDir).filter((f) => TEST_FILE.test(f)).sort();
  const exPath = join(scriptsDir, 'test-exclusions.txt');
  const excluded = existsSync(exPath) ? parseExclusions(readFileSync(exPath, 'utf8')) : [];
  const exNames = new Set(excluded.map((e) => e.name));
  const blPath = join(scriptsDir, 'test-baseline.txt');
  const baseline = existsSync(blPath) ? parseBaseline(readFileSync(blPath, 'utf8')) : [];
  return { run: all.filter((f) => !exNames.has(f)), excluded, baseline };
}

/** The node invocation for one test file — .ts needs type stripping, .mjs does not. */
export function argvFor(file: string): string[] {
  return file.endsWith('.ts')
    ? ['--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', `scripts/${file}`]
    : [`scripts/${file}`];
}

/**
 * Does `npm test` run this check? THE question the old guards answered by string-matching the mega
 * line (`pkg.scripts.test.includes('scripts/x.ts')`). They must ask it here instead, or they would
 * all read "no" the moment the chain became a single runner invocation.
 */
export function npmTestRuns(root: string, name: string): boolean {
  const { run } = loadRegistry(root);
  // Callers hold the name in every shape the old string-match tolerated: 'verify-x',
  // 'verify-x.ts', 'scripts/verify-x.ts'. Normalise rather than make each call site remember,
  // because a call site that gets the shape wrong reads as "this check does not run" — a false
  // alarm on a guard whose entire job is to notice a check that stopped running.
  const bare = name.replace(/^scripts\//, '').replace(/\.(ts|mjs)$/, '');
  return run.includes(`${bare}.ts`) || run.includes(`${bare}.mjs`);
}
