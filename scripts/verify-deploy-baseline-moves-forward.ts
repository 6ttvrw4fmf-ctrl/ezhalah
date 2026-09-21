// THE RECORDED PRODUCTION BASELINE MAY ONLY EVER MOVE FORWARD.
//
// Rationale and the predicate itself live in scripts/lib/baselineMonotonic.ts — read the header
// there first. This file EXECUTES that predicate three ways:
//
//   1. against a REAL git repository built in a sandbox, so the rule is proven against real
//      `git merge-base --is-ancestor` behaviour rather than against a hand-written stub;
//   2. as MUTATION PROOFS — a rewind, a diverged line, an unanswerable ancestry question and a
//      malformed sha must each be CAUGHT, and a genuine forward move must be let through. A guard
//      that cannot go red is decoration;
//   3. against THIS repository's own recorded history of docs/DEPLOY_BASELINE.txt, walking the last
//      few values the file actually held and asserting each move contained the one before it.
//
// (3) is what catches the live hazard: merging a stale `chore(deploy): record approved baseline …`
// PR writes a value that is an ANCESTOR of the current one, and this check goes red on that PR
// before it can lower the deploy floor. It needs no network and no production — it is a statement
// about this repo's own history, so it belongs in the hermetic required suite.
//
// It deliberately does NOT read `origin/main`. A remote ref is not guaranteed to be present in
// every checkout, and a guard that hard-fails whenever a ref is missing would fail unrelated PRs —
// the exact placement defect AGENTS.md records for four checks on 2026-09-06. The file's own commit
// history is always present wherever the history is, which with fetch-depth: 0 is everywhere CI
// runs it.
//
//   node --experimental-strip-types scripts/verify-deploy-baseline-moves-forward.ts

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineChainProblems, type BaselineStep, type AncestryOracle } from './lib/baselineMonotonic.ts';

const root = join(import.meta.dirname, '..');
const BASELINE = 'docs/DEPLOY_BASELINE.txt';
const CI_WORKFLOW = '.github/workflows/full-verification-ci.yml';

/**
 * Does this workflow check the repository out with FULL history? Read from the file, never assumed.
 *
 * `fetch-depth: 0` is what makes the chain assertion answerable at all, and it is the fact a shallow
 * local run leans on when it declines to ask. Every `actions/checkout` step in the file must carry
 * it: one step without it is one job where this guard would silently stop being able to answer.
 */
export function fullHistoryCheckout(src: string): boolean {
  const steps = src.split(/uses:\s*actions\/checkout/).slice(1);
  return steps.length > 0 && steps.every((s) => /^[^\n]*\n(?:[^\n]*\n){0,6}?\s*fetch-depth:\s*0\b/.test(s));
}
/** How many of the file's most recent recorded values to walk. Enough to span several deploys. */
const WALK = 8;

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

/**
 * A mutation proof: `caught` must be the RESULT of running this barrier's own predicate against a
 * deliberately broken input, never a literal. A guard that cannot be watched going red is prose.
 */
const mustCatch = (what: string, caught: boolean, detail = '') =>
  check(`MUTATION: ${what}`, caught, detail);

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8' }).trim();

/** Is this checkout SHALLOW — a truncated history that cannot answer an ancestry question? */
export const isShallow = (cwd: string): boolean =>
  spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd, encoding: 'utf8' })
    .stdout?.trim() === 'true';

/**
 * Real ancestry, via git. `null` when the question CANNOT BE ANSWERED in this clone.
 *
 * A TRUNCATED HISTORY PRODUCES A CONFIDENT NEGATIVE, AND THAT IS THE DEFECT (2026-09-21, routine
 * #10). `git merge-base --is-ancestor` exits 1 both when A is genuinely not an ancestor of B and
 * when the commits joining them lie outside a shallow graft. Both shas still `cat-file -e` fine —
 * they are recent — so the older code read exit 1 as a definite `false` and reported
 *
 *     the baseline MOVED BACKWARDS: 18fd997 -> 53e2ecb … a diverged line of history
 *
 * in every cloud-agent session, whose clone is shallow by default (measured: 50 commits). The
 * baseline had done nothing of the kind. That is AGENTS.md's owner-locked rule — *silent -> NULL,
 * never unknown -> NO* — violated by a BARRIER's own reader, which is BARRIER_ENGINEER.md PART 1.5,
 * and the cost is the one this routine cares about most: a check that cries wolf in every agent
 * session teaches agents to scroll past reds.
 *
 * A POSITIVE stays trustworthy in a shallow clone — finding an ancestry path PROVES the relation,
 * and a missing path cannot manufacture one. Only the negative becomes UNKNOWN.
 */
const gitAncestry = (cwd: string): AncestryOracle => (older, newer) => {
  for (const sha of [older, newer]) {
    const ok = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd });
    if (ok.status !== 0) return null;
  }
  const r = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd });
  return ancestryVerdict(r.status, isShallow(cwd));
};

/**
 * `git merge-base --is-ancestor`'s exit status, read honestly. Pure, so both directions are proven
 * below without building a shallow repository to hold the proof.
 */
export function ancestryVerdict(status: number | null, shallow: boolean): boolean | null {
  if (status === 0) return true;                   // proof of ancestry, shallow or not
  if (status === 1) return shallow ? null : false; // exit 1 in a shallow clone is UNKNOWN
  return null;                                     // git itself could not answer
}

console.log('The recorded production baseline may only ever move forward\n');

// ── 1 + 2. The rule, executed against a REAL repo, with mutation proofs. ────────────────────────
const sandbox = mkdtempSync(join(tmpdir(), 'baseline-monotonic-'));
try {
  const repo = join(sandbox, 'repo');
  git(sandbox, 'init', '-q', '-b', 'main', repo);
  const commit = (msg: string) => {
    writeFileSync(join(repo, 'f.txt'), `${msg}\n`);
    git(repo, 'add', 'f.txt');
    git(repo, 'commit', '-q', '-m', msg);
    return git(repo, 'rev-parse', 'HEAD');
  };
  const c1 = commit('one');
  const c2 = commit('two');
  const c3 = commit('three');
  // A genuinely diverged line, to prove "not an ancestor" is distinguished from "a rewind".
  git(repo, 'checkout', '-q', '-b', 'side', c1);
  const side = commit('side');
  git(repo, 'checkout', '-q', 'main');

  const oracle = gitAncestry(repo);
  const step = (sha: string, where: string | null = null): BaselineStep => ({ sha, recordedIn: where });

  check('a genuine forward move passes',
    baselineChainProblems([step(c1), step(c2), step(c3)], oracle).length === 0);

  check('re-recording the SAME sha is a no-op, not a violation',
    baselineChainProblems([step(c2), step(c2), step(c3)], oracle).length === 0);

  const rewind = baselineChainProblems([step(c3), step(c1, 'abc1234 stale baseline PR')], oracle);
  mustCatch('a REWIND (newer value is an ancestor of the old one)',
    rewind.length === 1 && rewind[0].includes('MOVED BACKWARDS') && rewind[0].includes('LOWERED'),
    rewind[0]?.slice(0, 90));
  mustCatch('…and the message names the commit that would have introduced it',
    rewind.length === 1 && rewind[0].includes('abc1234'));

  const diverged = baselineChainProblems([step(c3), step(side)], oracle);
  mustCatch('a DIVERGED line, reported as diverged rather than as a rewind',
    diverged.length === 1
      && diverged[0].includes('MOVED BACKWARDS')
      && diverged[0].includes('diverged line of history'));

  const unknown = baselineChainProblems(
    [step(c1), step('0'.repeat(40))], oracle);
  mustCatch('an UNANSWERABLE ancestry question — it fails closed, never passes',
    unknown.length === 1 && unknown[0].includes('was not answered'),
    unknown[0]?.slice(0, 70));

  const malformed = baselineChainProblems([step(c1), step('not-a-sha')], oracle);
  mustCatch('a malformed first line, before any ancestry question is asked',
    malformed.length === 1 && malformed[0].includes('not a 40-hex commit sha'));

  const tooShort = baselineChainProblems([step(c1)], oracle);
  mustCatch('a chain too short to exercise the rule — reported, not silently green',
    tooShort.length === 1 && tooShort[0].includes('looked at nothing'));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

// ── 2b. THE SHALLOW-CLONE LIMB (2026-09-21, routine #10) ────────────────────────────────────────
// The defect this replaces was a FABRICATED NEGATIVE: `--is-ancestor` exits 1 both when A really
// is not an ancestor of B and when the joining commits lie outside a shallow graft, and the old
// reader turned the second into `false`. Every cloud-agent session was told the baseline had
// diverged. Proven in both directions on the pure verdict, and the compensating CI fact is proven
// by execution against the real workflow file rather than assumed.
console.log('');
mustCatch('exit 1 in a SHALLOW clone being read as a definite "not an ancestor" (the fabricated '
  + 'negative every agent session saw)',
  ancestryVerdict(1, true) === null);
check('…while exit 1 in a FULL clone is still a real negative (the rule is not softened)',
  ancestryVerdict(1, false) === false);
check('a POSITIVE stays trustworthy in a shallow clone — a found path proves the relation',
  ancestryVerdict(0, true) === true && ancestryVerdict(0, false) === true);
check('git failing outright is UNKNOWN in either clone',
  ancestryVerdict(128, false) === null && ancestryVerdict(null, true) === null);

const CI_SRC = readFileSync(join(root, CI_WORKFLOW), 'utf8');
check('the real CI workflow does check out full history (the skip above is paid for)',
  fullHistoryCheckout(CI_SRC));
mustCatch('the CI workflow losing `fetch-depth: 0` — the shallow skip would then be covering nothing',
  !fullHistoryCheckout(CI_SRC.replace(/fetch-depth:\s*0/g, 'fetch-depth: 1')));
mustCatch('ONE checkout step of several losing it (a second job quietly going shallow)',
  !fullHistoryCheckout(CI_SRC.replace(/fetch-depth:\s*0/, 'fetch-depth: 1')));
mustCatch('a workflow with NO checkout at all reading as "full history"',
  !fullHistoryCheckout('jobs:\n  x:\n    steps:\n      - run: npm test\n'));

// ── 3. This repository's own recorded baseline history. ─────────────────────────────────────────
console.log('');
const commits = git(root, 'log', `-${WALK}`, '--format=%H', '--', BASELINE)
  .split('\n').filter(Boolean);

if (commits.length === 0) {
  check(`${BASELINE} has a readable commit history`, false,
    'no commits touch the file — the baseline\'s own history is unreadable, so the forward-only '
    + 'rule cannot be checked and must not be assumed');
} else {
  // git log is newest-first; the chain the predicate wants is oldest-first.
  const chain: BaselineStep[] = commits.slice().reverse().map((sha) => ({
    sha: git(root, 'show', `${sha}:${BASELINE}`).split('\n')[0].trim(),
    recordedIn: `${sha.slice(0, 7)} ${git(root, 'log', '-1', '--format=%s', sha).slice(0, 60)}`,
  }));

  const resolvable = (sha: string) =>
    spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root }).status === 0;

  // A value naming a commit this repository does not contain cannot be compared to anything. That
  // is a REAL defect where it happens (2026-09-11's 4b4032c recorded b3a7ba2, which exists neither
  // locally nor on the remote — almost certainly a pre-squash branch sha, leaving preflight's
  // "head must CONTAIN the baseline" gate unevaluable for that window). But it is HISTORY: failing
  // every future PR over it would make this guard the very thing it exists to prevent — an alarm
  // that cries wolf until people stop reading it.
  //
  // So enforcement starts after the LAST unresolvable value, and every skipped entry is PRINTED.
  // The gap is stated, never silent, and never widened: the enforced tail still fails closed on any
  // unanswerable question, because by construction every sha in it resolves.
  let enforcedFrom = 0;
  for (let i = 0; i < chain.length; i++) if (!resolvable(chain[i].sha)) enforcedFrom = i + 1;
  const tail = chain.slice(enforcedFrom);

  console.log(`  walked ${chain.length} recorded value(s) of ${BASELINE}, oldest first:`);
  for (let i = 0; i < chain.length; i++) {
    const mark = i < enforcedFrom ? 'SKIPPED (unresolvable)' : 'enforced';
    console.log(`    ${chain[i].sha.slice(0, 7)}  [${mark}]  ${chain[i].recordedIn}`);
  }
  if (enforcedFrom > 0) {
    console.log(`  NOTE: ${enforcedFrom} historical value(s) name commits this repository does not `
      + 'contain, so no direction can be computed across them. Stated, not hidden; enforcement '
      + 'begins at the first resolvable value.');
  }

  // A SHALLOW CLONE CANNOT ANSWER THIS, AND MUST NOT PRETEND EITHER WAY (2026-09-21, routine #10).
  // Cloud-agent sessions clone shallow by default, so this assertion used to report a FABRICATED
  // "the baseline MOVED BACKWARDS … a diverged line of history" in every one of them. With the
  // ancestry oracle fixed it would instead report UNVERIFIED — honest, but still a red decided by
  // the checkout rather than by the diff, which is the placement defect AGENTS.md records under
  // "The required suite is HERMETIC".
  //
  // So where the history is absent the question is NOT ASKED, loudly — and the skip is paid for by
  // EXECUTING the compensating fact instead: the workflow that runs `npm test` checks the repo out
  // with `fetch-depth: 0`, so the real evaluation provably still happens where it decides anything.
  // Remove that and this goes red everywhere, shallow or not. A skip with nothing behind it would
  // be Prohibition 1 wearing an environment check.
  if (isShallow(root)) {
    console.log('  NOTE: this checkout is SHALLOW, so no ancestry question about the baseline chain '
      + 'can be answered here. NOT ASKED rather than guessed — the assertion below proves the '
      + 'required suite runs it against full history.');
    check('the workflow running `npm test` checks out FULL history (fetch-depth: 0), so the chain '
      + 'assertion this shallow clone cannot make is still made where it counts',
      fullHistoryCheckout(readFileSync(join(root, CI_WORKFLOW), 'utf8')),
      `${CI_WORKFLOW} must check out with fetch-depth: 0`);
  } else {
    const problems = baselineChainProblems(tail, gitAncestry(root));
    check('this repository\'s baseline has only ever moved forward (over every resolvable value)',
      problems.length === 0);
    for (const p of problems) console.log(`      ${p}`);
  }
}

console.log('');
if (failures > 0) {
  console.error(`✗ deploy-baseline-moves-forward: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ deploy-baseline-moves-forward: all assertions passed');
