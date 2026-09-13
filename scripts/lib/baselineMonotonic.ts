// THE RECORDED PRODUCTION BASELINE MAY ONLY EVER MOVE FORWARD.
//
// docs/DEPLOY_BASELINE.txt names the commit production is serving. preflight-verify.sh refuses to
// deploy any head that does not CONTAIN that commit, so the baseline is a safety FLOOR: raising it
// tightens the gate, lowering it loosens one.
//
// Nothing asserted the direction until now. Both existing readers are blind to a rewind:
//   * verify-baseline-record-path.ts proves the recorder can WRITE the file when a push to main is
//     refused — it never asks what value was written.
//   * undeployedDrift.ts asks `baselineIsAncestorOfHead`, which an OLDER baseline satisfies just as
//     happily as the right one; a rewind makes that check MORE green, not less.
// So a stale value could be installed and every guard would keep passing.
//
// That is not hypothetical. On 2026-09-13 ELEVEN `chore(deploy): record approved baseline …` PRs
// were open at once, each recording a DIFFERENT commit, the oldest from the previous day, because
// the recorder can open its PR but nothing merges it. Merging them newest-first is correct; any
// other order silently rewinds the floor, and the eleventh merge would have left the file naming a
// commit production stopped serving a day earlier.
//
// THE PREDICATE, stated once here so the barrier and any future caller share it rather than each
// re-deriving it: for consecutive recorded values (older → newer) the newer must CONTAIN the older.
// Equal is fine (re-recording the same deploy is a no-op). Anything else — an ancestor, a commit on
// a diverged line, a value that cannot be resolved at all — is a rewind or an unanswered question,
// and both are failures. An unanswerable ancestry question must never read as "fine": that is the
// repo-wide silent→NULL-never-unknown→NO rule applied to git.

export const SHA40 = /^[0-9a-f]{40}$/;

/** One recorded value of the baseline file, oldest-first when passed as a chain. */
export interface BaselineStep {
  /** The 40-hex sha recorded, exactly as the file's first line carried it. */
  sha: string;
  /** Commit that introduced this value, for the failure message. May be null for the working tree. */
  recordedIn: string | null;
}

/**
 * Is `older` contained in `newer`?
 *   true  — yes, this is a forward move
 *   false — no, `newer` does not contain `older` (rewind, or a diverged line)
 *   null  — the question could not be answered (a sha this clone cannot resolve). NEVER "fine".
 */
export type AncestryOracle = (older: string, newer: string) => boolean | null;

/**
 * Every problem in a chain of recorded baseline values, oldest first. Empty array = the baseline
 * has only ever moved forward. Returns PROBLEMS rather than a boolean so each failure can say which
 * pair broke the rule and in which direction — a bare false would send the next reader to diff
 * three files to find out what happened.
 */
export function baselineChainProblems(
  chain: readonly BaselineStep[],
  isAncestor: AncestryOracle,
): string[] {
  const problems: string[] = [];

  for (const step of chain) {
    if (!SHA40.test(step.sha)) {
      problems.push(
        `docs/DEPLOY_BASELINE.txt's first line is not a 40-hex commit sha: ${JSON.stringify(step.sha)}`
          + (step.recordedIn ? ` (recorded in ${step.recordedIn})` : ' (working tree)'),
      );
    }
  }
  if (problems.length > 0) return problems;

  // A chain of one cannot demonstrate anything. Say so rather than returning a green that means
  // "looked at nothing" — the same vacuity trap a detector hits when its slice selects no rows.
  if (chain.length < 2) {
    problems.push(
      `only ${chain.length} recorded baseline value(s) were available, so the forward-only rule was `
      + 'never actually exercised. A green verdict here would mean "looked at nothing", not "found '
      + 'nothing".',
    );
    return problems;
  }

  for (let i = 1; i < chain.length; i++) {
    const older = chain[i - 1];
    const newer = chain[i];
    if (older.sha === newer.sha) continue; // re-recording the same deploy is a legitimate no-op

    const contains = isAncestor(older.sha, newer.sha);
    if (contains === null) {
      problems.push(
        `could not determine whether ${newer.sha.slice(0, 7)} contains ${older.sha.slice(0, 7)} — `
        + 'the ancestry question was not answered, so the baseline move is UNVERIFIED. An '
        + 'unanswerable question is a failure here, never a pass.',
      );
    } else if (!contains) {
      const rewind = isAncestor(newer.sha, older.sha) === true;
      problems.push(
        `the baseline MOVED BACKWARDS: ${older.sha.slice(0, 7)} → ${newer.sha.slice(0, 7)}`
        + (newer.recordedIn ? ` in ${newer.recordedIn}` : ' in the working tree')
        + (rewind
          ? ' — the new value is an ANCESTOR of the old one, so the deploy floor preflight-verify.sh '
            + 'enforces was LOWERED. This is what merging a stale chore(deploy) baseline PR does.'
          : ' — the new value does not contain the old one at all (a diverged line of history).')
        + ' Record the commit production actually serves, or merge the baseline PRs newest-first.',
      );
    }
  }

  return problems;
}
