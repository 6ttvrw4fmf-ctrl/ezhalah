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
# Still acquires the deploy lock first — a rollback changes the production alias exactly like a
# deploy does, and racing a rollback against another session's deploy is the same failure mode
# this whole mechanism exists to prevent. Short TTL (120s) since a rollback is fast by design;
# does NOT run preflight/taxonomy/env checks (this is the emergency path, not the normal one).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

TARGET="${1:?usage: scripts/emergency-rollback.sh <deployment-id-or-url>}"

HOLDER="emergency-rollback:$(whoami)@$(hostname)-$$"
scripts/deploy-lock.sh acquire "$HOLDER" "emergency-rollback.sh -> $TARGET" || exit 1
trap 'scripts/deploy-lock.sh release "'"$HOLDER"'" >/dev/null 2>&1 || true' EXIT

echo "Rolling back production alias to $TARGET ..."
npx vercel rollback "$TARGET" --yes

echo ""
echo "Rolled back. Verify (see 'Verifying a deploy' in docs/DEPLOY_SAFETY.md), then:"
echo "  1. Diff what's on main against what's live to find exactly what's missing/broken."
echo "  2. Get the fix onto main properly: commit -> push -> PR -> review -> merge."
echo "  3. Run scripts/safe-deploy.sh from a clean main checkout to redeploy for real."
echo "  4. Update the Approved baseline record table in docs/DEPLOY_SAFETY.md."
