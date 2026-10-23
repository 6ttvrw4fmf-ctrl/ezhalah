#!/usr/bin/env bash
# CANARY GATE — decides a Vercel rolling release with no human in the loop (owner 2026-10-23, step 3 of the
# self-healing proposal, «fail small»).
#
# WHAT IT DOES. After safe-deploy.sh ships a production deployment, Vercel's Rolling Releases (configured
# manual-approval, one 10% stage) sends only 1 in 10 visitors to the new build. This script drives the
# guardian journeys (e2e/guardian) against the CANARY — every page opens with `?vcrrForceCanary=true`, the
# documented way to pin a visitor to the new deployment — and then:
#   PASS  → `vercel rolling-release complete`  : the new build serves 100%.
#   FAIL / UNDETERMINED / crash → `vercel rolling-release abort` : traffic returns to the previous build.
# A gate that cannot judge (harness error, timeout, missing deployment URL) ABORTS. It never completes a
# release it did not watch, and it never leaves a release parked at 10% for a person to find.
#
#   scripts/canary-gate.sh <deployment-url>
#   EZ_ROLLING_RELEASE must be "1" (repo variable, set when the project's rolling release is enabled);
#   otherwise this prints one line and exits 0, so the legacy 100% deploy path keeps working unchanged.
#
# Phrases below are what deploy-frontend.yml's Report step greps for. Keep them verbatim.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DPL="${1:-}"
if [ "${EZ_ROLLING_RELEASE:-}" != "1" ]; then
  echo "canary gate: skipped — EZ_ROLLING_RELEASE is not 1 (rolling releases not enabled for this project)."
  exit 0
fi
if [ -z "$DPL" ]; then
  echo "❌ CANARY ABORTED — no deployment URL was handed to the gate; nothing can be judged, so nothing is promoted."
  exit 1
fi

abort() {
  echo ""
  echo "❌ CANARY ABORTED — $1"
  echo "   Rolling back: traffic returns to the previous production build."
  npx vercel rolling-release abort --dpl "$DPL" --yes || echo "   (abort command failed — check the Vercel dashboard NOW: the release may still be at 10%)"
  echo "CANARY ABORTED — traffic restored to the previous deployment"
  exit 1
}

echo ""
echo "Canary gate: driving the guardian journeys against the 10% canary ($DPL)…"
GATE_LOG="$(mktemp)"
set +e
CANARY_QUERY='vcrrForceCanary=true' BASE_URL='https://ezhalah-app.vercel.app' node e2e/guardian/run.mjs >"$GATE_LOG" 2>&1
GATE_RC=$?
set -e
cat "$GATE_LOG"
if [ "$GATE_RC" -ne 0 ]; then
  rm -f "$GATE_LOG"
  abort "the guardian journeys did not pass on the canary (exit $GATE_RC)"
fi
if ! grep -qE 'PASS' "$GATE_LOG"; then
  rm -f "$GATE_LOG"
  abort "the guardian run exited 0 but recorded no PASS — a run that proved nothing cannot promote"
fi
rm -f "$GATE_LOG"

echo ""
echo "Canary gate: journeys passed — promoting the release to 100%…"
if ! npx vercel rolling-release complete --dpl "$DPL" --yes; then
  abort "'vercel rolling-release complete' failed"
fi
echo "CANARY PASSED — promoted to 100%"
