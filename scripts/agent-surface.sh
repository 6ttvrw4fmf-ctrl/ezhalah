#!/usr/bin/env bash
# SINGLE-WRITER OWNERSHIP for the AI agent edge function (owner ruling 2026-08-29).
#
# WHY. supabase/functions/agent/index.ts is ~113KB of production code that several automation
# sessions edit. On 2026-08-29 two INDIVIDUALLY-CORRECT changes collided — the health heartbeat and
# the usage telemetry each added `const t0 = Date.now();` to the same scope in runModel() — and the
# function stopped booting. Every barrier was green, because they all read that file as TEXT.
#
# The parse gate (scripts/verify-edge-functions-parse.ts) catches SYNTACTIC collisions. It cannot
# catch two logically valid edits that overwrite or contradict each other. This is the other half:
# only one session writes this surface at a time, and the final merged result is diffed before deploy.
#
# NOT A NEW LOCK SYSTEM. It reuses acquire_deploy_lock()/release_deploy_lock(), added 2026-07-16
# after two concurrent Claude sessions independently deployed and rolled back production. Only names
# matching ^prod (and a small alias set) canonicalize to 'production', so 'agent-edge-surface' is a
# genuinely separate lock and claiming it never blocks a normal deploy.
#
# Usage:
#   scripts/agent-surface.sh claim   "<holder>" ["<note>"]   # fail-closed: exits 1 if someone owns it
#   scripts/agent-surface.sh status
#   scripts/agent-surface.sh release "<holder>"
#   scripts/agent-surface.sh smoke                           # REAL post-deploy boot + request test
#
# Requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY for the lock verbs.
# `smoke` needs neither — it calls the public endpoint the way a user does.
set -euo pipefail

LOCK_NAME="agent-edge-surface"
TTL_SECONDS="${AGENT_SURFACE_TTL:-3600}"
AGENT_FILE="supabase/functions/agent/index.ts"
ACTION="${1:-status}"
HOLDER="${2:-}"
NOTE="${3:-}"

URL="${SUPABASE_URL:-${EXPO_PUBLIC_SUPABASE_URL:-}}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

need_creds() {
  if [ -z "$URL" ] || [ -z "$KEY" ]; then
    echo "FAIL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for lock operations." >&2
    echo "      (A Claude/MCP session can call acquire_deploy_lock('$LOCK_NAME', ...) directly instead.)" >&2
    exit 1
  fi
}

case "$ACTION" in
  claim)
    [ -n "$HOLDER" ] || { echo "FAIL: claim requires a holder name." >&2; exit 1; }
    need_creds
    RESP=$(curl -sS -X POST "$URL/rest/v1/rpc/acquire_deploy_lock" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
      -d "{\"p_lock_name\":\"$LOCK_NAME\",\"p_holder\":\"$HOLDER\",\"p_ttl_seconds\":$TTL_SECONDS,\"p_note\":\"${NOTE:-agent edge surface}\"}")
    if [ "$RESP" != "true" ]; then
      echo "REFUSING: '$LOCK_NAME' is owned by another session right now." >&2
      curl -sS "$URL/rest/v1/ops_deploy_lock?lock_name=eq.$LOCK_NAME&select=holder,acquired_at,expires_at,note" \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY" >&2 || true
      echo "" >&2
      echo "Do NOT write $AGENT_FILE. Wait, hand off, or work on non-overlapping files." >&2
      exit 1
    fi
    echo "OWNED: '$LOCK_NAME' by '$HOLDER' (TTL ${TTL_SECONDS}s). Release when done."
    ;;

  release)
    [ -n "$HOLDER" ] || { echo "FAIL: release requires the holder name." >&2; exit 1; }
    need_creds
    curl -sS -X POST "$URL/rest/v1/rpc/release_deploy_lock" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
      -d "{\"p_lock_name\":\"$LOCK_NAME\",\"p_holder\":\"$HOLDER\"}" > /dev/null
    echo "released '$LOCK_NAME'."
    ;;

  status)
    need_creds
    curl -sS "$URL/rest/v1/ops_deploy_lock?lock_name=eq.$LOCK_NAME&select=holder,acquired_at,expires_at,note" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
    echo ""
    ;;

  smoke)
    # A SUCCESSFUL DEPLOY COMMAND IS NOT PRODUCTION PROOF (owner 2026-08-29). The 2026-08-29 outage
    # deployed "successfully" and then returned BOOT_ERROR on every request. This asks the live
    # endpoint the way a user does and requires a real classified answer.
    BASE="${URL:-https://aannarbkwcymrotzwdbo.supabase.co}"
    PUB="${EXPO_PUBLIC_SUPABASE_KEY:-sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB}"
    OUT=$(curl -sS -X POST "$BASE/functions/v1/agent" \
      -H "Authorization: Bearer $PUB" -H "content-type: application/json" \
      -d '{"text":"شقق للايجار السنوي في الرياض","locale":"ar","loggedIn":false,"order":"newest","history":[]}')
    echo "$OUT" | head -c 300; echo ""
    case "$OUT" in
      *BOOT_ERROR*)        echo "FAIL: BOOT_ERROR — the function does not start." >&2; exit 1 ;;
      *'"kind":"listings"'*|*'"kind":"message"'*)
                           echo "SMOKE OK: the live function booted and classified a real Arabic request." ;;
      *)                   echo "FAIL: no classification in the response." >&2; exit 1 ;;
    esac
    ;;

  *)
    echo "usage: $0 {claim <holder> [note]|release <holder>|status|smoke}" >&2; exit 1 ;;
esac
