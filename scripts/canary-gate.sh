#!/usr/bin/env bash
# CANARY GATE — decides a Vercel rolling release with no human in the loop (owner 2026-10-23, step 3 of the
# self-healing proposal, «fail small»).
#
# WHAT IT DOES. After safe-deploy.sh ships a production deployment, Vercel's Rolling Releases (configured
# manual-approval, one 10% stage) sends only 1 in 10 visitors to the new build. This script drives the
# guardian journeys (e2e/guardian) TWICE, concurrently: once pinned to the STABLE build
# (`?vcrrForceStable=true`) and once pinned to the CANARY (`?vcrrForceCanary=true`), the documented way to
# pin a visitor during a rolling release. The verdict is RELATIVE:
#   a journey that fails on the canary and passed on stable  → REGRESSION → `vercel rolling-release abort`
#   no regression                                             → `vercel rolling-release complete`
# A journey that fails on BOTH is production's existing debt (it already files its own ops_incident) and
# must not block every deploy forever — measured 2026-10-23 20:13: three guardian journeys were red on
# production before this gate existed. A gate that cannot judge (harness crash, missing URL, a run that
# records nothing) ABORTS: it never completes a release it did not watch, and never leaves one parked.
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

# One verdict line per journey×viewport, as run.mjs prints them: «▶ <id> [<viewport>] … PASS|FAIL|UNDETERMINED (…)».
verdicts() { grep -oE '▶ [a-z0-9-]+ \[[a-z]+\] … (PASS|FAIL|UNDETERMINED)' "$1" | sed -E 's/^▶ //; s/ … / /' | sort; }

echo ""
echo "Canary gate: driving the guardian journeys against STABLE and the 10% CANARY ($DPL), concurrently…"
STABLE_LOG="$(mktemp)"; CANARY_LOG="$(mktemp)"
set +e
CANARY_QUERY='vcrrForceStable=true' BASE_URL='https://ezhalah-app.vercel.app' node e2e/guardian/run.mjs >"$STABLE_LOG" 2>&1 &
STABLE_PID=$!
CANARY_QUERY='vcrrForceCanary=true' BASE_URL='https://ezhalah-app.vercel.app' node e2e/guardian/run.mjs >"$CANARY_LOG" 2>&1 &
CANARY_PID=$!
wait "$STABLE_PID"; STABLE_RC=$?
wait "$CANARY_PID"; CANARY_RC=$?
set -e
echo "── stable (exit $STABLE_RC) ──"; verdicts "$STABLE_LOG" || true
echo "── canary (exit $CANARY_RC) ──"; verdicts "$CANARY_LOG" || true

CANARY_N="$(verdicts "$CANARY_LOG" | wc -l | tr -d ' ')"
STABLE_N="$(verdicts "$STABLE_LOG" | wc -l | tr -d ' ')"
if [ "$CANARY_N" -lt 8 ] || [ "$STABLE_N" -lt 8 ]; then
  echo "── canary log tail ──"; tail -40 "$CANARY_LOG"
  rm -f "$STABLE_LOG" "$CANARY_LOG"
  abort "the guardian run recorded too few verdicts (canary $CANARY_N, stable $STABLE_N; need ≥ 8 each) — a run that proved nothing cannot promote"
fi
# REGRESSION = a journey that PASSED on stable and did NOT pass on the canary. Same key (id + viewport).
REGRESSIONS="$(comm -12 <(verdicts "$STABLE_LOG" | awk '$3=="PASS"{print $1" "$2}' | sort) <(verdicts "$CANARY_LOG" | awk '$3!="PASS"{print $1" "$2}' | sort))"
rm -f "$STABLE_LOG" "$CANARY_LOG"
if [ -n "$REGRESSIONS" ]; then
  echo ""
  echo "Journeys that pass on the stable build and FAIL on the canary:"
  echo "$REGRESSIONS" | sed 's/^/   ✗ /'
  abort "the canary regresses $(echo "$REGRESSIONS" | wc -l | tr -d ' ') journey(s) that pass on the current production build"
fi

echo ""
echo "Canary gate: no regression against the stable build — promoting the release to 100%…"
if ! npx vercel rolling-release complete --dpl "$DPL" --yes; then
  abort "'vercel rolling-release complete' failed"
fi
echo "CANARY PASSED — promoted to 100%"
