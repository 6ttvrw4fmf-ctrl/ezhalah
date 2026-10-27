# 🛟 Ezhalah auto-fixer (hourly cloud routine)

**Owner decision, 2026-10-27 (verbatim):** «I want an automatic this so we fix it whenever something happens» and, asked
how far it may go alone: **«Fix it then deploy and tell me it deployed that's it ok»**.

This file is the routine's spec and the source of truth. If the routine's prompt and this file differ, this file wins.
AGENTS.md and `docs/ops/AGENT_AUTHORITY.md` still bind it in full (deploy lock, drift gate, `safe-pr-merge.ts`,
`deploy-frontend.yml`, "nothing is live until used like a real user", robots must not take production down).

This is a NEW engineer the owner asked for. It is not one of the eleven routines deleted on 2026-09-27.

## Every run (hourly)

1. **Look** (cheap first; stop early when nothing is wrong):
   - Open GitHub issues created by `alert-dispatch.yml` (database alarms P0/P1/P2, one issue per dedup key) and by the
     failure→alert bridges of scheduled workflows. Newest first.
   - Failed workflow runs on `main` in the last 2 hours (GitHub Actions API), ignoring cancelled runs and runs already
     followed by a green run of the same workflow.
   - Open PRs authored by our sessions whose required checks are red for a reason that is NOT the known flaky
     «built app runs» React #419 (re-run that one once instead).
   - Sentry is NOT reachable from the cloud today (no token/connector). When the owner connects Sentry (connector, or
     a Sentry alert rule that opens GitHub issues), treat those issues like any other.
2. **Decide** for each finding: is it real, is it ours to fix, is it safe? Weird is not wrong; prove it before
   changing data (`docs/ops/DATA_INTEGRITY_ENGINEER.md`). Skip anything another session is clearly working on
   (`ops_active_claims`, an open PR touching the same files, a commit in the last hour).
3. **Fix** the root cause on a branch → focused tests → a barrier that fails on the old code (mutation-proven) → PR with
   `--head <branch> --base main` → merge ONLY via `node --experimental-strip-types scripts/safe-pr-merge.ts <PR>`.
4. **Deploy** when the fix changes what users get: dispatch `deploy-frontend.yml` (`confirm=DEPLOY`, a `reason`), read
   its Report step (a run marked failure may still have shipped; a drift refusal means wait and retry next hour).
5. **Verify** on https://ezhalah.com like a real user where the cloud can reach it; otherwise say NOT YET VERIFIED.
6. **Tell the owner** in the run's final message, baby-simple, emoji, ≤ 5 lines: what broke, what was fixed, «deployed ✅»
   or why not. A quiet hour ends with one line: «All good 👍 nothing needed fixing.»

## Never on its own (ask the owner instead)

- The back-door lock (`guard.gate_lock_mode`), the network guard mode, the scrape-alarm thresholds, `guard.trusted_ip`.
- Anything that costs money, deletes listings or data, changes taxonomy / Region→City→District, or adds product behaviour.
- Weakening, deleting or skipping a barrier, the drift gate, the deploy guard, or the speed budgets (ALWAYS FAST).
- Applying database migrations: the cloud has no database access. Route those to an interactive session instead
  (describe the fix in the run's final message).

## Limits it must respect

- At most 2 browsers against production; check load before any burst (AGENTS.md "OUR OWN ROBOTS…").
- One problem at a time; a run that cannot finish leaves its PR open with a clear note, never a half-merged change.
