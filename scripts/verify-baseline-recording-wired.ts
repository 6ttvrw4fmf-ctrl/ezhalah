#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-baseline-recording-wired — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * WHY THIS EXISTS (owner, 2026-09-11): every production deploy since 2026-09-06 has ended RED on
 * its final step — "Deploy frontend (production)" reports failure even though the deploy itself
 * shipped. Root cause, confirmed against the real run logs (34597666302 and five before it):
 *
 *   1. scripts/record-deploy-baseline.sh tries a direct push to main — correctly refused by branch
 *      protection (working as designed, not a bug).
 *   2. It falls back to pushing a `deploy/baseline-<sha>` branch — that push SUCCEEDS.
 *   3. It calls `gh pr create` to open the baseline PR — THIS fails:
 *        GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)
 *      because no `BASELINE_PR_TOKEN` repository secret exists, so the script falls back to the
 *      built-in `github.token`, which this repository's Settings → Actions → General policy blocks
 *      from creating pull requests at all — deliberately, and this barrier does not touch that
 *      policy. (Confirmed live: `gh secret list` does not include BASELINE_PR_TOKEN.)
 *
 * THIS IS A MISSING CREDENTIAL, NOT A CODE DEFECT — and it is owner-only to fix, the same class of
 * boundary as RESEND_API_KEY: add repository secret BASELINE_PR_TOKEN (a fine-grained PAT with
 * Contents: read+write and Pull requests: read+write on this repo). See the header of
 * scripts/record-deploy-baseline.sh for the exact steps. This barrier deliberately does NOT
 * recommend enabling "Allow GitHub Actions to create and approve pull requests" as an alternative —
 * that is a blanket repo-wide security relaxation, and the owner's instruction was explicit: do not
 * weaken a security/permission gate just to make a run green. The PAT is narrower (revocable, scoped
 * to this repo) and is what the script already prefers.
 *
 * WHAT THIS PINS INSTEAD, so the class of bug this repo has already been burned by twice — reporting
 * "production untouched" when it was NOT (SAFETY DEFECT FIXED 2026-08-05), and a baseline step that
 * silently no-ops on failure (the "Author identity unknown" incident, 2026-09-01 → 09-04, 3 days
 * stale) — can never come back even after the owner adds the token:
 *   • the deploy job keeps the permissions the fallback path needs (contents + pull-requests write);
 *   • BOTH the real-deploy step and the dry-run probe step keep passing GH_TOKEN and
 *     BASELINE_PR_TOKEN — the probe existing at all is what lets this be diagnosed WITHOUT deploying
 *     (AGENTS.md: never deploy to test the deploy pipeline);
 *   • the script keeps preferring BASELINE_PR_TOKEN over the built-in token, in that exact order;
 *   • push_to() keeps embedding the SELECTED token into the remote URL, rather than pushing on
 *     whatever credential the runner's checkout happened to persist;
 *   • total failure keeps being LOUD — the exact phrase "REFUSING TO ADVANCE THE BASELINE" is
 *     printed and the script exits non-zero; a silent `exit 0` here is exactly how the baseline sat
 *     stale for three days undetected;
 *   • the workflow's Report step's failure-detection grep is COUPLED to that exact phrase. This is
 *     the single most fragile fact in this whole path: if either file's wording drifts from the
 *     other — someone rewords the echo in the script, or rewords the grep in the workflow — the
 *     Report step silently stops recognising a real baseline failure and could misreport "production
 *     untouched" again, which is precisely the 2026-08-05 defect this repo already paid to fix once;
 *   • the script never merges its own baseline PR (no `gh pr merge` anywhere here) — the single
 *     sanctioned merge gate (scripts/safe-pr-merge.ts) stays the only door, exactly as documented.
 */
import { readFileSync } from 'node:fs';

const WORKFLOW = '.github/workflows/deploy-frontend.yml';
const SCRIPT = 'scripts/record-deploy-baseline.sh';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

/** Every way the baseline-recording path can silently stop working, or silently misreport. Pure —
 *  takes the two file contents as arguments, so it can be re-run against deliberately broken copies
 *  below as an executable proof, not just against the real files. */
export function auditBaselineWiring(yml: string, script: string): string[] {
  const bad: string[] = [];

  // The `deploy` job's permissions block. Sliced from `deploy:` to end-of-file rather than to a
  // next-job boundary: this workflow has exactly one job today (verified by hand — deploy-frontend.yml
  // has no `jobs:` sibling), and a regex guess at "is there still only one job" from indentation alone
  // is not reliable YAML parsing (workflow_dispatch: under `on:` shares indentation with deploy: under
  // `jobs:` in THIS file, coincidentally, not as a general rule) — a wrong guard here is worse than
  // no guard. If a second job is ever added, this slice needs a human to re-scope it, not a regex.
  const jobStart = yml.indexOf('\n  deploy:');
  const job = jobStart > -1 ? yml.slice(jobStart) : yml;
  const permsBlock = job.slice(job.indexOf('permissions:'), job.indexOf('permissions:') + 400);
  if (!/contents:\s*write/.test(permsBlock)) bad.push('the deploy job no longer grants contents: write — the fallback branch push would be refused before gh pr create is even reached');
  if (!/pull-requests:\s*write/.test(permsBlock)) bad.push('the deploy job no longer grants pull-requests: write — gh pr create would be refused even with a working token');

  // Both steps that can invoke record-deploy-baseline.sh (directly, or via --probe) must keep
  // passing both tokens — dropping either one from just ONE of the two steps re-creates this exact
  // failure for that path while looking fine in the other.
  const realDeployStep = yml.slice(yml.indexOf('Deploy via the sanctioned guarded entrypoint'), yml.indexOf('Post-deploy hydration gate'));
  const probeStep = yml.slice(yml.indexOf('Baseline recording path probe'), yml.indexOf('Deploy via the sanctioned guarded entrypoint'));
  for (const [label, step] of [['the real-deploy step', realDeployStep], ['the dry-run probe step', probeStep]] as const) {
    if (!/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(step)) bad.push(`${label} no longer passes GH_TOKEN — record-deploy-baseline.sh would have no token to fall back to at all`);
    if (!/BASELINE_PR_TOKEN:\s*\$\{\{\s*secrets\.BASELINE_PR_TOKEN\s*\}\}/.test(step)) bad.push(`${label} no longer passes BASELINE_PR_TOKEN — the script could never use the PAT even once the owner adds it`);
  }

  // The script must keep preferring the PAT over the built-in token, in that exact order — reversing
  // it would mean the built-in token (which this repo's policy blocks from creating PRs) is tried
  // FIRST even when a working PAT is present.
  if (!/GH_TOKEN="\$\{BASELINE_PR_TOKEN:-\$\{GH_TOKEN:-\$\{GITHUB_TOKEN:-\}\}\}"/.test(script))
    bad.push('the token preference order changed — BASELINE_PR_TOKEN must be tried before the built-in GH_TOKEN/GITHUB_TOKEN, never after');

  // push_to() must push AS the selected token, not as whatever credential the checkout persisted —
  // otherwise selecting BASELINE_PR_TOKEN above has no effect on what actually authenticates the push.
  if (!/x-access-token:\$\{GH_TOKEN\}@github\.com/.test(script))
    bad.push('push_to() no longer embeds the selected token into the remote URL — it would push on the checkout\'s own credential regardless of which token was chosen');

  // Total failure must stay LOUD. A record-deploy-baseline.sh that exits 0 having recorded nothing
  // is the exact shape of the 3-day-stale-baseline incident this file's own header describes.
  const FAILURE_PHRASE = 'REFUSING TO ADVANCE THE BASELINE';
  const lastFailureBlock = script.slice(script.lastIndexOf(FAILURE_PHRASE) - 40);
  if (!lastFailureBlock.includes(FAILURE_PHRASE)) bad.push(`the script no longer prints "${FAILURE_PHRASE}" on total failure — a future silent no-op would be undetectable again`);
  if (!/exit 1\s*$/.test(lastFailureBlock.trim().split('\n').slice(-1)[0] ?? '') && !lastFailureBlock.includes('exit 1'))
    bad.push('the final failure branch no longer exits non-zero — the step would report success while recording nothing');

  // THE COUPLING. This is the fact most likely to drift silently: the workflow's Report step decides
  // "did production change but the baseline step fail" by grepping the deploy log for this EXACT
  // phrase. If the script's wording changes without the workflow's grep changing to match, the
  // Report step stops seeing a real failure and can misreport "production untouched" — the precise
  // defect this repo fixed once already (2026-08-05) for a different cause.
  if (!yml.includes(`grep -q '${FAILURE_PHRASE}'`))
    bad.push(`the Report step's failure-detection grep is no longer coupled to "${FAILURE_PHRASE}" — it would stop recognising a real baseline failure`);
  if (!script.includes(FAILURE_PHRASE))
    bad.push(`the script's own failure phrase no longer contains "${FAILURE_PHRASE}" — the Report step's grep (above) would then match nothing, silently`);

  // The script must never become the second merge gate. AGENTS.md names ONE sanctioned door.
  if (/gh pr merge/.test(script))
    bad.push('the script now calls `gh pr merge` — this must stay a SECOND door only a human or scripts/safe-pr-merge.ts may open');

  return bad;
}

const yml = readFileSync(WORKFLOW, 'utf8');
const script = readFileSync(SCRIPT, 'utf8');

// ── MUTATION PROOF (executable — this audit is watched failing, not assumed to work) ──────────────
const mustCatch = (label: string, broken: string[]) =>
  check(`mutation caught: ${label}`, broken.length > 0, 'the audit passed deliberately broken source');

mustCatch('pull-requests: write dropped from the deploy job',
  auditBaselineWiring(yml.replace('pull-requests: write', 'pull-requests: read'), script));
mustCatch('contents: write dropped from the deploy job',
  auditBaselineWiring(yml.replace(/contents:\s*write/, 'contents: read'), script));
mustCatch('BASELINE_PR_TOKEN dropped from the real-deploy step only',
  auditBaselineWiring(
    yml.slice(0, yml.indexOf('Deploy via the sanctioned guarded entrypoint'))
      + yml.slice(yml.indexOf('Deploy via the sanctioned guarded entrypoint'), yml.indexOf('Post-deploy hydration gate'))
          .replace('BASELINE_PR_TOKEN: ${{ secrets.BASELINE_PR_TOKEN }}', '# removed')
      + yml.slice(yml.indexOf('Post-deploy hydration gate')),
    script));
mustCatch('the token preference order reversed',
  auditBaselineWiring(yml, script.replace(
    'GH_TOKEN="${BASELINE_PR_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}"',
    'GH_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${BASELINE_PR_TOKEN:-}}}"')));
mustCatch('push_to() stops embedding the selected token',
  auditBaselineWiring(yml, script.replace('x-access-token:${GH_TOKEN}@github.com', '${GH_TOKEN}@github.com')));
mustCatch('total failure becomes a silent no-op (exit 0)',
  auditBaselineWiring(yml, script.replace(
    /echo "❌ REFUSING TO ADVANCE THE BASELINE:[\s\S]*?exit 1\s*$/,
    'exit 0')));
mustCatch('the Report step\'s grep phrase drifts from the script\'s own wording',
  auditBaselineWiring(yml.replace("grep -q 'REFUSING TO ADVANCE THE BASELINE'", "grep -q 'BASELINE RECORDING FAILED'"), script));
mustCatch('the script starts merging its own baseline PR (a second door)',
  auditBaselineWiring(yml, script + '\ngh pr merge "$BRANCH" --squash\n'));

check('the audit passes on the real, unmodified files', auditBaselineWiring(yml, script).length === 0,
  auditBaselineWiring(yml, script).join('; '));

// ── the live rules ───────────────────────────────────────────────────────────────────────────────
for (const problem of auditBaselineWiring(yml, script)) check(problem, false);

// ── the actual, currently-missing piece — reported, not silently worked around ─────────────────────
// This is NOT part of the pass/fail audit above: it is a live, informational fact this barrier keeps
// in front of whoever reads its output, so "why does every deploy still end red" has one obvious
// place to look instead of a stale memory of a five-day-old investigation.
console.log('');
console.log('INFO  the missing piece is a repository secret, not code: add BASELINE_PR_TOKEN');
console.log('      (fine-grained PAT — Contents: read+write, Pull requests: read+write on this repo).');
console.log('      Owner-only action; see the header of ' + SCRIPT + '. Confirmed missing live via');
console.log('      `gh secret list` on 2026-09-11. This barrier deliberately does not suggest enabling');
console.log('      "Allow GitHub Actions to create and approve pull requests" instead — that widens a');
console.log('      repo-wide security setting rather than granting one scoped, revocable credential.');

if (failed) {
  console.error(`\n${failed} check(s) FAILED — the baseline-recording path could silently break or misreport again`);
  process.exit(1);
}
console.log('\nOK — baseline-recording wiring intact; the missing BASELINE_PR_TOKEN is a credential gap, not a code defect.');
