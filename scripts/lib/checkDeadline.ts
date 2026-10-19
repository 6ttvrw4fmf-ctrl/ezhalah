// A LIVE CHECK MUST DELIVER A VERDICT, NOT BE KILLED MID-SENTENCE (ops_incident, routine-4, 2026-09-27).
//
// THE DEFECT, measured across the whole bridge-wired fleet on 2026-09-27.
// `scripts/ops/raise-workflow-alert.mjs` classifies a run's outcome as VERDICT (success | failure)
// or NO_VERDICT (cancelled | skipped), and for NO_VERDICT it deliberately leaves `alert_event`
// untouched — correct on its own terms, because a run cancelled by a newer run in its concurrency
// group reached no conclusion and must neither raise nor resolve.
//
// But a job killed by its own `timeout-minutes` ALSO reports `cancelled`. So a check that outgrows
// its job budget stops producing verdicts and NOTHING ANYWHERE NOTICES: no red X that anyone reads,
// no alert row, and — because the bridge only ever writes on failure and resolves on success — no
// positive heartbeat either, so there is no record whose ABSENCE could be compared. This is exactly
// the shape AGENTS.md declares canonical for liveness (`docs/ops/LISTING_LIVENESS.md` §9): *absence
// cannot be compared, so silence reads as health*, and *if the checker stops working, Ezhalah must
// detect THAT failure too*.
//
// MEASURED, both on this routine's own surface:
//
//   district-suggestion-parity-live-check.yml  cap 10m — 9 of its last 12 runs killed at 618-620s.
//     Last verdict of ANY kind: 2026-09-24 17:30 UTC (run 180). The district dead-end invariant —
//     the guard that stops the app suggesting a حي that returns zero results — was unprotected for
//     ~2.5 days while the Actions tab showed "cancelled" and the ops dashboard showed nothing.
//     Cause: honest growth. 1,772 (city × scope × district) suggestions today against a 10m cap;
//     duration crept 510s -> 592s over the preceding week, then crossed 600s and stayed there.
//
//   count-rpc-parity-live-check.yml            cap 10m — 7 of its last 12 runs killed at ~621s.
//     Cause is sharper and worth stating: `PACE_BUDGET_MS` in afJourneyPacing.ts is 10 * 60_000,
//     EXACTLY equal to that workflow's cap, and the job runs TWO checks that each may wait on it.
//     So the careful `NOT EXERCISED — production was degraded, re-run outside the scraper window`
//     verdict that check was built to emit is UNREACHABLE in CI: waiting for health can consume the
//     entire job. A check whose honest answer cannot be printed does not have an honest answer.
//
// WHAT THIS IS NOT. It is not a timeout raise, and it is not a coverage cut. Raising `timeout-minutes`
// alone defers the same silence to the next growth increment; cutting districts or scopes to fit
// would be lowering a floor to get green, which this repo forbids outright. Neither touches the
// actual defect, which is that the check never gets to SPEAK.
//
// THE RULE, and it is a pure inequality so a barrier can check it:
//
//     deadline + BRIDGE_MARGIN_SECONDS  <=  the workflow's own timeout-minutes
//
// The check stops taking NEW work at the deadline, reports what it did not reach as explicitly
// NOT EXERCISED, and exits non-zero. The margin is what the runner needs after the check returns:
// checkout + setup-node before it, the failure->alert bridge step and cleanup after it. Because the
// deadline is strictly inside the cap, the process always reaches its own summary and its own exit
// code, so a run that could not finish becomes a LOUD alert instead of a silent cancellation.
//
// FAIL-LOUD, NEVER FAIL-QUIET. An expired deadline is not a pass and not a flake: it is a run that
// did not certify what it was asked to certify, and it exits 1 so the bridge raises. There is no
// path through this file that turns an unfinished run into a clean one — it only reports TIME, and
// the callers' `clean` predicates already require zero unexercised work.
//
// Pinned by scripts/verify-live-check-deadline-beats-its-job-timeout.ts (in `npm test`), which reads
// the inequality out of the real workflow YAML for every check that uses this module, and executes
// the accounting to prove an unreached task can never read as clean.
//
// THIS FILE IMPORTS NOTHING, DELIBERATELY — the same rule postgrestRetry.ts records: a convenience
// import here would pull scripts/lib/public-supabase.ts into the module graph of every check that
// uses it, making the proofs over it live-reaching and tripping verify-required-suite-is-hermetic.ts.

/**
 * Seconds the runner needs around the check itself: `actions/checkout` + `setup-node` before it
 * (~20-30s measured), then the `if: always()` bridge step and job cleanup after it (~20s), plus
 * slack. A check that overruns by less than this still gets to deliver its verdict.
 */
export const BRIDGE_MARGIN_SECONDS = 180;

/**
 * Used when a run declares no deadline (a local invocation, say). Bounded on purpose: the one thing
 * this module must never produce is an unbounded wait, because that is the defect.
 */
export const DEFAULT_DEADLINE_SECONDS = 420;

/** The env var a workflow sets to declare its check's deadline. */
export const DEADLINE_ENV = 'CHECK_DEADLINE_SECONDS';

export type Deadline = {
  /** Epoch ms after which no NEW work may be started. */
  readonly endsAt: number;
  /** Whole seconds this deadline was configured for — what the barrier compares against the YAML. */
  readonly budgetSeconds: number;
  /** True once the budget is spent. */
  expired: () => boolean;
  /** Milliseconds left, floored at 0 — safe to hand to a bounded wait. */
  remainingMs: () => number;
};

/**
 * Parse a declared budget. Anything that is not a positive finite number of seconds falls back to
 * the bounded default rather than throwing — a malformed env var must not be the reason a check
 * produces no verdict at all, which is the very failure this module exists to remove.
 */
export function budgetSecondsFrom(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DEADLINE_SECONDS;
}

/** Start a deadline. `now` and the raw budget are injected so the proofs need no real clock. */
export function startDeadline(
  raw: string | undefined = process.env[DEADLINE_ENV],
  now: number = Date.now(),
): Deadline {
  const budgetSeconds = budgetSecondsFrom(raw);
  const endsAt = now + budgetSeconds * 1000;
  return {
    endsAt,
    budgetSeconds,
    expired: () => Date.now() >= endsAt,
    remainingMs: () => Math.max(0, endsAt - Date.now()),
  };
}

/**
 * THE INEQUALITY, as a predicate, so the barrier and any future caller share one definition.
 * `true` means the check can finish speaking before the runner kills the job.
 */
export function deadlineFitsJob(budgetSeconds: number, jobTimeoutMinutes: number): boolean {
  return budgetSeconds + BRIDGE_MARGIN_SECONDS <= jobTimeoutMinutes * 60;
}

/**
 * Bound any inner wait (e.g. `paceUntilHealthy`'s budget) by what is actually left, so a nested
 * budget can never outlive the deadline that contains it — the count-rpc-parity defect above.
 */
export function boundedBy(deadline: Deadline, wantedMs: number): number {
  return Math.min(wantedMs, deadline.remainingMs());
}

/**
 * The one line every deadline-aware check prints when it ran out of time, so the reason a run is
 * red is never ambiguous in a log someone reads months later.
 */
export function incompleteVerdict(done: number, planned: number, budgetSeconds: number): string {
  const missed = Math.max(0, planned - done);
  return `✗ COVERAGE INCOMPLETE — ${done} of ${planned} checked, ${missed} NOT EXERCISED: the ` +
    `${budgetSeconds}s deadline expired before this run could certify them. This is NOT a pass and ` +
    `NOT a flake; the check outgrew its budget. Raise timeout-minutes AND ${DEADLINE_ENV} together ` +
    `(keeping ${DEADLINE_ENV} + ${BRIDGE_MARGIN_SECONDS}s <= timeout-minutes), or make the work cheaper — ` +
    `never reduce what is covered to fit.`;
}

/**
 * What a run measured, as the ONE shape every deadline-aware check reports.
 *
 * `unanswered` and `unattempted` are deliberately separate facts: the first is a request that failed
 * (a 503, a reset — "A FAILED FETCH IS NOT AN EMPTY ANSWER"), the second is work the deadline cut
 * before it was ever tried. Both mean the same thing for the verdict and neither is a defect in the
 * product, which is exactly why they must not be silently folded into "nothing found".
 */
export type Measured = {
  /** Real, product-level violations the check exists to find. */
  defects: number;
  /** Attempted, but the request never answered. */
  unanswered: number;
  /** Never attempted — the deadline expired first. */
  unattempted: number;
  /** A planning/enumeration call that never answered, so its work was never even planned. */
  planningFailed?: number;
  /** True when enumeration itself was cut short, so `planned` understates what exists. */
  planningCut?: boolean;
};

/**
 * THE VERDICT PREDICATE — a run is CERTIFIED only when it found no defect AND measured everything.
 *
 * This is a predicate rather than an inline expression in each check because the failure it guards
 * against is a *sentence*, not an exit code. On 2026-09-26 (run 187) the district check printed
 * «✓ no dead-end district suggestions — every populated district returns results» while 10 of its
 * searches had come back HTTP 503 and been counted as failures: the exit code was correct and the
 * clean tick was a lie, and the tick is what a human reads. Anything unmeasured makes a run
 * UNCERTIFIED — never clean, never green.
 */
export function certified(m: Measured): boolean {
  return m.defects === 0
    && m.unanswered === 0
    && m.unattempted === 0
    && (m.planningFailed ?? 0) === 0
    && !(m.planningCut ?? false);
}
