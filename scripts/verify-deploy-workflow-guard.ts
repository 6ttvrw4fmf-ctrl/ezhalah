// Deploy-workflow guard (owner-granted autonomy, 2026-08-04).
//
// .github/workflows/deploy-frontend.yml gives the engineering routines a way to ship the frontend
// without a laptop. That is only safe while the workflow keeps routing through the guarded
// entrypoint and stays a deliberate, manual act. A later edit could quietly turn it into
// deploy-on-push, point it at a different project, or replace safe-deploy.sh with a raw CLI call —
// each of which re-opens a P0 incident class (2026-07-09 dirty-tree rollback, 2026-07-15 concurrent
// deploys, 2026-07-21 off-target deploy).
//
// verify-no-vercel-bypass.ts already catches "someone added a raw production-deploy CLI call". This
// catches the subtler regressions it cannot see: the workflow drifting away from main, away from
// dispatch-only, or away from the canonical project constants.
//
// This is the same defect class that bit twice in 24h on 2026-08-03/04 — a later change rebuilding
// something from a stale base and silently dropping a guard (PR#289 reverting PR#286; migration
// 20260803194308 dropping a detector from mon_run_all_detectors). Machine-check it, don't trust it.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const WF = '.github/workflows/deploy-frontend.yml';
const GUARD = 'scripts/deploy-target-guard.sh';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ── Line-based helpers. Deliberately NOT regex with nested quantifiers.
// A previous version matched the deploy step with /- name:[^\n]*\n(?:\s+.*\n)*?\s+run:.../ which
// backtracks catastrophically the moment `run:` becomes a block scalar (`run: |`) instead of a
// one-liner — it hung for minutes on 2026-08-05 and would have hung CI. These are O(n).
const stripComments = (s: string) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** True if the workflow actually invokes safe-deploy.sh (block scalar or one-liner), ignoring comments. */
const invokesSafeDeploy = (body: string) => /scripts\/safe-deploy\.sh/.test(stripComments(body));

/** The step block (`- name:` … next `- name:`) whose body contains `needle`, comments ignored. */
function stepBlockContaining(body: string, needle: string): string | null {
  const lines = body.split('\n');
  let stepStart = -1;
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+-\s+(name|uses):/.test(lines[i])) stepStart = i;
    if (!/^\s*#/.test(lines[i]) && lines[i].includes(needle) && stepStart !== -1) { found = stepStart; break; }
  }
  if (found === -1) return null;
  let end = lines.length;
  for (let j = found + 1; j < lines.length; j++) {
    if (/^\s+-\s+(name|uses):/.test(lines[j])) { end = j; break; }
  }
  return lines.slice(found, end).join('\n');
}

if (!existsSync(WF)) {
  console.error(`❌ deploy-workflow-guard: ${WF} is missing.`);
  console.error('   The autonomous deploy path was removed. If that is intentional, remove this');
  console.error('   guard in the same commit and say so — do not leave a dangling check.');
  process.exit(1);
}

const wf = readFileSync(WF, 'utf8');

// ── 1. Manual dispatch ONLY. Never on push/schedule/pull_request. ────────────────────────────
// docs/DEPLOY_SAFETY.md: this repo deliberately does NOT use auto-deploy. A deploy must be a
// deliberate act against a known-good main, holding the lock.
const triggers = wf.match(/^on:\s*$([\s\S]*?)^[a-z]/mi)?.[1] ?? '';
check(/workflow_dispatch:/.test(triggers),
  'trigger: workflow_dispatch present',
  'workflow must be manually dispatchable (workflow_dispatch)');
for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'repository_dispatch:']) {
  check(!new RegExp(`^\\s+${forbidden.replace(':', ':')}`, 'm').test(triggers),
    `trigger: no ${forbidden} (stays a deliberate act)`,
    `workflow must NOT trigger on ${forbidden} — auto-deploy is forbidden (docs/DEPLOY_SAFETY.md)`);
}

// ── 2. Routes through the ONE sanctioned entrypoint. ─────────────────────────────────────────
check(invokesSafeDeploy(wf),
  'deploy step runs scripts/safe-deploy.sh',
  'workflow must deploy by running scripts/safe-deploy.sh (never a raw vercel command)');

// ── 3. Always deploys main, never the dispatching ref. ───────────────────────────────────────
check(/ref:\s*main\b/.test(wf),
  'checkout pinned to main',
  'checkout must pin `ref: main` — dispatching from a branch must still deploy main');
check(/fetch-depth:\s*0/.test(wf),
  'full history fetched (preflight ancestry checks resolvable)',
  'checkout needs `fetch-depth: 0` or preflight baseline-containment cannot resolve');

// ── 4. Canonical project, derived from the shared guard — never hardcoded divergently. ───────
// The workflow must SOURCE deploy-target-guard.sh rather than paste its own project id, so the
// production target lock has exactly one definition (same reason safe-deploy and preflight share it).
check(wf.includes(GUARD),
  'project link derived from scripts/deploy-target-guard.sh (single source of truth)',
  `workflow must source ${GUARD} for the project constants, not hardcode its own`);
const literalIds = wf.match(/prj_[A-Za-z0-9]+/g) ?? [];
check(literalIds.length === 0,
  'no hardcoded project id (cannot drift from the guard)',
  `workflow hardcodes project id(s) ${literalIds.join(', ')} — source the guard instead so the ` +
  'target lock cannot drift');

// ── 5. The secrets gate exists (fail readably, not 3 minutes into a build). ──────────────────
check(/secrets\.VERCEL_TOKEN/.test(wf),
  'uses secrets.VERCEL_TOKEN',
  'workflow must authenticate the Vercel CLI via secrets.VERCEL_TOKEN');
check(/secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(wf),
  'passes the service-role key so the deploy lock is acquired',
  'workflow must pass SUPABASE_SERVICE_ROLE_KEY — safe-deploy fails closed without the deploy lock');

// ── 6. A confirmation input, so a misclick cannot ship production. ───────────────────────────
check(/inputs\.confirm/.test(wf) && /!=\s*"DEPLOY"/.test(wf),
  'confirmation gate requires the literal DEPLOY input',
  'workflow must require an explicit DEPLOY confirmation input before deploying');

// ── 6b. If a dry-run escape hatch exists, it must be wired so the DEPLOY path is the one that is
// skipped — never the safety checks. A dry run that still reached safe-deploy.sh, or an inverted
// condition that skipped the deploy on a REAL run, would both be silent disasters. Only enforced
// when the input exists, so removing the dry-run feature entirely stays allowed.
if (/dry_run:/.test(wf)) {
  const deployStep = stepBlockContaining(wf, 'scripts/safe-deploy.sh');
  check(
    deployStep !== null && /if:\s*\$\{\{\s*!\s*inputs\.dry_run\s*\}\}/.test(deployStep),
    'dry_run skips the DEPLOY step (never the safety checks)',
    'a dry_run input exists but the safe-deploy.sh step is not gated on `if: ${{ !inputs.dry_run }}` —\n' +
      '     a dry run must be incapable of reaching the deploy, and a real run must never skip it',
  );
  check(/inputs\.dry_run\s*\}\}"?\s*=\s*"true"/.test(wf) || /"\$\{\{ inputs\.dry_run \}\}" = "true"/.test(wf),
    'dry_run is explicitly compared to the string "true" in the confirmation gate',
    'the confirmation gate must test dry_run explicitly rather than relying on shell truthiness');
}

// ── 7. The guard constants themselves still name the one production project. ─────────────────
if (existsSync(GUARD)) {
  const g = readFileSync(GUARD, 'utf8');
  check(/DTG_EXPECT_PROJECT_NAME="ezhalah-app"/.test(g),
    'target guard still pins project name ezhalah-app',
    'deploy-target-guard.sh no longer pins ezhalah-app as the production project');
  check(/DTG_CANONICAL_URL="https:\/\/ezhalah-app\.vercel\.app"/.test(g),
    'target guard still pins https://ezhalah-app.vercel.app',
    'deploy-target-guard.sh no longer pins https://ezhalah-app.vercel.app');
}

// ── 8. EVERY workflow that can deploy must carry these guards, not just the one named above. ──
// Sections 1-7 check `deploy-frontend.yml` BY NAME. That is a real hole: a second workflow that
// also calls safe-deploy.sh would inherit none of these checks. On 2026-08-04 23:29 a concurrent
// session opened PR#309 adding exactly that — a second `.github/workflows/deploy.yml` wrapping
// safe-deploy.sh — 28 minutes after deploy-frontend.yml had already merged. Neither session knew
// about the other (the same coordination failure as the 2026-07-15 triple-deploy incident).
//
// AGENTS.md: "If any deploy path is ever added that does NOT route through these scripts, it MUST
// carry the same guards." This enforces that for paths that DO route through them too — routing
// through safe-deploy.sh is necessary but not sufficient. Auto-deploy-on-push wrapped around
// safe-deploy.sh is still auto-deploy.
const WF_DIR = '.github/workflows';
if (existsSync(WF_DIR)) {
  const deployWorkflows = readdirSync(WF_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ file: `${WF_DIR}/${f}`, body: readFileSync(`${WF_DIR}/${f}`, 'utf8') }))
    // Only workflows that can actually RUN a deploy — a docs mention is not an entrypoint.
    .filter(({ body }) => invokesSafeDeploy(body));

  check(deployWorkflows.length > 0,
    `deploy entrypoints discovered: ${deployWorkflows.length}`,
    'no workflow runs scripts/safe-deploy.sh — the autonomous deploy path is gone');

  for (const { file, body } of deployWorkflows) {
    const trig = body.match(/^on:\s*$([\s\S]*?)^[a-z]/mi)?.[1] ?? '';
    const autoTrigger = ['push:', 'pull_request:', 'schedule:', 'repository_dispatch:']
      .find((t) => new RegExp(`^\\s+${t}`, 'm').test(trig));
    check(!autoTrigger,
      `${file}: dispatch-only`,
      `${file} deploys production but triggers on ${autoTrigger} — auto-deploy is forbidden`);
    check(/ref:\s*main\b/.test(body),
      `${file}: checks out main`,
      `${file} deploys production without pinning the checkout to main`);
    check(/inputs\.confirm/.test(body) && /!=\s*"DEPLOY"/.test(body),
      `${file}: requires the literal DEPLOY confirmation`,
      `${file} deploys production without a DEPLOY confirmation gate — a misclick would ship`);
    const ids = body.match(/prj_[A-Za-z0-9]+/g) ?? [];
    check(ids.length === 0,
      `${file}: no hardcoded project id`,
      `${file} hardcodes ${ids.join(', ')} instead of sourcing ${GUARD} — it can drift off-target`);
  }
}

// ── 9. The run summary must never claim production is untouched when it actually deployed. ────
// SAFETY DEFECT 2026-08-05: the Report step branched on `job.status` alone and printed "nothing was
// deployed and production is untouched" on ANY failure. At 09:11 that day the deploy SUCCEEDED (the
// alias moved to entry-19ac2cd5…) and only the post-deploy schema-drift baseline advance failed —
// and the summary reported production as untouched. A false all-clear on a live production change
// is the worst class of report: the reader stops investigating and never rolls back.
//
// `job.status` cannot distinguish "refused before deploying" from "deployed, then a later check
// failed". The report must therefore decide from EVIDENCE in the captured safe-deploy log.
const LOGFILE = '/tmp/safe-deploy.log';
check(new RegExp(`tee\\s+${LOGFILE.replace(/\//g, '\\/')}`).test(wf),
  'deploy step captures safe-deploy output to a log',
  `the deploy step must tee safe-deploy.sh output to ${LOGFILE} — without it the report has no\n` +
  '     evidence and can only guess from job.status, which is what caused the false all-clear');

check(/set -o pipefail/.test(wf),
  'pipefail set so tee cannot mask a deploy failure',
  'piping safe-deploy.sh into tee without `set -o pipefail` makes the step pass even when the deploy fails');

for (const marker of ['NOTHING WAS DEPLOYED', 'DEPLOY SUCCEEDED', 'POST-DEPLOY VERIFICATION FAILED']) {
  check(wf.includes(marker),
    `report distinguishes the "${marker}" outcome`,
    `the run summary must have a distinct "${marker}" outcome — collapsing deployed and\n` +
    '     not-deployed into one failure message is the 2026-08-05 reporting defect');
}

// Ordering check: the report must derive "did it ship?" from the log BEFORE it is allowed to make
// any "untouched" claim. This is what makes the claim conditional on evidence rather than on state.
// Comments are stripped first: prose *describing* the defect legitimately says "untouched", and
// only executable lines can actually mislead a reader of the run summary.
const wfCode = stripComments(wf);
const shipsFromLog = wfCode.search(/grep[^\n]*"\$LOG"/);
const firstUntouched = wfCode.search(/untouched/);
check(firstUntouched === -1 || (shipsFromLog !== -1 && shipsFromLog < firstUntouched),
  'any "production is untouched" claim is gated on log evidence, not job.status',
  'the report claims production is "untouched" without first deriving from the safe-deploy log\n' +
  '     whether a deployment actually shipped — this is exactly the 2026-08-05 false all-clear');

console.log('deploy-workflow-guard: the autonomous deploy path must keep every safety property');
for (const line of ok) console.log(`  ✓ ${line}`);

if (problems.length > 0) {
  console.error('\n❌ deploy-workflow-guard: the production deploy workflow lost a safety property:');
  for (const p of problems) console.error(`     • ${p}`);
  console.error('\n   These properties are what make an agent-triggerable deploy safe. Restore them.');
  console.error('   Deliberately changing the deploy architecture is an OWNER decision (AGENTS.md).');
  process.exit(1);
}

console.log('\n✓ deploy-workflow-guard: passed.');
