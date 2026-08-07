# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Autonomous engineering authority (owner-granted, 2026-08-04)

**The engineering routines are AUTONOMOUS for safe operational work. Finding a safe production bug
and then asking the owner whether to fix it is a FAILURE, not caution.**

The full contract — the GREEN list (do it, don't ask), the RED list (stop and ask), and the
execution rules that GREEN work still obeys — is **`docs/ops/AGENT_AUTHORITY.md`**. Read it before
deciding to escalate anything. It governs both the Senior Production Engineer and the
Junior/Beginner Daily Engineer routines, and it OVERRIDES any routine prompt that is more timid
than it (routine prompts live outside this repo and drift; this file does not).

The expected loop, end to end, without check-ins:

> CHECK → INVESTIGATE → ROOT CAUSE → FIX → TEST → REGRESSION PROTECT → COMMIT/PUSH → PR/MERGE →
> DEPLOY/APPLY → VERIFY PRODUCTION → REPORT

Summary of the split (the linked file is authoritative):

- **Do it, don't ask:** scraper/parser fixes, defect fixes in `src/`, tests and regression guards,
  monitors/detectors/cron/ops DB objects, evidence-backed data repairs that restore documented
  behaviour, restoring an already-approved behaviour that isn't actually working, commit/push/PR,
  self-merge on green CI within those paths, applying migrations, deploying the frontend **when a
  verified change genuinely requires it**, and verifying production afterwards.
- **Still requires owner approval:** business/product decisions; taxonomy changes; Region → City →
  District architecture; bulk or destructive listing operations; *new* search/product semantics;
  destructive or high-risk schema changes; anything not easily reversible; weakening a safety gate
  or adding a deploy entrypoint; genuine ambiguity.

**Autonomy is walking through the safety gates yourself — never removing or routing around them.**
Every P0 rule below (production target lock, deploy lock, `safe-deploy.sh` as the only frontend
deploy path, preflight, taxonomy gate, no-bypass check, source-fidelity rules) remains fully in
force and is unchanged by this grant. An agent blocked by a gate has found a real problem or a real
owner decision — it must not loosen the gate to get past it.

Two rules that exist specifically to stop autonomy becoming recklessness:

1. **Never deploy to test the deployment pipeline.** A production deploy requires a real, verified
   change that actually needs one. `Deployments: 0` is a perfectly good result.
2. **Evidence before the write, proof after it.** Capture the defect first; land a regression test
   that fails on the old code and passes on the new one; then report status honestly using the
   FIXED+VERIFIED / PROPAGATION PENDING / AWAITING FIRST PRODUCTION EXECUTION / BLOCKED vocabulary.

# Production target (P0, non-negotiable — 2026-07-21)

**The production frontend lives at ONE URL only: `https://ezhalah-app.vercel.app`.** When the owner
says "deploy" / "test deploy" / "push it live," it means THIS URL — never a preview URL, never a
different Vercel project, never a different alias. This applies to every path that could put the
frontend live: `scripts/safe-deploy.sh`, any manual `vercel` command, any Vercel MCP tool, and any
future scheduled routine/agent. The canonical Vercel project is `ezhalah-app`
(projectId `prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX`, org `team_0lVrGRoJbCRIWovPNkfnmwJ7`).

Enforcement is in the tooling, not just here. The link + alias predicates live in ONE place,
`scripts/deploy-target-guard.sh` (constants `DTG_EXPECT_PROJECT_*` + `dtg_link_is_canonical` +
`dtg_alias_serves`), which BOTH `safe-deploy.sh` and `preflight-verify.sh` source — so they cannot
drift. `safe-deploy.sh` refuses to deploy unless `.vercel/project.json` is provably linked to
`ezhalah-app`, and after `vercel --prod` it asserts (via `dtg_alias_serves`) that
`ezhalah-app.vercel.app` is actually serving the exact just-deployed bundle — else it FAILS and
prints the `vercel promote` command, never reporting success on an alias that didn't move.
`preflight-verify.sh` re-checks the link.

This is regression-tested and CI-enforced permanently:
- `scripts/verify-deploy-target-guard.ts` (in `npm test`) proves canonical→allowed, any other
  project→refused, exact-bundle match→ok, alias-didn't-move→refused, AND that the shipping scripts
  still source the shared guard (no re-inlined divergent copy).
- `scripts/verify-no-vercel-bypass.ts` (in `npm test`) fails if a raw `vercel --prod|deploy|promote|
  alias|rollback` (or `deploy_to_vercel`) command appears in ANY tracked file outside the sanctioned
  deploy scripts — so no future script/workflow/automation can deploy the frontend without routing
  through `safe-deploy.sh`. A genuinely new sanctioned entrypoint must carry the same guards AND be
  added to that file's allowlist (a deliberate, reviewed change).
- `.github/workflows/deploy-guard-ci.yml` runs both on every PR and every push to `main`.

If any deploy path is ever added that does NOT route through these scripts, it MUST carry the same
guards (and will otherwise trip the no-bypass check). There is no `ezhalah.com`/other-project
frontend deploy — the apex domain serves an unrelated app and is out of scope (project memory
`ezhalah-com-domain-not-serving-this-app`).

# Deploy rule (P0, non-negotiable — 2026-07-09)

If it's visible to users, it must be committed, pushed, and merged to `main` before it's ever
deployed. Never deploy a dirty or unpushed local working tree to production, even to "quickly fix"
something — that exact shortcut caused a P0 UI-rollback incident on 2026-07-09 (full story, pre-deploy
checklist, and emergency rollback procedure: `docs/DEPLOY_SAFETY.md`).

**Never run `vercel --prod` directly. Always run `scripts/safe-deploy.sh` instead** — it refuses to
deploy unless you're on `main`, the working tree is 100% clean, and local `main` matches
`origin/main` exactly. If it refuses, fix the underlying git state (commit → push → PR → merge) —
do not bypass it.

## How an agent session actually ships a frontend fix (2026-08-06)

**No agent session holds the deploy credentials, and none ever should.** `safe-deploy.sh` needs
`VERCEL_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY`; a cloud routine has neither, and its egress proxy
blocks Vercel and Supabase REST anyway. That is the design, not a fault: production secrets live in
**GitHub Actions repository secrets**, never in an agent's environment.

The deploy therefore runs *in CI*, not in your container. Dispatch the
**`Deploy frontend (production)`** workflow (`.github/workflows/deploy-frontend.yml`,
`workflow_dispatch`) — e.g. the GitHub MCP `actions_run_trigger` / `run_workflow`, or the Actions UI:

| input | value |
|---|---|
| `reason` | why this deploy is needed (recorded in the deploy-lock note) |
| `confirm` | `DEPLOY` — exact literal, or a real deploy hard-fails |
| `dry_run` | `true` to verify secrets + token + target lock and **stop without deploying** |

That workflow runs `scripts/safe-deploy.sh` **and nothing else**, so every gate in this file still
applies unchanged, in the same order, and still fails closed. It contains no raw `vercel` command,
which is why `verify-no-vercel-bypass.ts` stays green. This is not a bypass — it is the same
entrypoint, given credentials you are deliberately not trusted with.

**Therefore: "frontend fix completed but deployment BLOCKED because this environment cannot deploy"
is NOT an acceptable report.** It was accurate about `safe-deploy.sh` locally and wrong about the
system. If a verified change genuinely needs a frontend deploy, dispatch the workflow, watch the
run, then verify `https://ezhalah-app.vercel.app` per `docs/ops/VERIFYING_PRODUCTION.md`. Report
BLOCKED only if the dispatch itself is refused, and say exactly what refused it.

Two things this does **not** change:
1. **Still never deploy without a verified change that requires one.** No `src/` diff since the live
   commit ⇒ no deploy. `Deployments: 0` remains a correct, successful run. Use `dry_run` to prove
   the pipeline is healthy — never a real deploy.
2. **Read the workflow's own Report step before you believe an outcome.** A run marked `failure`
   may still have SHIPPED (2026-08-05: the deploy succeeded and only the post-deploy baseline
   advance failed). Never report "production untouched" from job status alone.

# Deployment lock (P0, non-negotiable — 2026-07-16)

**Multiple Claude/agent sessions can run against this repo and this Supabase project at the same
time.** On 2026-07-15 this caused a real incident: one session deployed an unapproved PR to
production, and while a second session was mid-revert, a THIRD session deployed `main` directly —
at a moment it still had the bug — re-breaking production a second time, with zero coordination
between the sessions. Full story: project memory `pr78-outage-rollback-2026-07-15`.

**Before ANY action that changes what's live in production** — running `scripts/safe-deploy.sh` or
`scripts/emergency-rollback.sh`, calling `npx vercel --prod` / `npx vercel rollback` directly, or
using a Vercel MCP tool (e.g. `deploy_to_vercel`, or any tool that changes a deployment alias) —
**you must hold the deploy lock.**

`scripts/safe-deploy.sh` and `scripts/emergency-rollback.sh` already acquire and release it for
you automatically (see `scripts/deploy-lock.sh`) **when `SUPABASE_SERVICE_ROLE_KEY` is set in the
shell.** If it is not set, those scripts fail closed (refuse to deploy) rather than proceeding
unlocked — do not work around this by exporting a key from an untrusted source or bypassing the
script.

**If you are calling a Vercel MCP tool directly (not going through the scripts above)**, you must
acquire the lock yourself via the Supabase MCP `execute_sql` tool, on project `aannarbkwcymrotzwdbo`,
immediately before the deploy/rollback action, and release it immediately after:

```sql
-- 1. Acquire (before deploying) — a non-empty result means you hold it:
select * from acquire_deploy_lock('production', '<your session id or a short description>', 600, '<what you are about to do>');
-- If this returns ZERO rows, another session holds the lock — DO NOT deploy. Tell the user who
-- holds it (query `select * from ops_deploy_lock;`) and wait, or ask the user how to proceed.

-- 2. ... do the deploy/rollback ...

-- 3. Release (always, even if the deploy failed):
select release_deploy_lock('production', '<the exact holder string you used above>');
```

The lock self-expires after 10 minutes (`p_ttl_seconds`, default 600) so a crashed/killed session
can never permanently block deploys — but always release explicitly rather than relying on the
TTL. See `docs/DEPLOY_SAFETY.md` "Deployment lock" and `supabase/migrations/20260716_deploy_lock.sql`
for the full design.
