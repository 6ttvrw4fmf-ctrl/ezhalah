# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

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

**GitHub Actions deploy bridge (added 2026-08-04):** `.github/workflows/deploy.yml` is a
manual-trigger-only (`workflow_dispatch`) wrapper around `scripts/safe-deploy.sh` — same script,
same gates (deploy lock, preflight, taxonomy, target lock, env check, post-deploy verification,
drift gate), zero bypass, CI-enforced by `scripts/verify-no-vercel-bypass.ts`. Full runbook:
`docs/DEPLOY_SAFETY.md` "GitHub Actions deploy bridge". This is how you ship a frontend fix without
a terminal:

- **When to trigger it yourself (Daily or Senior routine):** the fix is already merged to `main`
  (you did not just merge it yourself as part of this same run unless Hard Rule 3 / the Senior
  routine's own merge authority explicitly allows it), it's a `src/` or `supabase/functions/`
  change with no other open concerns, and you have GitHub Actions `workflow_dispatch` permission on
  this repo. Call the GitHub MCP `actions_run_trigger` tool: `method: run_workflow`,
  `workflow_id: "deploy.yml"`, `ref: "main"`, `inputs: {"reason": "<what and why>", "holder": "<your
  routine name + date>"}`. Then report the run URL and result — do not ask the owner to press the
  button themselves if you were able to dispatch it.
- **If dispatch fails with a permission error** (e.g. "Resource not accessible by integration"):
  your session does not currently hold `actions:write` on this repo — this was the case for every
  session tested as of 2026-08-04. Fall back to asking the owner to trigger it (GitHub UI: Actions →
  "Deploy to production" → Run workflow), exactly as before this bridge existed. Say so plainly;
  do not silently skip the deploy or claim it happened.
- **Not every fix needs this.** A DB-only migration ships via the Supabase MCP deploy-lock protocol
  directly (see "Deployment lock" below) — never via this workflow. A `scrapers/**`-only change
  needs no deploy step at all: merging to `main` is enough, the existing scraper workflows always
  run whatever is on `main`. Only dispatch `deploy.yml` for a change that actually needs a Vercel
  build to take effect.

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
