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
  /**
   * IS THE RECORD ITSELF CURRENT? — the head sha of the newest SUCCESSFUL production deploy, as the
   * deploy pipeline's own run history reports it. `null` means that history could not be read, which
   * is UNKNOWN and therefore a problem, never "there were no deploys".
   *
   * WHY THIS READING EXISTS (routine #2, 2026-09-15). `docs/DEPLOY_BASELINE.txt` is advanced by
   * scripts/record-deploy-baseline.sh, which CANNOT push to main (branch protection + a read-only
   * GITHUB_TOKEN) and therefore falls back to opening a PR — and then `exit 0`. Nobody merges those
   * PRs: seventeen `deploy/baseline-*` PRs were open on 2026-09-15, the oldest from 09-11, while the
   * file still recorded 18fd9974 and production had moved four successful deploys ahead to 07c6104.
   *
   * The consequence was not a missed alarm but a FALSE one. This check reported «13 user-visible
   * file(s) … MERGED AND NOT SHIPPED», naming two new platform launches and a P1 chat-lock repair —
   * all of which were live. Verified the same morning: the served bundle carried 07c6104's own
   * values (logoOverride 34×34, pillLogo 24×24) and NOT the 26×26/18×18 they replaced, and a real
   * anonymous search returned 3,670 rakez and 96 suwar listings. Four separate routines spent a day
   * reasoning about a blockage that did not exist, and ops_incident #264 stood P1 on it.
   *
   * So the stale-record case must be told APART from real unshipped work rather than collapsed into
   * it. Both still FAIL — a wrong record is dangerous in its own right — but the failure now names
   * the recorder rather than the innocent commits.
   */
  lastDeploySha?: string | null;
  /**
   * True when `baselineSha` is strictly behind `lastDeploySha` — i.e. the recorded floor is older
   * than a deploy that provably succeeded, so the record is stale. `null` = undetermined (which is
   * not "no"). `undefined` = the caller supplied no corroboration evidence at all.
   */
  baselineIsBehindLastDeploy?: boolean | null;
  /**
   * The file list from `lastDeploySha..headSha` — the drift question asked against the commit
   * production DEMONSTRABLY serves rather than against a record known to be stale. Only consulted
   * when `baselineIsBehindLastDeploy` is true. `null` = undeterminable.
   */
  changedPathsSinceLastDeploy?: string[] | null;
};

const SHA = /^[0-9a-f]{40}$/;

/** The Expo web entry bundle path, as it appears in the served HTML. */
export const ENTRY_BUNDLE = /_expo\/static\/js\/web\/entry-[A-Za-z0-9._-]+\.js/;

/**
 * Turn ONE production HTTP response into the `liveEntryBundle` reading, and nothing else.
 *
 * Lives here rather than inline in the live half so it is mutation-proven on every PR by the
 * hermetic half — the same reason `registryPayload()` sits in scripts/lib/uiControlPredicates.ts
 * rather than in its own live sibling. The rule it encodes is the one AGENTS.md states permanently:
 * a request that FAILED must never arrive at a verdict looking like a plausible answer.
 *
 *   · a non-200 → `null`. Read the body for a human, never let it stand in for the app's HTML.
 *   · a 200 with no entry bundle → the first 120 chars of what WAS served, so `undeployedDriftProblems`
 *     can say what arrived instead (a 200 carrying an error page looks healthy to a status-code check).
 *   · nothing readable at all → `null`.
 */
export function liveBundleReading(ok: boolean, html: string | null): string | null {
  if (!ok || html === null || html === '') return null;
  const m = html.match(ENTRY_BUNDLE);
  return m ? m[0] : html.slice(0, 120);
}

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
  } else if (!ENTRY_BUNDLE.test(r.liveEntryBundle)) {
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

  // ── IS THE RECORD CURRENT? ─────────────────────────────────────────────────────────────────────
  // Asked BEFORE the drift itself, because a diff computed from a stale floor accuses the wrong
  // commits. Skipped entirely when the caller supplies no corroboration evidence (`undefined`), so
  // this predicate stays usable by callers that only have the two shas.
  const corroborationSupplied = r.lastDeploySha !== undefined || r.baselineIsBehindLastDeploy !== undefined;
  if (corroborationSupplied) {
    if (r.lastDeploySha === null) {
      problems.push(
        'the production deploy history could not be read, so whether docs/DEPLOY_BASELINE.txt is '
        + 'still CURRENT is unknown. The record is this check\'s only claim about what users are '
        + 'served; an unverifiable record is an unanswered question, not a pass.',
      );
    } else if (r.lastDeploySha !== null && !SHA.test(r.lastDeploySha)) {
      problems.push(`the last successful deploy's head is not a 40-hex commit sha: ${JSON.stringify(r.lastDeploySha)}`);
    }
    if (r.baselineIsBehindLastDeploy === null) {
      problems.push(
        'could not determine whether the recorded baseline is behind the last successful deploy — '
        + 'an undetermined answer must not read as "the record is current".',
      );
    }
  }

  // THE RECORD IS STALE. Report the recorder, and judge real drift against the commit production
  // demonstrably serves. Never announce shipped work as unshipped — that is what cost 2026-09-14.
  if (r.baselineIsBehindLastDeploy === true) {
    const since = r.changedPathsSinceLastDeploy;
    const reallyUnshipped = since === null || since === undefined ? null : since.filter(isUserVisible);
    problems.push(
      `docs/DEPLOY_BASELINE.txt is STALE: it records ${r.baselineSha} as live, but a production `
      + `deploy of ${r.lastDeploySha} succeeded after that. The record — not the merged work — is `
      + 'what is wrong here.'
      + (reallyUnshipped === null
        ? '\n      Drift against the actually-deployed commit could not be computed, so whether any '
          + 'user-visible work is genuinely unshipped remains UNKNOWN.'
        : reallyUnshipped.length === 0
          ? '\n      Measured against the actually-deployed commit, NOTHING user-visible is unshipped — '
            + 'so any "merged and not shipped" reading from the stale floor would have been false.'
          : `\n      Measured against the actually-deployed commit, ${reallyUnshipped.length} user-visible `
            + `file(s) are genuinely unshipped: ${reallyUnshipped.slice(0, 12).join(', ')}`
            + `${reallyUnshipped.length > 12 ? ` … +${reallyUnshipped.length - 12} more` : ''}`)
      + '\n      Root cause: scripts/record-deploy-baseline.sh cannot push to main (branch protection '
      + '+ read-only GITHUB_TOKEN), so it opens a deploy/baseline-* PR and exits 0. The floor only '
      + 'advances when a human merges that PR. Remedy: merge the open deploy/baseline-* PR for '
      + `${r.lastDeploySha?.slice(0, 7) ?? 'the deployed commit'}, or give the pipeline the `
      + 'BASELINE_PR_TOKEN secret so it can advance the floor itself. Never edit the baseline by hand '
      + 'to clear this check.',
    );
  }

  // ── THE DRIFT ITSELF. ──────────────────────────────────────────────────────────────────────────
  if (r.changedPaths === null) {
    problems.push('the baseline..head file list could not be computed — the drift question was not answered');
  } else if (r.baselineIsBehindLastDeploy !== true) {
    const visible = r.changedPaths.filter(isUserVisible);
    if (visible.length > 0) {
      // WAS THE RECORD ACTUALLY CORROBORATED? — routine #9, 2026-09-18, ops_incident #227.
      //
      // The 2026-09-15 guard above tells a PROVABLY stale record (`true`) apart from real unshipped
      // work. It left the third answer collapsed into the second: when corroboration was ASKED FOR and
      // came back UNDETERMINED — `lastDeploySha === null` (the deploy history could not be read) or
      // `baselineIsBehindLastDeploy === null` — `!== true` is satisfied and this branch emitted the
      // same flat accusation it emits for a record confirmed CURRENT. This type's own doc says
      // «`null` = undetermined (which is not "no")» and the problem text twenty lines up says «an
      // undetermined answer must not read as "the record is current"»; the accusation site did exactly
      // that. It is AGENTS.md's owner-locked UNKNOWN→NO class — a failed read rendered as a confident
      // negative — inside the barrier built to stop this very accusation being false.
      //
      // Measured on 2026-09-18 from a cloud session, which cannot reach the deploy history at all and
      // therefore hits this path EVERY run: the check named 11 commits and 16 user-visible files as
      // MERGED AND NOT SHIPPED. Probing the served bundle for per-commit discriminators showed 10 of
      // the 11 were live — `rakez`/`suwar` (70ae4dc, 76fdf71), `{rest} at once` and not `{next} at
      // once` (753bdfa), `id, meta, updated_at` (f9ef500) — while production carried neither
      // `loc_city_cluster:` nor `resolved without data`, so exactly ONE commit (3e93123) was genuinely
      // unshipped. ops_incident #227 has stood P1 since 2026-09-13 on a reader trying to disprove this
      // list by hand, and #264 before it cost four routines a day.
      //
      // Both answers still FAIL — an unverifiable record is an unanswered question (the problem for
      // that is pushed above, and is what keeps this red). What changes is only what a FAILING path
      // CLAIMS: the diff is still named in full, file for file and commit for commit, so no signal is
      // lost; it is simply no longer asserted to be unshipped when nothing established that it is.
      const recordCorroborated = !(r.lastDeploySha === null || r.baselineIsBehindLastDeploy === null);
      // The commit list carries the same claim as the sentence above it, so its LABEL moves with the
      // branch too — «not served» is an assertion, and an uncorroborated record cannot make it.
      const commits = (r.commitLine ?? []).length
        ? `\n      commits ${recordCorroborated ? 'merged and not served' : 'in this diff (served or not — UNKNOWN this run)'}:`
          + `\n        ${(r.commitLine ?? []).join('\n        ')}`
        : '';
      problems.push(
        recordCorroborated
          ? `${visible.length} user-visible file(s) differ between the commit production is recorded to `
            + `serve (${r.baselineSha}) and the head under test (${r.headSha}) — that work is MERGED AND `
            + 'NOT SHIPPED, so every user is still meeting the behaviour it repairs.'
            + `\n      files: ${visible.slice(0, 12).join(', ')}${visible.length > 12 ? ` … +${visible.length - 12} more` : ''}`
            + commits
            + '\n      Remedy: dispatch .github/workflows/deploy-frontend.yml (reason, confirm=DEPLOY) once '
            + 'the deploy gates are clear, then let scripts/record-deploy-baseline.sh advance the record. '
            + 'If the gates are NOT clear (e.g. migration_drift is red), that blockage is the finding — '
            + 'never clear this check by editing the baseline.'
          : `${visible.length} user-visible file(s) differ between the commit production is RECORDED to `
            + `serve (${r.baselineSha}) and the head under test (${r.headSha}) — but that record could `
            + 'NOT be corroborated this run, so whether this work is genuinely unshipped is UNKNOWN. It '
            + 'is therefore NOT asserted to be unserved: the record may simply be stale, and naming '
            + 'shipped commits as unshipped is what cost 2026-09-14 (ops_incident #264) and #227.'
            + `\n      files: ${visible.slice(0, 12).join(', ')}${visible.length > 12 ? ` … +${visible.length - 12} more` : ''}`
            + commits
            + '\n      Resolve the UNKNOWN first: read the deploy history (a full checkout plus GitHub API '
            + 'access), or probe the served bundle for a string that the recorded commit does not '
            + 'contain — a match proves the record stale without deriving a sha from bundle bytes. '
            + 'Only then is the list above an accusation. Never clear this check by editing the baseline.',
      );
    }
  }

  return problems;
}
