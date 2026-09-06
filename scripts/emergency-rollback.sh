#!/usr/bin/env bash
# Emergency production rollback — formalizes the `npx vercel rollback ... --yes` pattern used
# ad-hoc during the 2026-07-15 PR#78 outage (twice, once for the initial break and once for a
# concurrent-session re-break mid-remediation — see project memory
# `pr78-outage-rollback-2026-07-15`). This is the FAST path: re-points the production alias to an
# already-built deployment instantly, no rebuild. It does NOT fix the underlying git state — see
# "Proper fix" in docs/DEPLOY_SAFETY.md after using this.
#
# Usage: scripts/emergency-rollback.sh <deployment-id-or-url>
#   e.g.: scripts/emergency-rollback.sh dpl_BC6ryVrsvM5QZf9pW8d82bxY9V39
#
# REHEARSE IT FIRST:  DRY_RUN=1 scripts/emergency-rollback.sh <deployment-id-or-url>
#   Walks the ENTIRE path -- argument check, repo root, deploy-lock acquire and release -- and
#   PRINTS the rollback command instead of running it. Production is not touched. This is how you
#   discover that SUPABASE_SERVICE_ROLE_KEY is missing from your shell BEFORE the outage rather
#   than during it, and it is the path scripts/verify-emergency-rollback-path.ts executes in
#   `npm test` so this break-glass script can never rot untested again (ops_incident #73: for its
#   whole life the only barrier that named this file was the allowlist permitting its raw command).
#
# Still acquires the deploy lock first — a rollback changes the production alias exactly like a
# deploy does, and racing a rollback against another session's deploy is the same failure mode
# this whole mechanism exists to prevent. The lock takes deploy-lock.sh's default TTL -- 600s, the
# ten minutes docs/DEPLOY_SAFETY.md documents -- and the trap below releases it the moment the
# rollback returns, including when the rollback FAILS. (An earlier version of this comment claimed
# a 120s TTL that no line of this script has ever set; corrected rather than implemented, because
# `npx` can spend longer than that just fetching the CLI on a cold cache, and a lock that expires
# mid-rollback is precisely the concurrent-alias-change failure it exists to prevent.) A DRY RUN
# mutates nothing, so it deliberately holds a 60s lock instead: a rehearsal killed before its trap
# fires must never keep the real rollback out.
# Does NOT run preflight/taxonomy/env checks (this is the emergency path, not the normal one).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

TARGET="${1:?usage: scripts/emergency-rollback.sh <deployment-id-or-url>   (DRY_RUN=1 to rehearse)}"
DRY_RUN="${DRY_RUN:-}"
if [ -n "$DRY_RUN" ]; then
  export DEPLOY_LOCK_TTL_SECONDS=60
fi

HOLDER="emergency-rollback:$(whoami)@$(hostname)-$$"
scripts/deploy-lock.sh acquire "$HOLDER" "emergency-rollback.sh -> $TARGET" || exit 1
trap 'scripts/deploy-lock.sh release "'"$HOLDER"'" >/dev/null 2>&1 || true' EXIT

if [ -n "$DRY_RUN" ]; then
  echo "DRY RUN -- would run: npx vercel rollback $TARGET --yes"
  echo "DRY RUN -- production was NOT touched. Re-run without DRY_RUN=1 to actually roll back."
  exit 0
fi

echo "Rolling back production alias to $TARGET ..."
npx vercel rollback "$TARGET" --yes

echo ""
echo "Rolled back. Verify (see 'Verifying a deploy' in docs/DEPLOY_SAFETY.md), then:"
echo "  1. Diff what's on main against what's live to find exactly what's missing/broken."
echo "  2. Get the fix onto main properly: commit -> push -> PR -> review -> merge."
echo "  3. Run scripts/safe-deploy.sh from a clean main checkout to redeploy for real."
echo "  4. Update the Approved baseline record table in docs/DEPLOY_SAFETY.md."
