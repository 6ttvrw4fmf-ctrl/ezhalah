#!/usr/bin/env bash
# Production deploy lock — CLI wrapper around the acquire_deploy_lock()/release_deploy_lock()
# Postgres functions (supabase/migrations/20260716_deploy_lock.sql). Added 2026-07-16 after a
# 2026-07-15 P0 where two concurrent Claude sessions each independently deployed/rolled back
# production within the same remediation window, with no coordination between them — see
# docs/DEPLOY_SAFETY.md "Deployment lock" section and project memory
# `pr78-outage-rollback-2026-07-15` for the full incident.
#
# Usage:
#   scripts/deploy-lock.sh acquire "<holder>" ["<note>"]   # exits 0 + holds lock, or exits 1
#   scripts/deploy-lock.sh release "<holder>"
#   scripts/deploy-lock.sh status
#
# Requires SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the
# environment. The service-role key is deliberately never committed (see .env.example) — export
# it in your shell before running this directly. A Claude/MCP session does NOT need this script
# at all: it can call the same two RPCs directly via the Supabase MCP tool (see AGENTS.md).
#
# If SUPABASE_SERVICE_ROLE_KEY is not set, this script WARNS LOUDLY and exits 1 on `acquire`
# (fails closed, not open) — a deploy proceeding with no lock check is exactly the bug this
# script exists to close.
set -euo pipefail

CMD="${1:-}"
LOCK_NAME="production"
TTL_SECONDS="${DEPLOY_LOCK_TTL_SECONDS:-600}"

URL="${SUPABASE_URL:-${EXPO_PUBLIC_SUPABASE_URL:-}}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$URL" ]; then
  echo "REFUSING: SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL is not set." >&2
  exit 1
fi

case "$CMD" in
  acquire)
    HOLDER="${2:?usage: scripts/deploy-lock.sh acquire \"<holder>\" [\"<note>\"]}"
    NOTE="${3:-}"
    if [ -z "$KEY" ]; then
      echo "⚠️  SUPABASE_SERVICE_ROLE_KEY is not set — CANNOT check or acquire the deploy lock." >&2
      echo "⚠️  Refusing to proceed unlocked. Export the service-role key, or (if you are a" >&2
      echo "⚠️  Claude/MCP session) acquire the lock directly via the Supabase MCP tool instead" >&2
      echo "⚠️  of this script — see AGENTS.md 'Deployment lock' section." >&2
      exit 1
    fi
    RESP=$(curl -sS -X POST "$URL/rest/v1/rpc/acquire_deploy_lock" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"p_lock_name\":\"$LOCK_NAME\",\"p_holder\":\"$HOLDER\",\"p_ttl_seconds\":$TTL_SECONDS,\"p_note\":\"$NOTE\"}")
    if [ "$RESP" = "[]" ]; then
      echo "REFUSING TO DEPLOY: lock '$LOCK_NAME' is held by another session right now." >&2
      curl -sS "$URL/rest/v1/ops_deploy_lock?lock_name=eq.$LOCK_NAME&select=holder,acquired_at,expires_at,note" \
        -H "apikey: $KEY" -H "Authorization: Bearer $KEY" >&2 || true
      echo "" >&2
      echo "Wait for the holder to finish and release, or for expires_at to pass, then retry." >&2
      exit 1
    fi
    echo "Lock '$LOCK_NAME' acquired by '$HOLDER' (TTL ${TTL_SECONDS}s)."
    ;;
  release)
    HOLDER="${2:?usage: scripts/deploy-lock.sh release \"<holder>\"}"
    if [ -z "$KEY" ]; then
      echo "⚠️  SUPABASE_SERVICE_ROLE_KEY is not set — cannot release the lock via this script." >&2
      exit 1
    fi
    curl -sS -X POST "$URL/rest/v1/rpc/release_deploy_lock" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"p_lock_name\":\"$LOCK_NAME\",\"p_holder\":\"$HOLDER\"}" > /dev/null
    echo "Lock '$LOCK_NAME' released by '$HOLDER' (no-op if it had already expired)."
    ;;
  status)
    if [ -z "$KEY" ]; then
      # ops_deploy_lock has zero anon/authenticated grants by design (migration
      # 20260716_deploy_lock.sql) — only service_role can read it, even for a status check.
      echo "Set SUPABASE_SERVICE_ROLE_KEY to check lock status (table has no anon access)." >&2
      exit 1
    fi
    curl -sS "$URL/rest/v1/ops_deploy_lock?lock_name=eq.$LOCK_NAME" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
    echo ""
    ;;
  *)
    echo "usage: scripts/deploy-lock.sh {acquire|release|status} ..." >&2
    exit 1
    ;;
esac
