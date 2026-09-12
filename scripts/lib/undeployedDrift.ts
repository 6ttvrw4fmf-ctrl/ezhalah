// UNDEPLOYED USER-VISIBLE DRIFT — the predicate that decides whether what users are being served
// is still what `main` says the app is.
//
// WHY THIS EXISTS (routine #9, 2026-09-12, ops_incident `redteam:undeployed_user_visible_drift`).
// The repo already had exactly ONE scheduled detector for "the served bundle is behind main":
// scripts/verify-frontend-bundle-matches-source-live.ts, run by
// .github/workflows/frontend-bundle-source-parity-live-check.yml, whose own header states the stakes
// plainly — "Nothing else catches this class of gap". Verified by execution on 2026-09-12 15:2xZ:
// nothing else does.
//
// It was GREEN. Measured in the same minute:
//
//   served (Vercel production deployment dpl_7TPLg…, alias ezhalah-app.vercel.app)
//       = b3a7ba220bc7c2667097ce2a60833b3dbeccccd4   (2026-09-11 17:42Z)
//   main  = c8a1e1421a2edaaf3ae4765161f03df51931e788 (2026-09-12 07:53Z)
//
//   FOUR src/ commits merged and never served, ~22 hours, including two P1 user-facing repairs:
//     a801531  «عرض المزيد» press 2 crashes the browser tab on الرياض/إيجار/سنوي   (ops_incident #199)
//     c8a1e14  a finished chat reopens as a dead end — 1,140 of 1,200 matches unreachable  (#211)
//     14990bb  a second bottom-docked prompt un-reserves the consent card          (#201)
//     4b4032c  Filter results have no chat composer
//
// The check is green because it answers a STRICTLY NARROWER question than the one it reports: it
// compares only the amenity token vocabulary of src/lib/afCohorts.ts, and then prints «no undeployed
// drift». None of the four commits touches that file, so the narrow proposition is TRUE and the broad
// one — the one its name, its workflow title and its closing sentence all assert — is FALSE. That is
// PRODUCTION_RED_TEAM_ENGINEER.md PART 3.3's shape: a check read as proving far more than it proves,
// green for the entire time the condition it is named for is live.
//
// The ground truth needed to answer the broad question was already in the repo the whole time.
// `docs/DEPLOY_BASELINE.txt` records the commit production serves — it read b3a7ba2, exactly right —
// and its own comment history records this class recurring: «31 commits/5 days of concurrent-session
// work, none of it previously deployed». Nothing on a schedule ever compared it to main.
//
// WHAT THIS PREDICATE IS, AND IS NOT. It is pure and total: it receives readings and returns the
// reasons the claim «everything user-visible on main is being served» does not hold. It performs no
// I/O, so the offline half can feed it broken worlds and watch it fail (that is the whole point —
// see scripts/verify-undeployed-user-visible-drift.ts), and the live half applies this SAME function
// to real readings rather than a second copy of the rule.
//
// IT FAILS CLOSED, in every direction, because AGENTS.md's permanent rule binds the verification
// layer exactly as it binds the product: A FAILED FETCH IS NOT AN EMPTY ANSWER. An unreachable site,
// an unreadable baseline, an undetermined ancestry — each is an UNANSWERED question and therefore a
// problem, never a quiet pass. A detector that reports "no drift" because it could not look is the
// precise failure it exists to prevent.

/** The paths whose content the served web bundle is built FROM — i.e. what a user can see change. */
export const USER_VISIBLE_ROOTS = ['src/', 'assets/', 'app.json', 'index.js', 'App.tsx'] as const;

/** Does this repo-relative path change what a user is served? */
export const isUserVisible = (path: string): boolean =>
  USER_VISIBLE_ROOTS.some((r) => (r.endsWith('/') ? path.startsWith(r) : path === r));

export type DriftReading = {
  /** The commit `docs/DEPLOY_BASELINE.txt` records as live, or null when it could not be read. */
  baselineSha: string | null;
  /** The commit the check is comparing against (main's head), or null when it could not be read. */
  headSha: string | null;
  /**
   * Is `baselineSha` an ancestor of `headSha`? `null` means the question could not be answered —
   * a shallow checkout, a missing object — which is NOT the same as "no", and must not read as "yes".
   */
  baselineIsAncestorOfHead: boolean | null;
  /** Every repo-relative path that differs between baseline and head. Null when undeterminable. */
  changedPaths: string[] | null;
  /** `<sha> <subject>` for each commit in baseline..head, for the failure message. Optional. */
  commitLine?: string[];
  /**
   * The Expo entry bundle production is actually serving, e.g.
   * `_expo/static/js/web/entry-<hash>.js` — or null when production could not be read.
   * This is the LIVENESS leg: it never decides the drift, it decides whether we were able to look
   * at production at all.
   */
  liveEntryBundle: string | null;
};

const SHA = /^[0-9a-f]{40}$/;

/**
 * Every reason the claim "what main says the app is, is what users are being served" does NOT hold.
 * An empty array is the only pass. Order is deliberate: liveness first, then coherence, then drift —
 * so a reader is never told about a diff computed against a world we could not confirm.
 */
export function undeployedDriftProblems(r: DriftReading): string[] {
  const problems: string[] = [];

  // ── LIVENESS. We must have actually read production. ───────────────────────────────────────────
  if (r.liveEntryBundle === null) {
    problems.push(
      'production could not be read — no Expo entry bundle was recovered from '
      + 'https://ezhalah-app.vercel.app. This check therefore proved NOTHING about what users are '
      + 'being served, and reports that as a FAILURE rather than as "no drift" (AGENTS.md: a failed '
      + 'fetch is not an empty answer).',
    );
  } else if (!/_expo\/static\/js\/web\/entry-[A-Za-z0-9._-]+\.js/.test(r.liveEntryBundle)) {
    problems.push(
      `production served something that is not an Expo web entry bundle: ${JSON.stringify(r.liveEntryBundle)}. `
      + 'A 200 carrying an error page looks exactly like a healthy read to a check that only asks for '
      + 'the status code, so the SHAPE is asserted here.',
    );
  }

  // ── COHERENCE of the recorded baseline. ────────────────────────────────────────────────────────
  if (r.baselineSha === null) {
    problems.push(
      'docs/DEPLOY_BASELINE.txt could not be read, so the commit production serves is UNKNOWN. '
      + 'That file is the deploy pipeline\'s own record (scripts/record-deploy-baseline.sh); without '
      + 'it there is no claim to test, which is a failure, not a pass.',
    );
  } else if (!SHA.test(r.baselineSha)) {
    problems.push(
      `docs/DEPLOY_BASELINE.txt's first line is not a 40-hex commit sha: ${JSON.stringify(r.baselineSha)}`,
    );
  }
  if (r.headSha === null) {
    problems.push('the head commit under test could not be read — nothing to compare the baseline against');
  } else if (!SHA.test(r.headSha)) {
    problems.push(`the head commit under test is not a 40-hex commit sha: ${JSON.stringify(r.headSha)}`);
  }

  if (r.baselineIsAncestorOfHead === null) {
    problems.push(
      'could not determine whether the recorded baseline is an ancestor of the head under test — '
      + 'usually a shallow checkout (actions/checkout defaults to fetch-depth 1). An undetermined '
      + 'ancestry is not a satisfied one.',
    );
  } else if (r.baselineIsAncestorOfHead === false) {
    problems.push(
      `the commit recorded as live (${r.baselineSha}) is NOT an ancestor of the head under test `
      + `(${r.headSha}). The record and the branch disagree about history, so the diff below cannot be `
      + 'trusted — production may be serving something that was never on this branch.',
    );
  }

  // ── THE DRIFT ITSELF. ──────────────────────────────────────────────────────────────────────────
  if (r.changedPaths === null) {
    problems.push('the baseline..head file list could not be computed — the drift question was not answered');
  } else {
    const visible = r.changedPaths.filter(isUserVisible);
    if (visible.length > 0) {
      const commits = (r.commitLine ?? []).length
        ? `\n      commits merged and not served:\n        ${(r.commitLine ?? []).join('\n        ')}`
        : '';
      problems.push(
        `${visible.length} user-visible file(s) differ between the commit production is recorded to `
        + `serve (${r.baselineSha}) and the head under test (${r.headSha}) — that work is MERGED AND `
        + 'NOT SHIPPED, so every user is still meeting the behaviour it repairs.'
        + `\n      files: ${visible.slice(0, 12).join(', ')}${visible.length > 12 ? ` … +${visible.length - 12} more` : ''}`
        + commits
        + '\n      Remedy: dispatch .github/workflows/deploy-frontend.yml (reason, confirm=DEPLOY) once '
        + 'the deploy gates are clear, then let scripts/record-deploy-baseline.sh advance the record. '
        + 'If the gates are NOT clear (e.g. migration_drift is red), that blockage is the finding — '
        + 'never clear this check by editing the baseline.',
      );
    }
  }

  return problems;
}
