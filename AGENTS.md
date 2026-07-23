# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Production target (P0, non-negotiable — 2026-07-21)

**The production frontend lives at ONE URL only: `https://ezhalah-app.vercel.app`.** When the owner
says "deploy" / "test deploy" / "push it live," it means THIS URL — never a preview URL, never a
different Vercel project, never a different alias. This applies to every path that could put the
frontend live: `scripts/safe-deploy.sh`, any manual `vercel` command, any Vercel MCP tool, and any
future scheduled routine/agent. The canonical Vercel project is `ezhalah-app`
(projectId `prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX`, org `team_0lVrGRoJbCRIWovPNkfnmwJ7`).

Enforcement is in the tooling, not just here: `safe-deploy.sh` refuses to deploy unless
`.vercel/project.json` is provably linked to `ezhalah-app`, and after `vercel --prod` it asserts
that `ezhalah-app.vercel.app` is actually serving the just-deployed build (else it fails and prints
the `vercel promote` command). `preflight-verify.sh` re-checks the link. If any deploy path is ever
added that does NOT route through these scripts, it MUST carry the same two guards. There is no
`ezhalah.com`/other-project frontend deploy — the apex domain serves an unrelated app and is out of
scope (project memory `ezhalah-com-domain-not-serving-this-app`).

# Deploy rule (P0, non-negotiable — 2026-07-09)

If it's visible to users, it must be committed, pushed, and merged to `main` before it's ever
deployed. Never deploy a dirty or unpushed local working tree to production, even to "quickly fix"
something — that exact shortcut caused a P0 UI-rollback incident on 2026-07-09 (full story, pre-deploy
checklist, and emergency rollback procedure: `docs/DEPLOY_SAFETY.md`).

**Never run `vercel --prod` directly. Always run `scripts/safe-deploy.sh` instead** — it refuses to
deploy unless you're on `main`, the working tree is 100% clean, and local `main` matches
`origin/main` exactly. If it refuses, fix the underlying git state (commit → push → PR → merge) —
do not bypass it.

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
