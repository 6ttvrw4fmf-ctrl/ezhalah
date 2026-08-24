// THE merge-gate decision — pure, so it is mutation-testable without touching GitHub.
//
// WHY THIS EXISTS (2026-08-24). `gh pr checks --watch` returns once every check reaches a TERMINAL
// state — success, failure, cancelled, timed_out, skipped, neutral. It does not mean "safe to
// merge"; it means "nothing is still running." A merge script that treats the watch call returning
// as permission to merge will happily merge a PR whose required check was cancelled by a concurrent
// rebase/force-push race (this happened live: PR #1046, 2026-08-24 — the code was fine, confirmed
// afterward by an independent push-triggered run on main, but the merge itself proceeded on stale
// evidence, which is exactly the shape of gap that WOULD merge genuinely broken code next time).
//
// THE RULE: immediately before merging, every REQUIRED check's conclusion must be exactly SUCCESS.
// Cancelled, failure, timed_out, skipped, neutral, or still-pending (no conclusion yet) all block —
// there is no conclusion other than SUCCESS that means "safe."

export type CheckConclusion =
  | 'SUCCESS' | 'FAILURE' | 'CANCELLED' | 'TIMED_OUT' | 'SKIPPED' | 'NEUTRAL'
  | 'ACTION_REQUIRED' | 'STALE' | 'STARTUP_FAILURE' | null;

export type CheckRun = { context: string; conclusion: CheckConclusion };

export type MergeGateInput = {
  requiredContexts: string[];       // from branch protection — the contract, not a guess
  checks: CheckRun[];               // the PR's current statusCheckRollup, for the HEAD sha being merged
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string;         // GitHub's own composite: CLEAN / BEHIND / BLOCKED / DIRTY / UNSTABLE / ...
  expectedFiles?: string[];         // optional: the file list verified right after PR creation
  actualFiles?: string[];           // the file list read again right now, immediately before merge
};

export type MergeGateResult = { allow: boolean; reasons: string[] };

/** Normalises whatever a caller passes (GitHub's REST API returns lowercase, GraphQL/`gh --json`
 *  returns uppercase) to the canonical uppercase form this module compares against. */
export function normaliseConclusion(c: string | null | undefined): CheckConclusion {
  if (c == null) return null;
  return c.toUpperCase() as CheckConclusion;
}

export function decideMerge(input: MergeGateInput): MergeGateResult {
  const reasons: string[] = [];

  // 1. EVERY required context must exist in the check list AND be exactly SUCCESS. A required
  // context that is simply ABSENT from the rollup (never ran, or ran against a stale SHA the
  // rollup no longer reports) is exactly as blocking as one that failed — "not found" is not
  // evidence of safety, it is an evidence gap.
  for (const ctx of input.requiredContexts) {
    const runs = input.checks.filter((c) => c.context === ctx);
    if (runs.length === 0) { reasons.push(`required check "${ctx}" has no reported result`); continue; }
    // If a context reports more than once (e.g. re-run), the LATEST-reported entry governs — but
    // ANY non-success entry for that context blocks: a stale success sitting next to a fresh
    // cancellation must not be read as "it passed once, good enough."
    const bad = runs.filter((r) => normaliseConclusion(r.conclusion) !== 'SUCCESS');
    if (bad.length > 0) {
      reasons.push(`required check "${ctx}" is ${bad.map((r) => normaliseConclusion(r.conclusion) ?? 'PENDING').join(', ')}, not SUCCESS`);
    }
  }

  // 2. branch must be up to date with base — "BEHIND" means the checks that DID pass ran against
  // an older tree than what would actually land.
  if (input.mergeStateStatus.toUpperCase() === 'BEHIND') {
    reasons.push('branch is BEHIND base — rebase and re-verify before merging');
  }
  // 3. no unresolved conflicts / blocked state.
  if (input.mergeable !== 'MERGEABLE') {
    reasons.push(`mergeable state is ${input.mergeable}, not MERGEABLE`);
  }
  const badStates = ['BLOCKED', 'DIRTY', 'UNSTABLE'];
  if (badStates.includes(input.mergeStateStatus.toUpperCase())) {
    reasons.push(`mergeStateStatus is ${input.mergeStateStatus}`);
  }

  // 4. the file list, if an expectation was recorded, must be unchanged — catches a shared-worktree
  // mix-up (another session's commits silently riding along) that a green CI run would never catch.
  if (input.expectedFiles && input.actualFiles) {
    const exp = [...input.expectedFiles].sort();
    const act = [...input.actualFiles].sort();
    if (exp.length !== act.length || exp.some((f, i) => f !== act[i])) {
      reasons.push(`file list changed since it was first verified: expected [${exp.join(', ')}], now [${act.join(', ')}]`);
    }
  }

  return { allow: reasons.length === 0, reasons };
}
