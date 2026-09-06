// DID A DEPLOY RUN ACTUALLY SHIP? — read from the run's own log, not from its conclusion.
//
// WHY THIS EXISTS (ops_incident #75)
// ----------------------------------
// af-live-truth-check.yml chains off `Deploy frontend (production)` to verify Advanced Filter the
// moment a new bundle reaches production — the workflow's own comment calls it "the run that
// actually matters". Its gate was `github.event.workflow_run.conclusion == 'success'`.
//
// That workflow structurally NEVER concludes success. Two standing reasons, neither of which says
// anything about whether a bundle shipped:
//   · ops_incident #30 — the baseline recorder can neither push to main nor open its PR, so a
//     deploy that shipped perfectly still exits non-zero.
//   · the post-deploy hydration gate fails on pre-existing React #418 at 4 of 5 viewports.
//
// So the condition was never true, all five AF jobs were SKIPPED on every deploy, and the
// attendance job correctly refused to call that a clean run. Ten consecutive workflow_run-triggered
// runs (#186-#195) concluded failure with every job skipped. Deploy-time AF coverage was zero.
//
// `conclusion` answers "did every step pass". The question this gate needs answered is "is there a
// new bundle live" — and safe-deploy.sh already says so, in the log, at the moment it aliases.
//
// THE FALSE POSITIVE THIS ALMOST HAD
// ----------------------------------
// The obvious predicate — does the log contain "Aliased" — is WRONG, and measurably so. GitHub
// Actions echoes each step's script into the log, and the deploy workflow's Report step contains
// the literal `grep -qE 'Aliased|^https://ezhalah-[a-z0-9]+-'`. So the word "Aliased" appears in
// the log of a run that was REFUSED before deploying and never aliased anything.
//
// Measured on the two real runs:
//                                    shipped (33999823504)   refused (33998397629)
//   /Aliased/                                 1                       1     ← would fail open
//   /Aliased\s+https:\/\/ezhalah-app…/        1                       0
//   real deployment URL                       1                       0
//
// Both strict forms discriminate; the naive one does not. Either strict form alone is sufficient
// evidence a deployment happened, so the predicate accepts their union.

/** The alias assertion safe-deploy.sh prints once the canonical URL serves the new bundle. */
const ALIAS_LINE = /Aliased[^\S\n]+https:\/\/ezhalah-app\.vercel\.app/;

/**
 * A real per-deployment Vercel URL: `ezhalah-<hash>-<team>.vercel.app`. The Report step's echoed
 * regex contains the literal text `https://ezhalah-[a-z0-9]+-`, which cannot match this — the
 * bracket characters are literal there, and this requires `.vercel.app` to close the URL.
 */
const DEPLOYMENT_URL = /https:\/\/ezhalah-[a-z0-9]{6,}-[a-z0-9-]+\.vercel\.app/;

/**
 * True when the log proves a production deployment was produced and aliased.
 *
 * Deliberately says nothing about whether the run went on to pass its later steps: a deploy that
 * shipped and then went red at the baseline recorder HAS put a new bundle in front of users, and
 * that is exactly when the AF live check most needs to run.
 */
export function deployShippedFromLog(log: string): boolean {
  return ALIAS_LINE.test(log) || DEPLOYMENT_URL.test(log);
}

/**
 * The gate's decision, including what to do when the evidence cannot be read at all.
 *
 * FAILS TOWARD VERIFYING. An unreadable log — API hiccup, permissions, a log that has aged out —
 * must NOT silently skip the check: that reproduces #75's own failure shape one level down, where
 * a barrier goes dark and the run still looks fine. Wasting one CI run is the cheap mistake; a
 * dark barrier on a deploy day is the expensive one. This mirrors the repo's standing rule that a
 * failed fetch is never an empty answer.
 */
export function shouldRunLiveCheck(input: {
  eventName: string;
  /** the triggering run's log, or null when it could not be read */
  log: string | null;
}): { run: boolean; why: string } {
  if (input.eventName !== 'workflow_run') {
    return { run: true, why: `event is ${input.eventName}, not a deploy chain — always verify` };
  }
  if (input.log === null) {
    return { run: true, why: 'could not read the deploy run log — verifying rather than going dark' };
  }
  return deployShippedFromLog(input.log)
    ? { run: true, why: 'the deploy log shows a production deployment was aliased' }
    : { run: false, why: 'the deploy run produced no deployment — there is no new bundle to verify' };
}
