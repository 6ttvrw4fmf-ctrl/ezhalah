// A BARRIER SPLIT INTO AN OFFLINE HALF AND A LIVE HALF MUST NOT BE ABLE TO DECAY INTO A DELETION.
// Routine #10, ops_incident #104, 2026-09-06.
//
// THE CLASS THIS EXISTS FOR. Several barriers were one file doing two incompatible jobs: a hermetic
// predicate with mutation proofs, and a live read of production. Keeping the live read inside the
// REQUIRED `npm test` made unrelated PRs fail on production's state — measured the same morning, one
// such check went RED, GREEN on immediate re-run, then RED again on a single unchanged commit, and
// another went red because a platform went live between two runs. The repair is to split them.
//
// But a split is a dangerous shape, because "moved to a workflow" and "quietly deleted" are
// indistinguishable from inside the suite: both look like a check that stopped failing. This file is
// what makes them distinguishable, and it does it by EXECUTION rather than by reading source text —
// the distinction that matters, because all five of the blind guards found on 2026-09-04 named their
// function and never ran it.
//
// TWO JOBS:
//   1. MUTATION-PROVE liveHalfProblems() itself, in both directions. The rule that guards every
//      split is exactly the rule most likely to be trusted without ever being watched to fail.
//   2. DISCOVER every offline/live pair by shape — `verify-X.ts` with a `verify-X-live.ts` sibling —
//      and run the real rule over each. Discovery, not a list: a pair created tomorrow is covered
//      without anyone remembering to register it, which is the same principle scripts/lib/
//      testRegistry.ts already applies to the suite as a whole.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, npmTestRuns } from './lib/testRegistry.ts';
import { liveHalfProblems, type RegistryLike } from './lib/liveHalf.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nEvery split barrier can still prove its live half runs somewhere\n');

// ── JOB 2 — discover the pairs by shape and run the REAL rule over each ─────────────────────────
const registry = loadRegistry(ROOT);
const scripts = readdirSync(join(ROOT, 'scripts'));
const liveNames = scripts.filter((f) => /^verify-.+-live\.ts$/.test(f));
const pairs = liveNames
  .map((live) => ({ live, offline: live.replace(/-live\.ts$/, '.ts') }))
  .filter((p) => scripts.includes(p.offline));

check('at least one offline/live pair was discovered (the discovery itself is not vacuous)',
  pairs.length > 0,
  'no verify-X.ts / verify-X-live.ts pair found — if the split convention changed, this barrier is '
  + 'reading an empty set and would pass forever');

const realExists = (name: string) => existsSync(join(ROOT, 'scripts', name));
const realWorkflow = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

for (const { live, offline } of pairs) {
  const problems = liveHalfProblems(live, registry, realExists, realWorkflow);
  check(`${live} is homed in a workflow that actually invokes it`, problems.length === 0,
    problems.join('\n      '));
  // The other direction: the offline half must still be RUN by the required suite, or the split
  // moved the live half out and let the predicate follow it into the dark.
  check(`...and its offline half ${offline} still runs in npm test`,
    npmTestRuns(ROOT, offline.replace(/\.ts$/, '')),
    `${offline} is not discovered by the runner — the split lost the half that gates the diff`);
}

// ── JOB 1 — MUTATION PROOF of liveHalfProblems() itself ─────────────────────────────────────────
console.log('\n  mutation proof — the homing rule, against worlds where the live half is NOT running\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};

const NAME = 'verify-thing-live.ts';
const HOME = '.github/workflows/some-live-check.yml';
const homed: RegistryLike = { excluded: [{ name: NAME, where: HOME }] };
const invoking = `jobs:\n  x:\n    steps:\n      - run: node scripts/${NAME}\n`;
const exists = () => true;
const missing = () => false;

// M-1: the live half was DELETED rather than relocated — the failure mode the whole split risks.
mustCatch('the live half no longer exists on disk',
  liveHalfProblems(NAME, homed, missing, () => invoking).length > 0);
// M-2: relocated out of npm test but never declared — a check that runs nowhere and is counted by
// nobody, which is worse than one that does not exist.
mustCatch('no row in test-exclusions.txt (out of npm test, homed nowhere)',
  liveHalfProblems(NAME, { excluded: [] }, exists, () => invoking).length > 0);
// M-3: a row whose home is empty.
mustCatch('a declared row with an EMPTY home',
  liveHalfProblems(NAME, { excluded: [{ name: NAME, where: '' }] }, exists, () => invoking).length > 0);
// M-4: 'manual / live run' is an intention, not a trigger. A live half split out of the REQUIRED
// suite must land somewhere that fires on its own, or the split silently retired it.
mustCatch('a home of "manual / live run" — an intention nothing keeps',
  liveHalfProblems(NAME, { excluded: [{ name: NAME, where: 'manual / live run' }] }, exists, () => invoking).length > 0);
// M-5: the named workflow does not exist.
mustCatch('a home naming a workflow file that cannot be read',
  liveHalfProblems(NAME, homed, exists, () => null).length > 0);
// M-6: THE 2026-09-03 SHAPE, and the reason workflowInvokes() strips comments before matching — two
// checks were "homed" by a workflow COMMENT saying they were deliberately NOT run there, and neither
// had executed anywhere for weeks. A bare src.includes(name) passes this input; the real rule must not.
mustCatch('THE 2026-09-03 SHAPE: the workflow only MENTIONS the check, in a comment saying it is not run',
  liveHalfProblems(NAME, homed, exists,
    () => `# we deliberately do NOT run scripts/${NAME} here\njobs:\n  x:\n    steps:\n      - run: echo hi\n`).length > 0);
// M-7: a workflow that runs something else entirely.
mustCatch('a home that runs a DIFFERENT check',
  liveHalfProblems(NAME, homed, exists,
    () => 'jobs:\n  x:\n    steps:\n      - run: node scripts/verify-something-else.ts\n').length > 0);

// ── THE NEGATIVE CONTROLS — a rule that is red for everything is as useless as one that is green ──
mustCatch('a genuinely homed and invoked live half is NOT reported as a problem',
  liveHalfProblems(NAME, homed, exists, () => invoking).length === 0);
mustCatch('...and it is still accepted when the workflow carries unrelated comments around it',
  liveHalfProblems(NAME, homed, exists,
    () => `# background: see docs\njobs:\n  x:\n    steps:\n      - name: run it\n        run: node scripts/${NAME}\n`).length === 0);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? `\n✅ ${pairs.length} split barrier(s) prove their live half still runs, and the rule that says so can fail.\n`
    : `\n❌ ${failed} check(s) failed — a split barrier cannot prove its live half runs.\n`,
);
process.exit(failed === 0 ? 0 : 1);
