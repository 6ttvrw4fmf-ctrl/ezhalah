# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Read this first — canonical rules + token efficiency (owner rule, 2026-08-10)

**`docs/ARCHITECTURE.md` is the canonical rule source. Read it before re-deriving anything, and before
opening any historical audit/report file (`AUDIT_REPORT.md`, `BACKEND_AUDIT.md`,
`PRODUCTION_AUDIT_2026-07-17.md`, old PR descriptions, etc.).** Those historical files are point-in-time
snapshots, kept for provenance — they are NOT where current rules live and most of their findings are
already fixed. If `ARCHITECTURE.md` §20 (Permanent rules), §21 (Open questions), `docs/ops/
AGENT_AUTHORITY.md`, `docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md`, or `docs/ops/
EZHALAH_DATA_ARCHITECTURE_GOAL.md` already answer the question, cite it — do not re-read a giant old
report to re-derive the same fact.

**Owner-granted engineering/product decisions belong in this repo, not just in an agent's own memory.**
When the owner gives you a permanent rule, architecture decision, or business/compliance decision:
land it in `docs/ARCHITECTURE.md` (or the relevant `docs/ops/*.md`) in the same session, not only in
your own memory system — a future session (or a different agent/tool entirely) must be able to recover
it by reading the repo, without replaying this conversation. Consolidate overlapping rules into one
canonical statement instead of letting duplicates accumulate; if you find a stale fact while working
nearby, fix it in the same edit.

**Token/context discipline (applies to every session, every routine):**
- Query only the columns/rows/lines needed to answer the current question — don't dump full SQL
  results, logs, payloads, or whole source files into context when a targeted read/grep answers it.
- Don't spawn multiple agents for a simple check; use parallel agents only when they cover genuinely
  independent work or materially save wall-clock time.
- Reports: **issue → root cause → fix → regression barrier → production verification → before/after.**
  Full evidence dumps only when something is disputed or needs an owner decision.
- Before a large investigation, check whether the answer already exists in `docs/`, git history, or a
  monitor/dashboard before re-discovering it from scratch.
- None of this trades away rigor: fix → regression test → verify → deploy still applies in full: it
  just runs on targeted reads instead of wholesale context dumps.

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

**The production lock has exactly ONE identity: `production`.** Since 2026-08-10 the database
canonicalises every production-scoped alias (`prod`, `prod-change`, `PROD_DB`, `prd`, `live`,
`deploy`, any `prod*`) onto that one row, so an alias can no longer create a *second* lock that
excludes nobody. That bug was real and observed live: on 2026-08-10 `daily-health-check` held
`'prod'` while another session held `'production'`, and later `audit-fix` held `'prod-change'`
against `'production'` — in both windows two sessions each believed they held THE deploy lock.
Still write `'production'`: aliases now work, but `mon_detect_deploy_lock_misuse()` raises a P2
naming any caller that uses one, and unrelated named locks (e.g. `gathern_liveness_apply`) keep
their own identity and are unaffected.

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

# Migration drift guard (P0, non-negotiable — 2026-08-10)

**Every migration applied to production MUST also be committed to `supabase/migrations/` in this
repo — this is enforced continuously, not just at deploy time.** Applying a migration directly to
production via the Supabase MCP `apply_migration` (a normal, expected pattern per "Deployment
lock" above — concurrent sessions do this routinely) and then forgetting to commit the SQL is
schema drift, and it is not a paperwork problem: it is the exact precondition of the 2026-07-16
PGRST203 search outage (a migration applied via MCP left a duplicate function overload that was
never in git, so nobody could see it coming) and it has recurred at least twice since (daily-
engineer heartbeats on 2026-08-04 and 2026-08-10 each independently found 20-30+ migrations applied
to prod with zero git record, discovered up to 24h after the fact).

**If you apply a migration via MCP, commit the identical SQL to `supabase/migrations/` in the same
session, before you consider the work done.** `apply_migration` mints its own server-side version
timestamp — copy the SQL verbatim into a file named `<that timestamp>_<a name>.sql` (or recover it
later from `supabase_migrations.schema_migrations.statements`, which is exact and queryable).

**You do not have to catch your own drift by memory — the barrier catches it for you, continuously:**
- `scripts/verify-migration-drift-vs-production.ts` asks `ops_deploy_preflight_checks` (the same
  RPC `scripts/safe-deploy.sh` already gates deploys on) whether every migration live in production
  is present in git. It is wired into `npm test` (`full-verification-ci.yml`), so drift already
  goes red on the very next push or PR to `main` — anyone's, not just the one that caused it.
- `.github/workflows/migration-drift-guard.yml` runs that same check **every 15 minutes**,
  independent of any push — because the failure mode this exists for is a session that applies a
  migration and pushes nothing at all, which a push-triggered check alone would never catch. On
  drift it fails the job loudly (a GitHub Actions red X) **and** raises a P1 `alert_event` row
  (`kind='migration_drift'`) via `mon_raise`, so it shows on the ops dashboard too — not just
  something a human has to notice in the Actions tab. It self-heals via `mon_resolve_key` the next
  time it runs clean.
- Both `scripts/safe-deploy.sh` and the continuous checker build "what migrations does the repo
  claim" from the ONE shared `scripts/build-repo-migration-versions.cjs` — `scripts/verify-
  migration-drift-guard-wired.ts` (also in `npm test`) fails if either script stops using it (two
  independent copies of that parser is its own drift risk) or if any piece of this barrier goes
  missing, gets a loosened schedule, or stops being invoked.

**If `migration_drift` is ever red:** recover the missing SQL verbatim from
`supabase_migrations.schema_migrations.statements` (matched by `version`) into
`supabase/migrations/`, commit, and open a PR — this itself touches `supabase/migrations/`, so per
the daily/senior routine rules it stays OPEN for review, never self-merged by an autonomous run.
