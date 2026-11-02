#!/usr/bin/env bash
# CANARY GATE — decides a Vercel rolling release with no human in the loop (owner 2026-10-23, step 3 of the
# self-healing proposal, «fail small»).
#
# WHAT IT DOES. After safe-deploy.sh ships a production deployment, Vercel's Rolling Releases (configured
# manual-approval, one 10% stage) sends only 1 in 10 visitors to the new build. This script drives the
# guardian journeys (e2e/guardian) TWICE, concurrently: once pinned to the STABLE build
# (`?vcrrForceStable=true`) and once pinned to the CANARY (`?vcrrForceCanary=true`), the documented way to
# pin a visitor during a rolling release. The verdict is RELATIVE:
#   a journey that fails on the canary and passed on stable  → SUSPECT → re-run once, both builds
#   a journey UNDETERMINED on the canary (it judged nothing)  → SUSPECT → re-run once, both builds
#   a suspect that REPRODUCES (canary not PASS, stable PASS)  → REGRESSION → rolling-release abort
#   no regression                                             → rolling-release complete
# A journey that fails on BOTH is production's existing debt (it already files its own ops_incident) and
# must not block every deploy forever — measured 2026-10-23 20:13: three guardian journeys were red on
# production before this gate existed. A gate that cannot judge (harness crash, missing URL, a run that
# records nothing, a re-run with no verdict) ABORTS: it never completes a release it did not watch.
#
# WHY THE RE-RUN (owner standing order, 2026-10-24). Three aborts in one morning — 05:18 back-preserves-
# results [mobile], 06:26 + 07:45 signed-out-auth-surface [desktop] — were one-off harness flakes, each
# PASS on stable and on the next run. One concurrent re-run against BOTH builds tells a flake from a
# regression: a real regression reproduces on the canary while stable still passes, and still aborts.
#
# WHY THE ABORT NAMES THE STABLE BUILD. Vercel's abort is a rollback TO the deployment named. Naming the
# canary was refused at 06:26 and 07:56 UTC («Cannot rollback … canary deployment that is only partially
# deployed (400)»), and when it was accepted (05:31 UTC, team events) it rolled production FORWARD onto
# the rejected build. So the abort names currentDeployment from Vercel's own rolling-release record, and
# «CANARY ABORTED» is printed only after that record reads ABORTED for this canary.
#
#   scripts/canary-gate.sh <deployment-url>
#   EZ_ROLLING_RELEASE must be "1" (repo variable, set when the project's rolling release is enabled);
#   otherwise this prints one line and exits 0, so the legacy 100% deploy path keeps working unchanged.
#
# Phrases below are what deploy-frontend.yml's Report step greps for. Keep them verbatim.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DPL="${1:-}"
BASE='https://ezhalah-app.vercel.app'
MAX_RERUNS=4   # more canary suspects than this is not a flake; abort without spending the job's clock

if [ "${EZ_ROLLING_RELEASE:-}" != "1" ]; then
  echo "canary gate: skipped — EZ_ROLLING_RELEASE is not 1 (rolling releases not enabled for this project)."
  exit 0
fi
if [ -z "$DPL" ]; then
  echo "❌ CANARY UNRESOLVED — no deployment URL was handed to the gate; nothing can be judged, so nothing is promoted."
  exit 1
fi

PROJECT_ID="$(sed -nE 's/.*"projectId": *"([^"]+)".*/\1/p' .vercel/project.json 2>/dev/null | head -1 || true)"
TEAM_ID="$(sed -nE 's/.*"orgId": *"([^"]+)".*/\1/p' .vercel/project.json 2>/dev/null | head -1 || true)"

# Vercel's own record of the release, one line: «STATE STABLE_DEPLOYMENT_ID CANARY_HOST».
release() {
  npx vercel api "/v1/projects/$PROJECT_ID/rolling-release?teamId=$TEAM_ID" --method GET --non-interactive 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const r=JSON.parse(s).rollingRelease||{};console.log([r.state||"NONE",r.currentDeployment?.id||"-",r.canaryDeployment?.url||"-"].join(" "))})'
}

abort() {
  echo ""
  echo "❌ Canary gate stopped — $1"
  echo "   Rolling back: traffic returns to the previous production build."
  local state stable canary i
  read -r state stable canary < <(release || echo "UNREADABLE - -") || true
  if [ "$state" = "ACTIVE" ] && [ "$canary" = "${DPL#https://}" ]; then
    npx vercel rolling-release abort --dpl "$stable" --non-interactive || true
  fi
  for i in 1 2 3 4 5 6 7 8 9 10; do
    read -r state stable canary < <(release || echo "UNREADABLE - -") || true
    [ "$state" = "ABORTED" ] && break
    sleep 3
  done
  if [ "$state" = "ABORTED" ] && [ "$canary" = "${DPL#https://}" ]; then
    echo "   Vercel confirms: release ABORTED — canary $canary at 0%, all traffic on $stable."
    echo "CANARY ABORTED — traffic restored to the previous deployment"
  else
    echo "CANARY UNRESOLVED — Vercel did not confirm the rollback (release: $state, canary: $canary); check the Vercel dashboard NOW: the release may still be at 10%"
  fi
  exit 1
}

verdicts() { { grep -oE '▶ [a-z0-9-]+ \[[a-z]+\] … (PASS|FAIL|UNDETERMINED)' "$1" || true; } | sed -E 's/^▶ //; s/ … / /' | sort; }
why() { { grep -E '… (FAIL|UNDETERMINED)|^    [?✗] ' "$1" || true; } | cut -c1-240; }

# pair <stable-log> <canary-log> [journey viewport] — both builds, concurrently, so both see the same moment.
pair() {
  set +e
  CANARY_QUERY='vcrrForceStable=true' BASE_URL="$BASE" GUARDIAN_ONLY="${3:-}" GUARDIAN_VIEWPORT="${4:-}" node e2e/guardian/run.mjs >"$1" 2>&1 &
  local s=$!
  CANARY_QUERY='vcrrForceCanary=true' BASE_URL="$BASE" GUARDIAN_ONLY="${3:-}" GUARDIAN_VIEWPORT="${4:-}" node e2e/guardian/run.mjs >"$2" 2>&1 &
  local c=$!
  wait "$s"; wait "$c"
  set -e
}

# The verdict of one journey×viewport in a log, or NONE when the run recorded nothing for it.
verdict_of() { verdicts "$1" | awk -v j="$2" -v v="$3" '$1==j && $2==v && !f {print $3; f=1} END {if (!f) print "NONE"}'; }

echo ""
echo "Canary gate: driving the guardian journeys against STABLE and the 10% CANARY ($DPL), concurrently…"
WORK="$(mktemp -d)"
pair "$WORK/stable.log" "$WORK/canary.log"
echo "── stable ──"; verdicts "$WORK/stable.log"; why "$WORK/stable.log"
echo "── canary ──"; verdicts "$WORK/canary.log"; why "$WORK/canary.log"

CANARY_N="$(verdicts "$WORK/canary.log" | wc -l | tr -d ' ')"
STABLE_N="$(verdicts "$WORK/stable.log" | wc -l | tr -d ' ')"
if [ "$CANARY_N" -lt 8 ] || [ "$STABLE_N" -lt 8 ]; then
  echo "── canary log tail ──"; tail -40 "$WORK/canary.log"
  abort "the guardian run recorded too few verdicts (canary $CANARY_N, stable $STABLE_N; need ≥ 8 each) — a run that proved nothing cannot promote"
fi

# SUSPECTS: every canary UNDETERMINED (a journey that judged nothing never passes silently), every canary
# FAIL on a journey stable PASSED, and every stable PASS the canary run never reached.
SUSPECTS="$(awk 'NR==FNR { s[$1" "$2]=$3; next } { c[$1" "$2]=$3 }
  END { for (k in c) if (c[k]=="UNDETERMINED" || (c[k]=="FAIL" && s[k]=="PASS")) print k
        for (k in s) if (s[k]=="PASS" && !(k in c)) print k }' \
  <(verdicts "$WORK/stable.log") <(verdicts "$WORK/canary.log") | sort -u)"

REGRESSIONS=""
if [ -n "$SUSPECTS" ]; then
  N="$(echo "$SUSPECTS" | wc -l | tr -d ' ')"
  if [ "$N" -gt "$MAX_RERUNS" ]; then
    echo "$SUSPECTS" | sed 's/^/   ✗ /'
    abort "$N journeys did not pass on the canary — more than $MAX_RERUNS is not a one-off flake"
  fi
  echo ""
  echo "Canary gate: $N suspect journey(s) — re-running each ONCE against BOTH builds, concurrently…"
  while read -r J V; do
    VP="${V#[}"; VP="${VP%]}"   # «[desktop]» in a verdict line, «desktop» for GUARDIAN_VIEWPORT
    pair "$WORK/s.$J.$VP.log" "$WORK/c.$J.$VP.log" "$J" "$VP"
    S2="$(verdict_of "$WORK/s.$J.$VP.log" "$J" "$V")"; C2="$(verdict_of "$WORK/c.$J.$VP.log" "$J" "$V")"
    why "$WORK/c.$J.$VP.log" | sed 's/^/      /'
    if [ "$S2" = "NONE" ] || [ "$C2" = "NONE" ]; then
      echo "   ✗ $J $V re-run: stable $S2, canary $C2 → the re-run recorded no verdict — counted as a regression"
      REGRESSIONS+="$J $V"$'\n'
    elif [ "$C2" = "PASS" ]; then
      echo "   ✓ $J $V re-run: stable $S2, canary PASS → one-off flake, cleared"
    elif [ "$S2" = "PASS" ]; then
      echo "   ✗ $J $V re-run: stable PASS, canary $C2 → REPRODUCED — regression"
      REGRESSIONS+="$J $V"$'\n'
    else
      echo "   · $J $V re-run: stable $S2, canary $C2 → not passing on stable either — production's own debt, not this canary's"
    fi
  done <<<"$SUSPECTS"
fi
rm -rf "$WORK"

if [ -n "$REGRESSIONS" ]; then
  echo ""
  echo "Journeys that pass on the stable build and FAIL on the canary, twice:"
  printf '%s' "$REGRESSIONS" | sed 's/^/   ✗ /'
  abort "the canary regresses $(printf '%s' "$REGRESSIONS" | wc -l | tr -d ' ') journey(s) that pass on the current production build"
fi

echo ""
echo "Canary gate: no regression against the stable build — promoting the release to 100%…"
if ! npx vercel rolling-release complete --dpl "$DPL" --non-interactive; then
  abort "'vercel rolling-release complete' failed"
fi
echo "CANARY PASSED — promoted to 100%"
