// AGENTS.md must tell an agent HOW to ship a frontend fix without credentials (2026-08-06).
//
// THE FAILURE THIS PINS. The guarded CI deploy path has existed since 2026-08-04
// (.github/workflows/deploy-frontend.yml, dispatch-only, runs safe-deploy.sh with the secrets held
// in GitHub). It works: it shipped production twice. But AGENTS.md — the one file that loads into
// EVERY session and that explicitly overrides any routine prompt more timid than itself — said only
// "always run scripts/safe-deploy.sh". A cloud routine reads that, finds it holds neither
// VERCEL_TOKEN nor SUPABASE_SERVICE_ROLE_KEY, and concludes the deploy is impossible.
//
// That is exactly what happened on 2026-08-06: the Senior audit reported "frontend deployments
// cannot be safely executed from this environment … label the deployment step BLOCKED" while a
// fully working, fully guarded deploy path sat one API call away. Nothing was broken; the
// instructions simply did not mention the path. A capability nobody knows about is not a capability.
//
// So this guard protects a SENTENCE, not a script — because the missing sentence was the whole bug.
// verify-deploy-workflow-guard.ts already proves the workflow stays safe; this proves an agent will
// be told it exists. Both are needed: a safe path nobody uses ships nothing.
//
// Deliberately OFFLINE (reads only tracked repo files) to match the other verifiers in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-agent-deploy-path-documented.ts
import { readFileSync, existsSync } from 'node:fs';

const AGENTS = 'AGENTS.md';
const WF = '.github/workflows/deploy-frontend.yml';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const md = readFileSync(AGENTS, 'utf8');

// 1. The workflow AGENTS.md points at must actually exist — a doc pointing at nothing is worse
//    than no doc, because the reader trusts it and then finds a dead end.
check(existsSync(WF),
  `${WF} exists`,
  `${AGENTS} documents a CI deploy path but ${WF} is missing — the documented path is a dead end`);

// 2. AGENTS.md must name the workflow, by file or by title, so the agent can find it.
check(/deploy-frontend\.yml/.test(md) || /Deploy frontend \(production\)/.test(md),
  'AGENTS.md names the guarded deploy workflow',
  `${AGENTS} never names the deploy workflow — an agent without credentials cannot find the path ` +
  `and will report BLOCKED (the 2026-08-06 failure)`);

// 3. It must say the deploy is DISPATCHED, not run locally. Naming the file is not enough if the
//    reader still thinks their only option is a local script they cannot run.
check(/workflow_dispatch|actions_run_trigger|run_workflow|Actions UI/i.test(md),
  'AGENTS.md explains that the deploy is dispatched, not run locally',
  `${AGENTS} names the workflow but never says how to TRIGGER it`);

// 4. The two inputs that decide whether production changes must both be documented. `confirm:
//    DEPLOY` is the misclick guard; `dry_run` is how the pipeline gets verified WITHOUT deploying,
//    which is what makes "never deploy to test the pipeline" a followable rule rather than a bind.
check(/\bDEPLOY\b/.test(md) && /confirm/i.test(md),
  'AGENTS.md documents the confirm: DEPLOY literal',
  `${AGENTS} must document the exact confirm literal, or an agent's real deploy silently hard-fails`);
check(/dry[_ ]run/i.test(md),
  'AGENTS.md documents dry_run as the no-deploy capability check',
  `${AGENTS} must document dry_run — without it, proving the pipeline healthy requires a real ` +
  `deploy, which AGENTS.md forbids`);

// 5. The false report must stay explicitly forbidden. This is the actual regression risk: someone
//    trims the section to "use the workflow" and drops the sentence that stops the bad report.
check(/BLOCKED/.test(md) && /not an acceptable report|NOT an acceptable report/.test(md),
  'AGENTS.md forbids the "cannot deploy from this environment" report',
  `${AGENTS} must explicitly rule out reporting a frontend fix as BLOCKED-for-lack-of-credentials`);

// 6. Adding a deploy path must NOT quietly become "deploy freely". The no-useless-deploy rule and
//    the guarded entrypoint must both survive in the same file.
check(/safe-deploy\.sh/.test(md),
  'AGENTS.md still names safe-deploy.sh as the entrypoint',
  `${AGENTS} lost the safe-deploy.sh requirement while gaining the CI path — that IS the bypass ` +
  `this repo exists to prevent`);
check(/Deployments: 0|deployments correctly = 0|`Deployments: 0`/i.test(md) ||
      /never deploy to test the deployment pipeline/i.test(md),
  'AGENTS.md still says a zero-deploy run is correct',
  `${AGENTS} must keep the "no verified change ⇒ no deploy" rule alongside the new capability`);

// 7. The workflow must still be dispatch-only. If a future edit makes it deploy-on-push, the
//    sentence AGENTS.md now carries ("a deploy is a deliberate act") becomes a lie.
const wf = existsSync(WF) ? readFileSync(WF, 'utf8') : '';
const triggers = wf.match(/^on:\s*$([\s\S]*?)^[a-z]/mi)?.[1] ?? '';
check(!/\bpush:/.test(triggers),
  'the documented workflow is still dispatch-only (no push trigger)',
  `${WF} gained a push trigger — AGENTS.md now documents it as a deliberate act, which would be false`);

console.log('agent-deploy-path-documented: an agent must be able to FIND the guarded deploy path\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — a future agent will report a frontend fix as BLOCKED.`);
  process.exit(1);
}
console.log('\n✅ agent-deploy-path-documented: passed.');
