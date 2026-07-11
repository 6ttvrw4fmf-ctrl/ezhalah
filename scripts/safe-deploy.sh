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
