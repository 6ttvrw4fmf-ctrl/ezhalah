#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────
# DEPLOY REPORT VERDICT — single source of truth for deploy-frontend.yml's "Report" step.
#
# `deploy_report_verdict <log_file>` sets SHIPPED / REFUSED_PRE / POST_FAILED / DEPLOY_URL by
# grepping the captured safe-deploy.sh log for the same evidence strings the Report step has always
# used. It is SOURCED by:
#   • .github/workflows/deploy-frontend.yml (the "Report" step — never re-inline this logic there)
#   • scripts/verify-deploy-report.ts        (the permanent regression test)
# so the two can never drift apart, and the parsing can finally be EXECUTED by a test instead of
# only trusted by reading it.
#
# WHY THIS EXISTS (extracted 2026-09-12, after a false-alarm investigation): the Report step was
# suspected of a false negative — "SHIPPED=no" visible in the raw job log even on a run where
# `▲ Aliased https://ezhalah-app.vercel.app` printed a few dozen lines earlier in the SAME step
# (run 34724048886). Investigation — a code trace, an isolated repro of the exact
# `2>"$DEPLOY_ERR" | tee "$DEPLOY_LOG"` / `cat "$DEPLOY_ERR" >&2` / outer
# `2>&1 | tee /tmp/safe-deploy.log` pipeline, and three real historical run logs including one
# genuine "deploy succeeded, a later post-deploy check failed" case (run 34707723517, which really
# did print `❌ REFUSING TO ADVANCE THE BASELINE` after a real `▲ Aliased`) — found NO data loss:
# every byte safe-deploy.sh prints, the Aliased line included, already reaches
# /tmp/safe-deploy.log, because `cat "$DEPLOY_ERR" >&2` (added in the 2026-09-04 stream-separation
# redesign, for the unrelated EMITTED_BUNDLE bug — see safe-deploy.sh) re-emits vercel's captured
# stderr into the very stream the workflow's outer `2>&1 | tee` already captures. `tee` cannot write
# one byte to its file argument and a different byte to its own stdout — the two are the same read
# loop — so if a line is visible in the step's rendered log, it is in this file too.
#
# The REAL gap: the computed verdict was written ONLY to $GITHUB_STEP_SUMMARY, never to the step's
# own stdout — so `gh run view --log` (or anyone reading the raw Actions log) never sees the actual
# result. What IS visible there, right where a human looks for it, is GitHub Actions' own
# pre-execution echo of the step's SOURCE CODE, which includes the literal line
# `SHIPPED=no; REFUSED_PRE=no; POST_FAILED=no; DEPLOY_URL=""` — the variable's INITIAL value, not a
# computed one — plus the grep pattern's own source text (which contains the word "Aliased" whether
# or not it ever matched). That pre-execution echo is what looked like a computed "no". This
# extraction lets the workflow print the REAL computed verdict to its own log (closing that gap,
# see the Report step) and lets scripts/verify-deploy-report.ts prove the parsing itself against
# synthetic AND real fixtures.
# ─────────────────────────────────────────────────────────────────────────────────────────

# deploy_report_verdict <log_file> → sets SHIPPED, REFUSED_PRE, POST_FAILED, DEPLOY_URL in the
# CALLER's shell (all "no" / "" when the file is missing). Read-only with respect to <log_file>.
deploy_report_verdict() {
  local log="$1"
  SHIPPED=no; REFUSED_PRE=no; POST_FAILED=no; DEPLOY_URL=""
  [ -f "$log" ] || return 0
  # safe-deploy.sh only reaches these lines AFTER the production deploy returned a deployment.
  if grep -qE 'Aliased|^https://ezhalah-[a-z0-9]+-' "$log"; then SHIPPED=yes; fi
  # Every pre-deploy gate refuses with one of these and exits before deploying.
  if grep -qE 'REFUSING TO DEPLOY|safe-deploy: REFUSED' "$log"; then REFUSED_PRE=yes; fi
  # This fires only AFTER a successful deploy (alias/env/smoke-test/drift checks).
  if grep -q 'REFUSING TO ADVANCE THE BASELINE' "$log"; then POST_FAILED=yes; fi
  # `|| true`: matches the same grep-in-a-pipe idiom safe-deploy.sh already uses for PRE_BUNDLE/
  # DEPLOYED_URL/EMITTED_BUNDLE. Without it, a caller with `pipefail` active (this function's own
  # caller does not today, but a library must not assume that of every future one) would have a
  # "no preview URL in this log" result — the ordinary case for a pre-deploy refusal, since nothing
  # vercel-shaped was ever printed — abort the whole function via `set -e`, before SHIPPED/
  # REFUSED_PRE/POST_FAILED (already computed above) ever reach the caller. Caught by
  # scripts/verify-deploy-report.ts running this function under `set -euo pipefail`.
  DEPLOY_URL="$(grep -oE 'https://ezhalah-[a-z0-9]+-[a-z0-9-]+\.vercel\.app' "$log" | tail -1 || true)"
}
