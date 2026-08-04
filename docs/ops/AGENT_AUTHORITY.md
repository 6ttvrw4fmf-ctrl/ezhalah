# Engineering agent authority (owner-granted, 2026-08-04)

The single source of truth for what the **Senior Production Engineer** and **Junior/Beginner Daily
Engineer** routines may do on their own, and what still stops for the owner.

Both routines are configured at claude.ai, and their prompts can drift apart. This file cannot: it
lives in the repo, it is referenced from `AGENTS.md` (which loads into every session and overrides
default behaviour), and it is machine-checked by `scripts/verify-agent-authority-contract.ts`. When
a routine prompt and this file disagree, **this file wins** — and the disagreement is a bug to fix
in the prompt.

## The intent, in one line

> Find a safe production bug → fix it → test it → protect against regression → land it → apply it →
> verify production → **tell the owner what you did.** Do not ask permission to do your job.

The owner's words (2026-08-04): *"I do not want them finding a safe bug and then asking me to tell
them to fix it."*

## What autonomy does NOT mean

Autonomy is **walking through the safety gates yourself** — never removing them, never routing
around them. Every P0 guard in `AGENTS.md` stays in force, unchanged:

- the production target lock (`ezhalah-app` only),
- the deploy lock,
- `safe-deploy.sh` as the only frontend deploy entrypoint,
- preflight / baseline containment / taxonomy gate,
- the no-bypass check,
- source-fidelity rules (never invent, round, or "correct" a source-published value).

An agent that cannot get through a gate has found either a real problem or a genuine owner
decision. It must NOT loosen the gate to proceed.

---

## GREEN — do it, do not ask

Applies to both routines unless a line says Senior-only.

### Investigate & diagnose
Read anything. Query production read-only. Run tests, scripts, and read-only RPCs. Re-fetch a
source page to check fidelity. Dispatch a scraper/liveness workflow to gather evidence.

### Fix code
- Scraper/parser defects (`scrapers/**`) — including source-format changes, mis-parsed fields,
  free-text leaks, unit/decimal errors.
- Frontend and shared code (`src/**`) **when fixing a defect** — a wrong result, a crash, a race,
  an inverted intent, a value that contradicts its source. Not redesigns; not new features.
- Verification scripts, tests, fixtures (`scripts/verify-*`, `**/tests/**`, `e2e/**`).
- Docs, `sql/mirrors/**`, ops metadata.

### Fix the database
- Monitors, detectors, alerting, cron schedules, refresh ordering, operational tables, idempotency
  bugs in operational logging, indexes, deploy-lock objects.
- **Data repairs that restore already-documented intended behaviour**, with row-level evidence
  captured before the write, and a bounded, stated blast radius.
- **Restoring an already-approved behaviour that is not actually working** — e.g. an owner-approved
  gate that leaks on an unmeasured path. Restoring approved intent is GREEN.
  *Introducing new search/product semantics is RED (see below).*

### Land the work
- Branch, commit, push.
- Open a PR.
- **Merge your own PR** once CI is green and the diff stays inside GREEN paths.
- Record every applied migration as a `supabase/migrations/<exact-prod-version>_<name>.sql` file.
  Production and git must never diverge.

### Ship and verify
- Apply DB changes directly (holding the deploy lock).
- **Deploy the frontend** — via the `Deploy frontend (production)` workflow or `safe-deploy.sh`,
  **only when a verified change actually requires a frontend deploy**. Never deploy to prove the
  pipeline works, and never deploy an unverified change.
- Verify the real production path afterwards, then report.

---

## RED — stop and ask the owner

State clearly: **⚠️ I NEED YOUR APPROVAL**, with the evidence and the exact proposed change.

1. **Business / product decisions** — what the product should do, pricing, ranking, what users see
   by design.
2. **Taxonomy changes** — adding/removing/re-parenting property category, group, or type.
3. **Location architecture** — Region → City → District hierarchy. (Mapping a source string to an
   *existing* canonical value with attested evidence is GREEN; changing the hierarchy is RED.)
4. **Bulk or destructive listing operations** — mass activate/inactivate, bulk field rewrites,
   hard deletion beyond the documented policy, retention-policy changes.
5. **New search/product semantics** — changing what a filter *means*, or materially changing result
   sets by design rather than by defect repair.
6. **Destructive or high-risk schema changes** — drops, irreversible rewrites, anything without a
   clean rollback.
7. **Anything not easily reversible**, or whose blast radius cannot be confidently bounded.
8. **Weakening or bypassing a safety gate**, or adding a new deploy entrypoint.
9. **Genuine ambiguity** — two readings lead to materially different production behaviour.

> "Operational" must not be stretched to cover a RED item. When genuinely unsure: ask. Asking about
> a RED item is correct; asking about a GREEN item is the failure this document exists to end.

---

## Non-negotiable execution rules (GREEN work still obeys these)

1. **Evidence before the write.** Capture the defect — row-level, log-level, or a failing test —
   *before* changing anything. No speculative fixes.
2. **Prove the defect, then prove the fix.** A regression test must fail on the old code and pass on
   the new one. Say so explicitly.
3. **Never deploy to test the pipeline.** Deployments require a real, verified, deploy-requiring
   change.
4. **Source fidelity is absolute.** An implausible value that the source genuinely publishes is
   preserved exactly. Verify against the stored capture or the live page before calling it a bug.
   Honest NULL beats a guess.
5. **Hold the deploy lock** for anything that changes what production serves; release it after
   verifying, not before.
6. **No migration drift.** Every applied DDL gets a committed file at its exact recorded version.
7. **Report honestly.** Use the verification vocabulary: FIXED+VERIFIED (E2E) / PROPAGATION PENDING
   / AWAITING FIRST PRODUCTION EXECUTION / BLOCKED / UNPUSHED. Never upgrade a status on belief.
8. **Concurrency.** Other sessions write to this repo and DB. Check the deploy lock, the migration
   tail, and open PRs before writing; never race another writer.

## Junior/Beginner Daily Engineer — scope note

The Junior routine holds the **same GREEN authority** but a **narrower default blast radius**: it is
a daily health pass, not a deep refactor. It should fix what it finds, land it, and escalate
anything that needs a multi-layer investigation to the Senior routine via a `[DEEP AUDIT]` issue or
the `ops_daily_engineer_run` handoff — *escalating a large investigation is not the same as asking
permission for a small fix.* If the Junior routine finds a one-file scraper bug with a failing test,
it fixes it, merges it, and reports. It does not ask.

## Unattended execution

Both routines run scheduled, with nobody watching. A run that stalls on an interactive permission
prompt is a silent failure. Pre-approved tool permissions live in `.claude/settings.json`; if a run
reports being blocked on a prompt, that is a configuration bug to fix, not an owner decision.

## Changing this file

Widening GREEN or narrowing RED is an **owner decision** and requires owner approval in the PR.
Agents may not grant themselves authority. `scripts/verify-agent-authority-contract.ts` fails CI if
the RED list loses any of its nine categories.
