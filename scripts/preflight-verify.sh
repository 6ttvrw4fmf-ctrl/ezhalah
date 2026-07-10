#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────
# PREFLIGHT DEPLOY VERIFICATION (owner P0, 2026-07-10) — make a UI-losing deploy IMPOSSIBLE, not
# just unlikely. READ-ONLY. Exit 0 = safe to deploy; non-zero = REFUSE, with the exact reason.
#
# safe-deploy.sh runs this before every deploy; you can also run it standalone anytime to answer
# "is it safe to deploy right now?" without deploying.
#
# The five guarantees the owner requires before ANY production deploy:
#   1. Nothing from the approved UI will be removed.
#   2. origin/main contains every approved feature currently in production.
#   3. The deployment matches the approved production baseline.
#   4. No local-only or uncommitted work is required for the deployment.
#   5. No concurrent session is modifying the same files.
#
# The KEY guard the previous safe-deploy lacked (and the exact cause of the 2026-07-09 incident):
# HEAD must CONTAIN the approved production baseline. A stale/reset `main` that == origin/main but is
# missing production's UI passes every other check — this one catches it and refuses.
# ─────────────────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
FAIL=0
ok(){   printf '  ✓ %s\n' "$*"; }
bad(){  printf '  ❌ %s\n' "$*"; FAIL=1; }
warn(){ printf '  ⚠ %s\n' "$*"; }

BASELINE_FILE="docs/DEPLOY_BASELINE.txt"
PROJECT_ID="${VERCEL_PROJECT_ID:-prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX}"
TEAM_ID="${VERCEL_TEAM_ID:-team_0lVrGRoJbCRIWovPNkfnmwJ7}"

echo "── (4) source of truth: on main, clean, HEAD == origin/main ──────────────────"
git fetch origin main --quiet
BRANCH="$(git branch --show-current)"
[ "$BRANCH" = "main" ] || bad "not on 'main' (on '$BRANCH'). Deploy only from a clean merged main."
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then bad "working tree NOT clean — local-only/uncommitted work would be needed to reproduce this deploy:"; echo "$DIRTY" | sed 's/^/       /'; else ok "working tree clean (no local-only work)"; fi
HEAD_SHA="$(git rev-parse HEAD)"; ORIGIN_SHA="$(git rev-parse origin/main)"
[ "$HEAD_SHA" = "$ORIGIN_SHA" ] && ok "HEAD == origin/main ($HEAD_SHA)" || bad "HEAD ($HEAD_SHA) != origin/main ($ORIGIN_SHA) — push/pull so prod matches a commit really on GitHub."

echo "── (5) no concurrent session modifying the same files ────────────────────────"
if [ -f .git/index.lock ]; then bad "a git operation is in progress (.git/index.lock) — another process is active. Wait and retry."; else ok "no in-progress git operation / lock"; fi
CONC=0
while read -r wt; do
  [ -z "$wt" ] && continue; [ "$wt" = "$(pwd)" ] && continue
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then warn "another worktree has uncommitted changes: $wt (not the deploy tree, so it won't ship — but confirm no one is mid-edit)"; CONC=1; fi
done < <(git worktree list --porcelain | awk '/^worktree /{print $2}')
[ "$CONC" = 0 ] && ok "no other worktree has uncommitted changes"

echo "── (1,2,3) HEAD CONTAINS the approved production baseline (nothing removed) ───"
if [ ! -f "$BASELINE_FILE" ]; then
  bad "$BASELINE_FILE missing — cannot prove HEAD contains the approved production UI. Refusing."
else
  BASELINE="$(grep -oE '^[0-9a-f]{7,40}' "$BASELINE_FILE" | head -1)"
  if [ -z "$BASELINE" ]; then bad "$BASELINE_FILE has no baseline commit SHA."
  elif ! git cat-file -e "${BASELINE}^{commit}" 2>/dev/null; then bad "recorded baseline $BASELINE not found locally — 'git fetch --all' and retry."
  elif git merge-base --is-ancestor "$BASELINE" HEAD 2>/dev/null; then
    ok "HEAD contains the approved production baseline ($BASELINE) — no approved feature is dropped"
    # This guard protects SHIPPED UI/assets. TEST files (*.test.ts(x), *.spec.ts(x), __tests__/) are
    # never imported into the app bundle, so deleting one cannot remove any approved UI — excluding
    # them stops a false "UI would be removed" refusal when a unit test is refactored/relocated (e.g.
    # src/lib/inputHygiene.test.ts → scripts/verify-whole-number-input.ts in #58). Real src/ or assets/
    # deletions are still caught. (git pathspec :(exclude) magic.)
    DEL="$(git diff --diff-filter=D --name-only "$BASELINE" HEAD -- src/ assets/ \
      ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/*.spec.ts' ':(exclude)**/*.spec.tsx' ':(exclude)**/__tests__/**' 2>/dev/null || true)"
    if [ -z "$DEL" ]; then ok "no shipped src/ or assets/ file removed vs the approved baseline (test files excluded)"; else bad "file(s) present in the approved baseline are DELETED in HEAD (approved UI would be removed):"; echo "$DEL" | sed 's/^/       /'; fi
  else
    bad "HEAD does NOT contain the approved production baseline ($BASELINE) — this is the incident. Approved commits that are in production but MISSING from HEAD (WOULD BE LOST):"
    git log --oneline "$BASELINE" "^HEAD" 2>/dev/null | sed 's/^/       /'
    printf '       → refuse. Rebase/merge the baseline into HEAD before deploying.\n'
  fi
fi

echo "── (2, authoritative) HEAD contains the LIVE production commit (Vercel) ──────"
if [ -n "${VERCEL_TOKEN:-}" ] && command -v curl >/dev/null 2>&1; then
  PROD_SHA="$(curl -s -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&target=production&state=READY&limit=1" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); dp=(d.get('deployments') or [{}])[0].get('meta',{}); print(dp.get('gitCommitSha') or dp.get('githubCommitSha') or '')" 2>/dev/null || true)"
  if [ -n "$PROD_SHA" ] && git cat-file -e "${PROD_SHA}^{commit}" 2>/dev/null; then
    git merge-base --is-ancestor "$PROD_SHA" HEAD 2>/dev/null \
      && ok "HEAD contains the LIVE production commit ($PROD_SHA)" \
      || bad "LIVE production ($PROD_SHA) is NOT contained in HEAD — deploying would REGRESS production. Update the baseline + rebase before deploying."
  else warn "could not resolve/fetch the live production SHA ('$PROD_SHA') — relying on the recorded baseline above."; fi
else
  warn "VERCEL_TOKEN not set — skipping the live-prod cross-check; relying on the recorded baseline in $BASELINE_FILE."
fi

echo ""
if [ "$FAIL" = 0 ]; then echo "✅ PREFLIGHT PASSED — HEAD ($HEAD_SHA) is safe to deploy (contains the approved UI, clean, on main)."; exit 0
else echo "🛑 PREFLIGHT FAILED — DO NOT DEPLOY. Every ❌ above is a way an approved feature could be lost. Fix, then re-run."; exit 1; fi
