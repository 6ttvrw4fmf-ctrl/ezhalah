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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineChainProblems, type BaselineStep, type AncestryOracle } from './lib/baselineMonotonic.ts';

const root = join(import.meta.dirname, '..');
const BASELINE = 'docs/DEPLOY_BASELINE.txt';
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

/** Real ancestry, via git. `null` when either sha is not resolvable in this clone. */
const gitAncestry = (cwd: string): AncestryOracle => (older, newer) => {
  for (const sha of [older, newer]) {
    const ok = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd });
    if (ok.status !== 0) return null;
  }
  const r = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null; // git itself could not answer
};

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

  const problems = baselineChainProblems(tail, gitAncestry(root));
  check('this repository\'s baseline has only ever moved forward (over every resolvable value)',
    problems.length === 0);
  for (const p of problems) console.log(`      ${p}`);
}

console.log('');
if (failures > 0) {
  console.error(`✗ deploy-baseline-moves-forward: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('✓ deploy-baseline-moves-forward: all assertions passed');
