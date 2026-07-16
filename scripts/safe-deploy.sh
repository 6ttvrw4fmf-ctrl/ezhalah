#!/usr/bin/env bash
# Pre-deploy safety guard — added 2026-07-09 after a P0 incident where uncommitted/unpushed local
# UI work was live via `vercel --prod` from a dirty tree, then silently lost when a later deploy
# ran from a clean `main` checkout that never had it. See docs/DEPLOY_SAFETY.md for the full story.
#
# Usage: scripts/safe-deploy.sh
#
# Refuses to deploy unless: on `main`, HEAD == origin/main exactly, and the working tree is
# completely clean. This is the ONLY way this repo should be deployed to production from now on —
# never run `vercel --prod` directly.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ── DEPLOY LOCK (added 2026-07-16, see docs/DEPLOY_SAFETY.md "Deployment lock" — after a
# 2026-07-15 P0 where two concurrent Claude sessions each independently deployed/rolled back
# production within the same remediation window). Acquired FIRST, before any of the expensive
# checks below, so a session that loses the race bails immediately instead of burning minutes on
# preflight/taxonomy checks it can't use. Released on ANY exit path via the trap (success,
# refusal, or error) so a failed deploy never leaves production locked for the TTL.
# MCP-HELD-LOCK MODE (added 2026-07-16): a Claude/MCP session holds the lock via the Supabase
# MCP tool (the pattern deploy-lock.sh's own header and AGENTS.md prescribe, since the
# service-role key is deliberately never present in any checkout). Setting DEPLOY_LOCK_MCP_HOLDER
# makes this script VERIFY — via the secret-free ops_deploy_lock_status() RPC
# (supabase/migrations/20260717_deploy_lock_mcp_status.sql) and the same client-public anon key
# the smoke test below uses — that exactly that holder currently holds an UNEXPIRED lock, and
# fail closed otherwise (missing/mismatched/expired lock, or any transport/parse error). The
# release stays with the MCP session (no trap): the lock outlives the script on purpose so the
# session can verify production BEFORE releasing. A deploy still can never proceed unlocked.
if [ -n "${DEPLOY_LOCK_MCP_HOLDER:-}" ]; then
  echo "Deploy lock: MCP-held mode — verifying holder '${DEPLOY_LOCK_MCP_HOLDER}' via ops_deploy_lock_status()..."
  LOCK_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0"
  LOCK_RESP="$(curl -sS --max-time 15 -X POST \
    "https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/rpc/ops_deploy_lock_status" \
    -H "apikey: $LOCK_ANON_KEY" -H "Authorization: Bearer $LOCK_ANON_KEY" \
    -H "Content-Type: application/json" -d '{}' || echo "curl_failed")"
  LOCK_OK="$(node -e '
    try {
      const rows = JSON.parse(process.argv[1]);
      const want = process.argv[2];
      const hit = Array.isArray(rows) && rows.find((r) => r.lock_name === "production");
      process.stdout.write(hit && hit.holder === want && hit.expired === false ? "yes" : "no");
    } catch { process.stdout.write("no"); }
  ' "$LOCK_RESP" "$DEPLOY_LOCK_MCP_HOLDER" 2>/dev/null || echo no)"
  if [ "$LOCK_OK" != "yes" ]; then
    echo "REFUSING TO DEPLOY: MCP-held lock verification failed for holder '${DEPLOY_LOCK_MCP_HOLDER}'." >&2
    echo "Status response: $LOCK_RESP" >&2
    echo "Acquire (or re-acquire) the lock via the Supabase MCP tool first — see AGENTS.md." >&2
    exit 1
  fi
  echo "Deploy lock verified: held by '${DEPLOY_LOCK_MCP_HOLDER}' (unexpired). Release stays with the MCP session."
else
  HOLDER="safe-deploy:$(whoami)@$(hostname)-$$"
  scripts/deploy-lock.sh acquire "$HOLDER" "safe-deploy.sh" || exit 1
  trap 'scripts/deploy-lock.sh release "'"$HOLDER"'" >/dev/null 2>&1 || true' EXIT
fi
echo ""

# ── PREFLIGHT (owner P0 2026-07-10): the gate that makes losing approved UI IMPOSSIBLE. It proves
# HEAD CONTAINS the approved production baseline (nothing removed) + clean/on-main/HEAD==origin +
# no concurrent edits. Refuse the deploy if it fails. (The individual checks below are kept as
# defense-in-depth; preflight is the authoritative gate.) See scripts/preflight-verify.sh.
"$(dirname "$0")/preflight-verify.sh" || { echo ""; echo "safe-deploy: REFUSED by preflight (see the ❌ above). Nothing deployed."; exit 1; }
echo ""

# ── TAXONOMY GATE (Stage 1, 2026-07-10): OFFLINE, deterministic. Proves the single canonical source
# src/data/taxonomy.source.json still regenerates every deployed taxonomy artifact (the TS maps in
# propertyTypes.ts, the Python maps in normalize.py, and the 3 committed DB seed snapshots) with ZERO
# drift, and that the deployed map is internally consistent. Any taxonomy drift blocks the deploy here
# BEFORE Vercel is touched. This runs the IDENTICAL entrypoint Vercel runs (vercel.json buildCommand →
# `npm run verify`), so local preflight and the build image gate on exactly the same command. The gate
# is hermetic pure-TypeScript (no python3 / external interpreter): the normalize.py layer is parsed
# statically, so NO layer is ever skipped here or in the build image — it fails CLOSED everywhere.
npm run verify || { echo ""; echo "safe-deploy: REFUSED — taxonomy drift (see ❌ above). Regenerate with 'npm run verify:emit-sql' / 'npx tsx scripts/taxonomy/extract.ts', commit, and retry. Nothing deployed."; exit 1; }
echo ""

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "REFUSING TO DEPLOY: current branch is '$BRANCH', not 'main'."
  echo "Deploys must come from a clean, merged main only — see docs/DEPLOY_SAFETY.md."
  exit 1
fi

DIRTY="$(git status --short)"
if [ -n "$DIRTY" ]; then
  echo "REFUSING TO DEPLOY: working tree is not clean:"
  echo "$DIRTY"
  echo "Commit, push, and merge everything visible to users before deploying."
  exit 1
fi

git fetch origin main --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "REFUSING TO DEPLOY: local main ($LOCAL) does not match origin/main ($REMOTE)."
  echo "Push and/or pull before deploying — production must always match a commit that's really on GitHub."
  exit 1
fi

# ENV PREFLIGHT (added 2026-07-10 after a P0: a clean-main build has NO local .env — it's
# gitignored — so the Supabase EXPO_PUBLIC_* vars must live in the VERCEL PROJECT env, or the
# `supabase` client builds as null and EVERY search silently returns "try again" app-wide.
# See docs/DEPLOY_SAFETY.md "2026-07-10 incident".) These are the vars src/lib/supabase.ts reads.
REQUIRED_ENV=("EXPO_PUBLIC_SUPABASE_URL" "EXPO_PUBLIC_SUPABASE_KEY")
VERCEL_ENV_LS="$(npx vercel env ls production 2>/dev/null || true)"
MISSING=""
for v in "${REQUIRED_ENV[@]}"; do
  echo "$VERCEL_ENV_LS" | grep -q "$v" || MISSING="$MISSING $v"
done
if [ -n "$MISSING" ]; then
  echo "REFUSING TO DEPLOY: required Vercel PRODUCTION env var(s) missing:$MISSING"
  echo "A clean-main build has no local .env (gitignored), so these MUST be set in the Vercel"
  echo "project or the app's Supabase client builds as null and all search dies. Add them with:"
  echo "  printf '%s' \"<value>\" | npx vercel env add <NAME> production"
  echo "(values are in the local .env). See docs/DEPLOY_SAFETY.md."
  exit 1
fi

echo "Clean, on main, matches origin/main, required Vercel env present ($LOCAL). Deploying..."
npx vercel --prod --yes

# POST-DEPLOY ASSERTION: the served bundle MUST reference the Supabase host, proving the
# EXPO_PUBLIC_* vars were actually inlined at build time. A green Vercel build with a null client
# is the exact failure this catches.
#
# This POLLS with a bounded retry loop rather than a single check. Right after `vercel --prod`, the
# production alias can take tens of seconds to propagate the fresh bundle across Vercel's CDN, so the
# old `sleep 3` + single curl frequently WARNED on perfectly healthy deploys (false alarm — a manual
# re-check seconds later always found the marker; e.g. PR #48/FIX A, PR #58/dpl_2gVFqg). We now retry
# every 5s for up to ~90s and succeed the instant `supabase.co` appears. It is WARNING-ONLY and NEVER
# fails the script or triggers a rollback — a false negative must not block a good deploy.
# (Env inlining is a BUILD-TIME property of the Vercel PROJECT env: if ANY served bundle references
# supabase.co, the vars are present and every build — including this one — inlines them, so polling
# the alias is sufficient; we don't need to resolve the exact just-deployed bundle hash.)
echo ""
echo "Verifying the served bundle has the Supabase config baked in (polling up to ~90s for CDN propagation)..."
SUPA_OK=0
LIVE_BUNDLE=""
POLL_DEADLINE=$(( SECONDS + 90 ))
while [ "$SECONDS" -lt "$POLL_DEADLINE" ]; do
  LIVE_BUNDLE="$(curl -s https://ezhalah-app.vercel.app/ | grep -oE '_expo/static/js/web/entry-[a-f0-9]+\.js' | head -1 || true)"
  if [ -n "$LIVE_BUNDLE" ] && curl -s "https://ezhalah-app.vercel.app/$LIVE_BUNDLE" | grep -q "supabase.co"; then
    SUPA_OK=1
    break
  fi
  sleep 5
done
if [ "$SUPA_OK" = 1 ]; then
  echo "OK: live bundle ($LIVE_BUNDLE) references supabase.co — client will initialize."
else
  echo "WARNING: could not confirm supabase.co in the served bundle after ~90s (last seen: ${LIVE_BUNDLE:-none})."
  echo "This is warning-only and does NOT fail the deploy. If search shows «حاول مرة ثانية» app-wide, the"
  echo "env vars did NOT inline — investigate before declaring the deploy healthy (2026-07-10 P0 signature)."
  echo "If search works fine, this was just slow CDN propagation — re-grep the served bundle to confirm."
fi

# ── LIVE SEARCH SMOKE TEST (added 2026-07-15, after the PR #78 outage — a deploy that made the
# EXACT search RPC below hang indefinitely, app-wide, for real users). The bundle check above only
# proves the client CAN initialize; it says nothing about whether a real search actually completes.
# Every prior check in this script is "was the deploy correct", not "does the deployed app work" —
# this is the first one that actually calls the same RPC the app calls, against the just-deployed
# production database, and demands it return within a bound. UNLIKE the bundle check, this is
# BLOCKING: it fails the script (loud, before the baseline advances) rather than warning, because a
# hanging/erroring search is the single most severe class of regression this repo has shipped.
# The anon key here is the same EXPO_PUBLIC_SUPABASE_KEY already baked into the public client bundle
# (client-public by design, see docs/DEPLOY_SAFETY.md) — not a secret, safe to reference in a script.
echo ""
echo "Running the live search smoke test (calls location_search_candidates_ar against production, must return within 20s)..."
SMOKE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0"
SMOKE_URL="https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/rpc/location_search_candidates_ar"
SMOKE_START=$SECONDS
SMOKE_BODY='{"p_deal":"إيجار","p_rent_period":null,"p_cities":["Riyadh"],"p_districts":null,"p_tables":null,"p_platforms":null,"p_types":null,"p_tables2":null,"p_types2":null,"p_region_ids":null,"p_per_platform":null,"p_limit":5,"p_offset":0}'
SMOKE_RESPONSE=""
SMOKE_HTTP=""
SMOKE_HTTP="$(curl -s -o /tmp/safe-deploy-smoke-response.json -w '%{http_code}' --max-time 20 \
  -X POST "$SMOKE_URL" \
  -H "apikey: $SMOKE_ANON_KEY" \
  -H "Authorization: Bearer $SMOKE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "$SMOKE_BODY" || echo "curl_failed")"
SMOKE_ELAPSED=$(( SECONDS - SMOKE_START ))
if [ "$SMOKE_HTTP" = "200" ] && [ -s /tmp/safe-deploy-smoke-response.json ] && ! grep -q '"message"\s*:\s*"' /tmp/safe-deploy-smoke-response.json; then
  echo "OK: live search RPC responded ${SMOKE_ELAPSED}s (HTTP 200, valid body) — search is functionally alive."
  rm -f /tmp/safe-deploy-smoke-response.json
else
  echo ""
  echo "❌ REFUSING TO ADVANCE THE BASELINE: the live search RPC did not respond healthily."
  echo "   HTTP status: ${SMOKE_HTTP:-none} | elapsed: ${SMOKE_ELAPSED}s | response saved: /tmp/safe-deploy-smoke-response.json"
  echo "   This is EXACTLY the PR #78 failure signature (search silently hangs/errors for real users)."
  echo "   The Vercel deploy already happened (this check cannot un-deploy it) — but the baseline will"
  echo "   NOT advance, so the NEXT preflight-verify.sh will flag this commit as unapproved, and you"
  echo "   should roll back immediately: npx vercel rollback <previous-good-deployment-url> --yes"
  echo "   Investigate the response body, then re-run this script once genuinely fixed."
  exit 1
fi

# ── SCHEMA-DRIFT + DUPLICATE-OVERLOAD GATE (added 2026-07-16, batch 4 — after that morning's
# 16-minute search outage: a migration applied directly to prod via MCP, never committed to git,
# left location_search_candidates_ar with TWO overloads, and PostgREST refused EVERY search call
# with PGRST203 "ambiguous overload"). This calls public.ops_deploy_preflight_checks
# (supabase/migrations/20260716_batch4_deploy_preflight_rpc.sql) with every migration identifier
# committed to this repo (each file's leading digits AND its name — MCP-applied migrations get a
# server-minted timestamp version that never matches a date-only filename prefix), and REFUSES to
# advance the baseline if (a) any migration applied to prod after the 2026-07-16 recovery baseline
# is missing from git, or (b) any public function name has more than one overload — the exact
# PGRST203 failure shape. Same public anon key as the smoke test above. BLOCKING, with ONE
# exception: HTTP 404 (PGRST202 — function not in the schema cache) means the RPC itself has not
# shipped to prod yet, which is expected ONLY for the deploy that ships it, so it warns and
# continues instead of failing; every other non-200 fails CLOSED.
echo ""
echo "Running the schema-drift + duplicate-overload gate (ops_deploy_preflight_checks against production)..."
DRIFT_URL="https://aannarbkwcymrotzwdbo.supabase.co/rest/v1/rpc/ops_deploy_preflight_checks"
DRIFT_BODY="$(node -e '
  const fs = require("fs");
  const files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const ids = new Set();
  for (const f of files) {
    const base = f.replace(/\.sql$/, "");
    const m = base.match(/^([0-9]+)_(.+)$/);
    if (m) { ids.add(m[1]); ids.add(m[2]); } else { ids.add(base); }
  }
  process.stdout.write(JSON.stringify({ p_repo_versions: [...ids].sort() }));
')"
DRIFT_HTTP="$(curl -s -o /tmp/safe-deploy-drift-response.json -w '%{http_code}' --max-time 20 \
  -X POST "$DRIFT_URL" \
  -H "apikey: $SMOKE_ANON_KEY" \
  -H "Authorization: Bearer $SMOKE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "$DRIFT_BODY" || echo "curl_failed")"
if [ "$DRIFT_HTTP" = "404" ]; then
  echo "WARNING: ops_deploy_preflight_checks not found in production (HTTP 404) — the gate RPC has"
  echo "not shipped yet. Expected ONLY for the deploy that ships it (batch 4). Apply"
  echo "supabase/migrations/20260716_batch4_deploy_preflight_rpc.sql so every future deploy is gated."
elif [ "$DRIFT_HTTP" = "200" ]; then
  DRIFT_MISSING="$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/safe-deploy-drift-response.json","utf8")).missing_in_git.length' 2>/dev/null || echo "parse_error")"
  DRIFT_DUPS="$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/safe-deploy-drift-response.json","utf8")).duplicate_overloads.length' 2>/dev/null || echo "parse_error")"
  if [ "$DRIFT_MISSING" = "0" ] && [ "$DRIFT_DUPS" = "0" ]; then
    echo "OK: no uncommitted prod migrations past the baseline, no duplicate public function overloads."
    rm -f /tmp/safe-deploy-drift-response.json
  else
    echo ""
    echo "❌ REFUSING TO ADVANCE THE BASELINE: production schema drift detected."
    echo "   missing_in_git: $DRIFT_MISSING migration(s) applied to prod but absent from this repo"
    echo "   duplicate_overloads: $DRIFT_DUPS public function name(s) with more than one overload"
    echo "   Full response saved: /tmp/safe-deploy-drift-response.json — details:"
    node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("/tmp/safe-deploy-drift-response.json","utf8")), null, 2))' 2>/dev/null || cat /tmp/safe-deploy-drift-response.json
    echo "   Duplicate overloads are the EXACT 2026-07-16 outage signature (PGRST203: PostgREST refuses"
    echo "   every call to an ambiguous RPC — search dies app-wide), and uncommitted migrations are how"
    echo "   that overload got there. Recover the missing SQL verbatim into supabase/migrations/ (from"
    echo "   supabase_migrations.schema_migrations) and/or drop the stale overload, then re-run."
    exit 1
  fi
else
  echo ""
  echo "❌ REFUSING TO ADVANCE THE BASELINE: drift gate could not run (HTTP ${DRIFT_HTTP:-none})."
  echo "   Response (if any): /tmp/safe-deploy-drift-response.json. This check fails CLOSED — a gate"
  echo "   that cannot run must not bless a deploy. Fix connectivity / the RPC, then re-run."
  exit 1
fi

# ── ADVANCE THE APPROVED BASELINE to the just-deployed commit, so every FUTURE preflight refuses to
# deploy anything that doesn't contain THIS UI. This is what keeps the safety floor current. Metadata
# only (one line + a log entry); best-effort push — a failure here never undoes the successful deploy.
echo ""
echo "Recording $LOCAL as the new approved production baseline..."
{ echo "$LOCAL"; tail -n +2 docs/DEPLOY_BASELINE.txt; echo "# $(date +%F)  ${LOCAL:0:7}  deployed via safe-deploy.sh"; } > docs/DEPLOY_BASELINE.txt.tmp \
  && mv docs/DEPLOY_BASELINE.txt.tmp docs/DEPLOY_BASELINE.txt
if git add docs/DEPLOY_BASELINE.txt && git commit -m "chore(deploy): record approved baseline ${LOCAL:0:7}" --quiet; then
  git push origin main --quiet 2>/dev/null \
    && echo "Baseline advanced to ${LOCAL:0:7} and pushed." \
    || echo "WARNING: baseline commit made locally but push failed (main moved?). Push docs/DEPLOY_BASELINE.txt manually so the next preflight is accurate."
else
  echo "NOTE: baseline unchanged (no diff)."
fi

echo ""
echo "Deployed. Now verify search actually renders cards in a browser (not just the bundle), then"
echo "update the Approved baseline record table in docs/DEPLOY_SAFETY.md with the new deployment"
echo "ID + bundle hash. See 'Verifying a deploy' in that file."
