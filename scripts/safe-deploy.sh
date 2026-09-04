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

# Single source of truth for the production-target lock (constants + pure predicates). The exact
# same predicates are re-checked by preflight-verify.sh and exercised by the permanent regression
# test scripts/verify-deploy-target-guard.ts, so this guard can never silently drift.
. scripts/deploy-target-guard.sh

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

# ── PRODUCTION TARGET LOCK (owner P0, non-negotiable — 2026-07-21): the ONLY production frontend
# URL is https://ezhalah-app.vercel.app. `vercel --prod` below deploys to whatever Vercel project
# `.vercel/project.json` is linked to — and a worktree that got a stray `vercel link`, or a fresh
# worktree linked to the wrong/new project, would deploy the app SOMEWHERE ELSE while the
# post-deploy check kept reading the (unchanged, still-valid) ezhalah-app.vercel.app bundle and
# reported success. Refuse unless the link is provably the canonical ezhalah-app project.
if [ ! -f .vercel/project.json ]; then
  echo "REFUSING TO DEPLOY: .vercel/project.json is missing — this checkout is not linked to a Vercel"
  echo "project, so 'vercel --prod' would prompt/pick interactively and could deploy off-target."
  echo "Link it to the canonical project first (copy the non-secret projectId/orgId from the main"
  echo "checkout's .vercel/project.json), then retry. Target must be $DTG_EXPECT_PROJECT_NAME."
  exit 1
fi
if ! dtg_link_is_canonical .; then
  echo "REFUSING TO DEPLOY: this checkout is linked to the WRONG Vercel project."
  echo "  expected: name=$DTG_EXPECT_PROJECT_NAME id=$DTG_EXPECT_PROJECT_ID"
  echo "  linked:   name=$(dtg_read_link_field . projectName || echo '<none>') id=$(dtg_read_link_field . projectId || echo '<none>')"
  echo "Production frontend deploys go ONLY to $DTG_CANONICAL_URL (owner rule 2026-07-21)."
  echo "Re-link to the canonical project before deploying — never deploy against a different link."
  exit 1
fi
echo "Target lock OK: linked to $DTG_EXPECT_PROJECT_NAME ($DTG_EXPECT_PROJECT_ID) → $DTG_CANONICAL_URL"

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
# Capture what the canonical alias serves BEFORE deploying. If the fresh deployment's own unique URL
# can never be read below (deployment protection / a cold-start URL nobody has hit yet), this is the
# fallback proof that the alias actually MOVED to something new.
PRE_BUNDLE="$(curl -s -H 'Cache-Control: no-cache' "https://ezhalah-app.vercel.app/?_=$(date +%s%N)" | grep -oE '_expo/static/js/web/entry-[a-f0-9]+\.js' | head -1 || true)"

# Capture the unique deployment URL vercel prints, and — the load-bearing one — the artifact THIS
# BUILD EMITTED. Expo prints it in the build log ("› web bundles (1): _expo/.../entry-<md5>.js"), so
# "what did we just build" is known WITHOUT any network read at all.
#
# ── THE TWO STREAMS ARE CAPTURED SEPARATELY, ON PURPOSE (2026-09-04) ──────────────────────────────
# This block used to be `npx vercel --prod --yes | tee "$DEPLOY_LOG"`, which captures STDOUT ONLY —
# and in the pinned CLI (vercel 54.18.0) the build log is NOT on stdout. Everything the CLI prints
# goes through `output_manager_default` = `new Output(process.stderr, …)`
# (node_modules/vercel/dist/chunks/chunk-Z5SBJH6L.js:4673; Output.print → this.stream.write), and
# the build log specifically is `displayBuildLogs → printBuildLog(event, output_manager_default.print)`
# (chunk-UNIIXDM2.js:1741). The ONLY stdout write on the deploy path is the bare deployment URL
# (chunk-UNIIXDM2.js:2077 `process.stdout.write("https://" + event.payload.url)`). So the
# `› web bundles (1): _expo/.../entry-<md5>.js` line never reached DEPLOY_LOG, EMITTED_BUNDLE was
# ALWAYS empty, EXPECTED_BUNDLE fell back to the (unreadable, protection-gated) NEW_BUNDLE, and the
# gate collapsed onto the PRE_BUNDLE-diff last resort this whole guard exists to remove.
# They are captured to SEPARATE files rather than merged with `2>&1` because a merged log breaks the
# URL parse: stderr also carries `▲ Aliased  https://ezhalah-app.vercel.app`, so `tail -1` of a
# merged log would set DEPLOYED_URL to the CANONICAL ALIAS — making the fallback read the alias to
# learn what the alias should serve, which is circular and always "passes".
# Stderr is written to a file and echoed after the CLI exits (rather than streamed through a
# process-substitution tee) so the read below cannot race an unflushed tee. The build log therefore
# appears at the end of the step instead of live; that is the whole cost of this trade.
DEPLOY_LOG="$(mktemp)"
DEPLOY_ERR="$(mktemp)"
DEPLOY_RC=0
npx vercel --prod --yes 2>"$DEPLOY_ERR" | tee "$DEPLOY_LOG" || DEPLOY_RC=$?
cat "$DEPLOY_ERR" >&2
if [ "$DEPLOY_RC" -ne 0 ]; then
  echo "REFUSING TO CONTINUE: 'vercel --prod' exited $DEPLOY_RC (see its output above)."
  rm -f "$DEPLOY_LOG" "$DEPLOY_ERR"
  exit "$DEPLOY_RC"
fi
# stdout only: the bare deployment URL. Never parse this out of the merged streams (see above).
DEPLOYED_URL="$(grep -oE 'https://[a-z0-9.-]+\.vercel\.app' "$DEPLOY_LOG" | tail -1 || true)"
# stderr carries the build log; stdout is searched too so this keeps working if a future CLI moves it.
EMITTED_BUNDLE="$(grep -hoE '_expo/static/js/web/entry-[a-f0-9]+\.js' "$DEPLOY_ERR" "$DEPLOY_LOG" | head -1 || true)"
rm -f "$DEPLOY_LOG" "$DEPLOY_ERR"

# ── POST-DEPLOY BUNDLE VERIFICATION (rewritten 2026-09-03 after run 33706257876) ───────────────────
# This used to be TWO sequential checks. One polled ANY currently-served bundle for `supabase.co`
# (warning-only, ~90s) — it could pass on a STALE bundle that never changed, proving nothing about
# THIS deploy. The other read the fresh deployment's unique URL ONCE, with no retry, to learn the
# expected bundle hash for dtg_alias_serves (blocking, ~90s) — on 2026-09-03 that single curl
# returned nothing in 69ms on a perfectly healthy deploy, so it warned-and-skipped and the propagation
# match never actually ran. Merged into ONE bounded, cache-busted, BLOCKING loop.
#
# ── WHAT THIS ASSERTS, AND WHY IT CHANGED AGAIN (run 33776354197, 2026-09-03) ──────────────────────
# The merged loop then failed CLOSED on a HEALTHY deploy, and the reason was that it was asserting the
# wrong invariant. Its expected-hash source was the deployment's own URL, which is behind Vercel
# deployment protection and answers HTTP 302 → vercel.com/sso-api (15 bytes) — unreadable, always. So
# it fell through to the only other proof it had: "the alias hash must DIFFER from PRE_BUNDLE". A
# rebuild that is byte-identical to what is already live emits the SAME md5-named bundle, so that
# demand is UNSATISFIABLE — the deploy shipped, `▲ Aliased https://ezhalah-app.vercel.app` printed,
# the blocking hydration gate passed, and the step still went red, so the baseline never advanced and
# every subsequent preflight flagged main as unapproved.
#
# The TRUE invariant — the one that is satisfiable for an identical rebuild and still fails on a stale
# or off-target alias — is: THE ALIAS SERVES THE ENTRY THIS RUN EMITTED, AND THOSE BYTES REALLY ARE
# THAT ENTRY. Both halves are now proven, and neither depends on the protected per-deployment URL:
#   (a) the alias's entry path == EMITTED_BUNDLE, read from THIS run's own build log (dtg_alias_serves,
#       the same predicate the regression test asserts — never satisfied by an empty or stale read);
#   (b) md5(the bytes the alias actually returns) == the hash in that filename (dtg_bundle_is_authentic).
#       Expo content-hashes the web entry bundle, so name and bytes must agree; a stale alias, an error
#       page, or a truncated CDN read all fail here;
#   (c) those same bytes contain supabase.co, proving the EXPO_PUBLIC_* vars inlined at build time.
# Deployment protection is therefore no longer on the critical path: the deployment-URL read is kept
# ONLY as a fallback for the case where the build log names no bundle (a reused/cached deployment that
# never ran the export), and the PRE_BUNDLE-diff fallback below it only for when neither source knows
# what was built. Deliberately NOT added: a protection-bypass token — the repo has none, and the build
# log makes one unnecessary. Add one only if a future check genuinely needs the deployment URL itself.
# Window is 5 minutes, not 90s: CDN propagation is the documented false-negative mode here (PR
# #48/FIX A, PR #58/dpl_2gVFqg) — a bounded wait is cheaper than a false "investigate now" alarm.
# BLOCKING: do not weaken this into a warning, a bypass flag, or a hash-agnostic "something is served"
# check — a bundle that never proves the Supabase config is the 2026-07-10 P0 signature, and an alias
# that never proves it serves THIS build is the 2026-07-21 off-target signature.
echo ""
echo "Verifying the canonical alias serves the bundle this run emitted (${EMITTED_BUNDLE:-<not named in the build log>}), polling up to 5m..."
NEW_BUNDLE=""
ALIAS_BUNDLE=""
EXPECTED_BUNDLE=""
BUNDLE_OK=0
AUTH_FAIL=""
SUPA_FAIL=""
# ── WHY the read failed, not just that it did (routine #7, 2026-09-03, issue #1563) ───────────────
# 14 consecutive deploys (runs 242-254) ended `failure` here reporting `alias now serving: <none>`
# and `expected: <never readable>` — EMPTY reads, which is a different fact from "the alias did not
# move" and the message could not tell them apart. These vars capture the HTTP status and body size
# of the LAST read of each URL, in the SAME request (`-o` + `-w`, no extra traffic — deliberately,
# since request volume is itself one of the hypotheses), and the failure block prints them.
ALIAS_BODY="$(mktemp)"; NEW_BODY="$(mktemp)"; BUNDLE_BODY="$(mktemp)"
ALIAS_HTTP=""; NEW_HTTP=""
ALIAS_BYTES=0; NEW_BYTES=0
POLL_DEADLINE=$(( SECONDS + 300 ))
while [ "$SECONDS" -lt "$POLL_DEADLINE" ]; do
  # Only consult the deployment's own URL when the build log did NOT name the emitted bundle. It is
  # normally unreadable (deployment protection), and skipping it halves this loop's request volume.
  if [ -z "$EMITTED_BUNDLE" ] && [ -z "$NEW_BUNDLE" ] && [ -n "${DEPLOYED_URL:-}" ]; then
    NEW_HTTP="$(curl -s -o "$NEW_BODY" -w '%{http_code}' -H 'Cache-Control: no-cache' "${DEPLOYED_URL}/?_=$(date +%s%N)" || echo 000)"
    NEW_BUNDLE="$(grep -oE '_expo/static/js/web/entry-[a-f0-9]+\.js' "$NEW_BODY" 2>/dev/null | head -1 || true)"
  fi
  EXPECTED_BUNDLE="${EMITTED_BUNDLE:-$NEW_BUNDLE}"
  ALIAS_HTTP="$(curl -s -o "$ALIAS_BODY" -w '%{http_code}' -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' "https://ezhalah-app.vercel.app/?_=$(date +%s%N)" || echo 000)"
  ALIAS_BUNDLE="$(grep -oE '_expo/static/js/web/entry-[a-f0-9]+\.js' "$ALIAS_BODY" 2>/dev/null | head -1 || true)"
  MATCHED=0
  # dtg_alias_serves: succeeds ONLY when the canonical alias serves the exact bundle this run built
  # (same predicate the regression test asserts) — never on an empty/stale read.
  if dtg_alias_serves "$EXPECTED_BUNDLE" "$ALIAS_BUNDLE"; then
    MATCHED=1
  elif [ -z "$EXPECTED_BUNDLE" ] && [ -n "$ALIAS_BUNDLE" ] && [ "$ALIAS_BUNDLE" != "$PRE_BUNDLE" ]; then
    MATCHED=1 # Nothing knows what was built; the alias moving away from PRE_BUNDLE is the last-resort proof it advanced.
  fi
  if [ "$MATCHED" = 1 ]; then
    # Accept-Encoding: identity — md5 must be taken over the artifact's own bytes, not a re-encoding.
    curl -s -o "$BUNDLE_BODY" -H 'Accept-Encoding: identity' -H 'Cache-Control: no-cache' \
      "https://ezhalah-app.vercel.app/$ALIAS_BUNDLE?_=$(date +%s%N)" || true
    if ! dtg_bundle_is_authentic "$BUNDLE_BODY" "$ALIAS_BUNDLE"; then
      AUTH_FAIL="md5($(wc -c < "$BUNDLE_BODY" 2>/dev/null || echo 0) bytes)=$(dtg_md5 "$BUNDLE_BODY" 2>/dev/null || echo '<none>')"
    elif ! grep -q "supabase.co" "$BUNDLE_BODY"; then
      SUPA_FAIL="yes"
    else
      BUNDLE_OK=1
      break
    fi
  fi
  sleep 5
done
ALIAS_BYTES="$(wc -c < "$ALIAS_BODY" 2>/dev/null || echo 0)"
NEW_BYTES="$(wc -c < "$NEW_BODY" 2>/dev/null || echo 0)"
ALIAS_HEAD="$(head -c 200 "$ALIAS_BODY" 2>/dev/null | tr -d '\n' || true)"
rm -f "$ALIAS_BODY" "$NEW_BODY" "$BUNDLE_BODY"
if [ "$BUNDLE_OK" = 1 ]; then
  echo "OK: https://ezhalah-app.vercel.app serves $ALIAS_BUNDLE — the entry this run emitted; md5(bytes) matches its filename, and it references supabase.co."
else
  echo ""
  echo "❌ REFUSING TO ADVANCE THE BASELINE: the canonical alias never proved it serves the bundle"
  echo "   this run built, with matching bytes and the Supabase config, after 5 minutes."
  echo "   before deploy:                 ${PRE_BUNDLE:-<none>}"
  echo "   this run emitted (build log):  ${EMITTED_BUNDLE:-<not named in the build log>}"
  echo "   expected (from $DEPLOYED_URL):  ${NEW_BUNDLE:-<never readable — normal, deployment protection>}"
  echo "   alias now serving:              ${ALIAS_BUNDLE:-<none>}"
  # An EMPTY read and a STALE read are different failures and used to print identically (issue #1563).
  echo "   last alias read:                HTTP ${ALIAS_HTTP:-000}, ${ALIAS_BYTES} bytes"
  echo "   last deployment-URL read:       HTTP ${NEW_HTTP:-000}, ${NEW_BYTES} bytes"
  echo "   alias body starts:              ${ALIAS_HEAD:-<empty>}"
  if [ -n "$AUTH_FAIL" ]; then
    echo "   served bytes DID NOT match that filename's hash: $AUTH_FAIL — not the artifact it claims"
    echo "   to be (error page / truncated CDN read). Re-read the alias before trusting this deploy."
  fi
  if [ -n "$SUPA_FAIL" ]; then
    echo "   bundle is authentic but contains NO supabase.co — the EXPO_PUBLIC_* vars did not inline"
    echo "   (2026-07-10 P0 signature). Investigate before declaring this deploy healthy."
  fi
  echo "   Read those lines FIRST. If 'this run emitted' and 'alias now serving' DIFFER, the alias did"
  echo "   not advance to this build — promote it: npx vercel promote ${DEPLOYED_URL:-<unknown>} --yes"
  echo "   On the alias read: HTTP 200 with a healthy byte count but no entry- hash means the page"
  echo "   rendered without the bundle reference; 401/403 means deployment protection or a bot"
  echo "   challenge; 429 means this loop's own request rate; 000 means the runner could not connect"
  echo "   at all. Only the first of those is a deploy problem. A <never readable> deployment-URL read"
  echo "   is EXPECTED and no longer matters — the build log is the source of the expected hash."
  echo "   The Vercel deploy already happened (this check cannot un-deploy it) — but the baseline will"
  echo "   NOT advance, so the NEXT preflight-verify.sh will flag this commit as unapproved."
  exit 1
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
# Shared with scripts/verify-migration-drift-vs-production.ts (the continuous, push/schedule-driven
# half of this same gate) so there is exactly ONE parser for "what migrations does the repo claim" —
# see build-repo-migration-versions.cjs's header for why a second copy is exactly the kind of drift
# this repo keeps getting bitten by.
DRIFT_BODY="$(node -e 'process.stdout.write(JSON.stringify({p_repo_versions: require("./scripts/build-repo-migration-versions.cjs").buildRepoMigrationVersions()}))')"
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
