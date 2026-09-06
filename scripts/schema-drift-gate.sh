#!/usr/bin/env bash
# SCHEMA-DRIFT + DUPLICATE-OVERLOAD GATE — ONE implementation, called TWICE by safe-deploy.sh.
#
# WHY THIS FILE EXISTS (incident #61, routine-7-seam, 2026-09-05).
# This gate lived inline in safe-deploy.sh at line 371 — 193 lines AFTER the production deploy
# command (line 178) and after the canonical-alias verification (line 229). Measured on run
# 33949619528:
#
#   06:30:19  the production deploy completed → https://ezhalah-niehv6fvz-enzalah.vercel.app
#   06:30:19  "Verifying the canonical alias serves the bundle" → PASSED
#   06:30:21  "Running the schema-drift + duplicate-overload gate" → FAILED (3 missing_in_git)
#
# The workflow status was TRUE — the gate really did fail — but production had ALREADY been updated
# and aliased. A gate whose own message calls duplicate overloads "the EXACT 2026-07-16 outage
# signature (PGRST203: PostgREST refuses every call to an ambiguous RPC — search dies app-wide)"
# cannot prevent that outage from behind the point of no return. It could only ever report it.
#
# Two consecutive deploys (33949149895, 33949619528) hit this, each on a DIFFERENT concurrent
# session's unmirrored migrations, so the window is not rare — it is routinely open.
#
# THE FIX ADDS PREVENTION AND WEAKENS NOTHING. safe-deploy.sh now calls this twice:
#   PRE  (before the deploy)     — refuses to DEPLOY on drift. This is the new, load-bearing call.
#   POST (before baseline bump)  — refuses to ADVANCE THE BASELINE, exactly as before, and now also
#                                  catches drift introduced DURING the deploy window by a
#                                  concurrent session (the precise race that produced the second
#                                  red run, minutes after the first was fixed).
# Both calls fail CLOSED. Neither threshold, exception, nor message was relaxed.
#
# Usage: schema-drift-gate.sh <pre|post> <anon_key>
set -uo pipefail

PHASE="${1:?usage: schema-drift-gate.sh <pre|post> <anon_key>}"
ANON="${2:?usage: schema-drift-gate.sh <pre|post> <anon_key>}"

case "$PHASE" in
  pre)  REFUSAL="REFUSING TO DEPLOY";                 WHAT="deploy" ;;
  post) REFUSAL="REFUSING TO ADVANCE THE BASELINE";   WHAT="baseline advance" ;;
  *) echo "schema-drift-gate: unknown phase '$PHASE' (expected pre|post)" >&2; exit 2 ;;
esac

RESP="/tmp/safe-deploy-drift-response-${PHASE}.json"
URL="https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/rpc/ops_deploy_preflight_checks"

echo ""
echo "Running the schema-drift + duplicate-overload gate [${PHASE}] (ops_deploy_preflight_checks against production)..."

# Shared with scripts/verify-migration-drift-vs-production.ts (the continuous, push/schedule-driven
# half of this same gate) so there is exactly ONE parser for "what migrations does the repo claim".
BODY="$(node -e 'process.stdout.write(JSON.stringify({p_repo_versions: require("./scripts/build-repo-migration-versions.cjs").buildRepoMigrationVersions()}))')"
HTTP="$(curl -s -o "$RESP" -w '%{http_code}' --max-time 20 \
  -X POST "$URL" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d "$BODY" || echo "curl_failed")"

if [ "$HTTP" = "404" ]; then
  # PGRST202 — the gate RPC itself has not shipped yet. Expected ONLY for the deploy that ships it.
  echo "WARNING: ops_deploy_preflight_checks not found in production (HTTP 404) — the gate RPC has"
  echo "not shipped yet. Expected ONLY for the deploy that ships it (batch 4). Apply"
  echo "supabase/migrations/20260716_batch4_deploy_preflight_rpc.sql so every future deploy is gated."
  exit 0
fi

if [ "$HTTP" = "200" ]; then
  MISSING="$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).missing_in_git.length' "$RESP" 2>/dev/null || echo "parse_error")"
  DUPS="$(node -pe 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).duplicate_overloads.length' "$RESP" 2>/dev/null || echo "parse_error")"
  if [ "$MISSING" = "0" ] && [ "$DUPS" = "0" ]; then
    echo "OK [${PHASE}]: no uncommitted prod migrations past the baseline, no duplicate public function overloads."
    rm -f "$RESP"
    exit 0
  fi
  echo ""
  echo "❌ ${REFUSAL}: production schema drift detected."
  echo "   missing_in_git: $MISSING migration(s) applied to prod but absent from this repo"
  echo "   duplicate_overloads: $DUPS public function name(s) with more than one overload"
  echo "   Full response saved: $RESP — details:"
  node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")), null, 2))' "$RESP" 2>/dev/null || cat "$RESP"
  echo "   Duplicate overloads are the EXACT 2026-07-16 outage signature (PGRST203: PostgREST refuses"
  echo "   every call to an ambiguous RPC — search dies app-wide), and uncommitted migrations are how"
  echo "   that overload got there. Recover the missing SQL verbatim into supabase/migrations/ (from"
  echo "   supabase_migrations.schema_migrations) and/or drop the stale overload, then re-run."
  if [ "$PHASE" = "pre" ]; then
    echo "   NOTHING HAS BEEN DEPLOYED — this ran BEFORE the production deploy, precisely so that"
    echo "   drift is prevented rather than merely reported (incident #61)."
  else
    echo "   NOTE: production was already updated by this run. Drift appearing only here means a"
    echo "   CONCURRENT session applied an unmirrored migration DURING this deploy window."
  fi
  exit 1
fi

echo ""
echo "❌ ${REFUSAL}: drift gate could not run (HTTP ${HTTP:-none})."
echo "   Response (if any): $RESP. This check fails CLOSED — a gate that cannot run must not bless"
echo "   a ${WHAT}. Fix connectivity / the RPC, then re-run."
exit 1
