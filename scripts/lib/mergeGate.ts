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

export type CheckRun = { context: string; conclusion: CheckConclusion; title?: string | null };

export type MergeGateInput = {
  requiredContexts: string[];       // from branch protection — the contract, not a guess
  // Whether that contract was actually READ. Added 2026-08-26: the old transport swallowed a 403 on
  // the protection endpoint and returned [], which silently disabled the required-check half of the
  // gate — a merge could then pass while nothing verified the required checks at all. Anything other
  // than an explicit `true` now blocks, so "I could not read the contract" fails CLOSED. An
  // explicitly-read EMPTY list (a branch that genuinely requires nothing) is still `true`.
  requiredContextsKnown?: boolean;
  checks: CheckRun[];               // the PR's current statusCheckRollup, for the HEAD sha being merged
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: string;         // GitHub's own composite: CLEAN / BEHIND / BLOCKED / DIRTY / UNSTABLE / ...
  expectedFiles?: string[];         // optional: the file list verified right after PR creation
  actualFiles?: string[];           // the file list read again right now, immediately before merge
  // Unresolved CodeRabbit Major/Critical threads on the PR (owner 2026-11-08, «fully automate with the engineers and
  // CodeRabbit»): #11247 was green + CLEAN with 9 unanswered Majors, several on PRICE = SOURCE, and the robot was about
  // to merge it. null = the threads could not be read → blocks. Omitted = not checked (pure unit tests only).
  openReviewMajors?: string[] | null;
  // CodeRabbit has posted at least one review on this PR (any commit). Only an explicit `true` counts.
  codeRabbitReviewed?: boolean;
  // The caller PROVED (scripts/pr-migrations-match-production.ts judge(), reading ops_migration_sql) that every
  // migration file in this PR is exactly what production already ran. Only an explicit `true` counts; an unreadable
  // production, a missing key or one byte of difference is not a proof. See rule 0b‴.
  copyOfProduction?: boolean;
};

export type MergeGateResult = { allow: boolean; reasons: string[] };

/** Normalises whatever a caller passes (GitHub's REST API returns lowercase, GraphQL/`gh --json`
 *  returns uppercase) to the canonical uppercase form this module compares against. */
export function normaliseConclusion(c: string | null | undefined): CheckConclusion {
  if (c == null) return null;
  return c.toUpperCase() as CheckConclusion;
}

// 0b′ (owner 2026-11-07, «make the robot handle these database PRs»): CodeRabbit is an advisory reviewer, never a
// required check. On a PR it has nothing to read it reports SKIPPED («No files to review»): #10856 (one migration +
// the cron mirror) was skipped twice and could not merge while every frontend deploy waited 20 h on its drift. Only
// that one context, only SKIPPED, and only while it is NOT required: its FAILURE/CANCELLED/pending still block, and
// if branch protection ever makes it required, rule 1 governs and SKIPPED blocks again.
export const ADVISORY_MAY_SKIP = ['CodeRabbit'];
// 0b″ (owner 2026-11-09, «Yes, merge»): a rate-limited CodeRabbit reports NEUTRAL «Review rate limited» and never
// re-reviews by itself. #11367 (three byte-exact mirrors) had every Major CodeRabbit raised fixed and resolved, yet sat
// 5 h on that NEUTRAL while the drift gate refused every deploy. It passes ONLY when CodeRabbit already reviewed this
// PR AND its threads were read with no open Major (rule 3b still runs) AND it is not required.
export const RATE_LIMITED = /rate limited/i;
// 0b‴ (owner 2026-11-09, «Do both»): a COPY-ONLY PR passes a rate-limited CodeRabbit even when CodeRabbit never read
// it. Measured that day: the reviewer gave about one review an hour, ten migrations production had already run sat in
// mirror PRs it never reached, engineer-automerge refused all of them every 15 minutes for «check "CodeRabbit" is
// NEUTRAL», and the drift gate refused four frontend deploys in a row (08:43-19:43 UTC). Merging such a PR changes
// nothing in production: it is the git copy of SQL that already ran. Copy-only means BOTH: every file is a database
// lane file (supabase/migrations/<14 digits>_*.sql or sql/mirrors/*) with at least one migration among them, AND the
// caller proved every migration equals what production ran. Everything else still blocks: a required CodeRabbit, its
// FAILURE / CANCELLED / pending, a NEUTRAL for another reason, unreadable threads, an open Major, any other file.
// The two patterns are the database lane's own (scripts/pr-migrations-match-production.ts); verify-merge-gate.ts
// fails if they drift apart.
export const COPY_MIGRATION_FILE = /^supabase\/migrations\/(\d{14})_[A-Za-z0-9_]+\.sql$/;
export const COPY_LANE_FILE = /^(supabase\/migrations\/\d{14}_[A-Za-z0-9_]+\.sql|sql\/mirrors\/[A-Za-z0-9_.-]+)$/;
export const isCopyLane = (files: string[] | undefined): files is string[] =>
  Array.isArray(files) && files.length > 0 && files.every((f) => COPY_LANE_FILE.test(f)) && files.some((f) => COPY_MIGRATION_FILE.test(f));
const copyOnly = (input: MergeGateInput) => input.copyOfProduction === true && isCopyLane(input.actualFiles);
const advisorySkip = (c: CheckRun, input: MergeGateInput) => {
  if (!ADVISORY_MAY_SKIP.includes(c.context) || input.requiredContexts.includes(c.context)) return false;
  const k = normaliseConclusion(c.conclusion);
  return k === 'SKIPPED'
    || (k === 'NEUTRAL' && RATE_LIMITED.test(c.title ?? '') && (input.codeRabbitReviewed === true || copyOnly(input))
      && Array.isArray(input.openReviewMajors) && input.openReviewMajors.length === 0);
};

export function decideMerge(input: MergeGateInput): MergeGateResult {
  const reasons: string[] = [];

  // 0. The required-check CONTRACT must have been read. Not knowing what is required is not the
  // same as nothing being required, and only one of those is safe to merge on.
  if (input.requiredContextsKnown !== true) {
    reasons.push('required-status-check contract could not be read — refusing rather than merging unverified');
  }

  // 0b. No reported check may be non-SUCCESS, whether or not it is REQUIRED. GitHub already calls
  // this state UNSTABLE and the gate already blocks UNSTABLE below; stating it directly means a
  // failing optional check still blocks even when mergeStateStatus is unavailable or stale, and it
  // means a branch with NO protection configured (requiredContexts legitimately []) is still not a
  // free pass. Strictly stricter than the required-only rule — never a substitute for it.
  for (const c of input.checks) {
    if (advisorySkip(c, input)) continue;
    if (normaliseConclusion(c.conclusion) !== 'SUCCESS') {
      reasons.push(`check "${c.context}" is ${normaliseConclusion(c.conclusion) ?? 'PENDING'}, not SUCCESS`);
    }
  }

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

  // 3b. every CodeRabbit Major/Critical is fixed or answered — the engineer (or CodeRabbit itself) resolves the thread.
  if (input.openReviewMajors === null) {
    reasons.push('CodeRabbit review threads could not be read — refusing rather than merging over an unanswered Major');
  } else if (input.openReviewMajors?.length) {
    reasons.push(`${input.openReviewMajors.length} unresolved CodeRabbit Major/Critical thread(s): ${input.openReviewMajors.slice(0, 5).join(' | ')} — fix or answer each, then resolve it`);
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
