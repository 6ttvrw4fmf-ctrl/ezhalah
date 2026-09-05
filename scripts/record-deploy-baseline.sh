#!/usr/bin/env bash
# RECORD THE APPROVED PRODUCTION BASELINE — on a path that works under real branch protection.
#
# Usage:  scripts/record-deploy-baseline.sh <deployed-sha>   # called by safe-deploy.sh after a deploy
#         scripts/record-deploy-baseline.sh --probe          # exercise the path, change nothing
#
# WHY THIS IS ITS OWN FILE. It used to be eight inline lines at the bottom of safe-deploy.sh, which
# meant the only way to run it was to deploy production — and AGENTS.md forbids deploying in order to
# test the deploy pipeline. So the one step that had never been exercised was the one that silently
# broke: from PR #1470 (2026-09-01) to 2026-09-04 the baseline sat at 254baca while production moved,
# because on a GitHub runner `git commit` died on "Author identity unknown" and the failure branch
# printed the same line a healthy no-op prints. PR #1747 fixed the silence (identity supplied inline
# with `git -c`, both SHAs named on failure). It did NOT fix the PUSH, which is the half that cannot
# work: `git push origin main` from a runner is refused by branch protection, and this repo's
# GITHUB_TOKEN is read-only by default (Settings → Actions → Workflow permissions = "Read"), so the
# push fails before protection even gets a say. The baseline advanced on 2026-09-04 only because a
# human carried it in a hand-written PR.
#
# WHAT THIS DOES INSTEAD, in order, stopping at the first that succeeds:
#   1. NOTHING TO DO — the file already records this SHA. Said in its own words, never mistakable
#      for a failure (that confusion is the 2026-09-01 bug).
#   2. DIRECT PUSH to main. Still the fast path for a laptop run by someone whose account may push
#      to main. Under protection it is refused, and a refusal here is not an error — it is step 3.
#   3. A BASELINE PR. Push the one-file commit to `deploy/baseline-<sha>` and open a PR. This is the
#      path protection is designed to allow, and it is the same act the human did by hand. The local
#      commit is then rewound, because safe-deploy's own preflight refuses to run again while HEAD
#      differs from origin/main — a "fix" that jams the next deploy is not a fix.
#   4. LOUD FAILURE. If the baseline could not be recorded by any path, print the phrase
#      deploy-frontend.yml's Report step greps for and exit 1, so the run goes RED and says
#      production moved while the recorded floor did not. It must never exit 0 having done nothing.
#
# THE ONE THING ONLY THE OWNER CAN DO. A PR opened with the built-in GITHUB_TOKEN does NOT trigger
# other workflows (GitHub's recursion guard), so its three required checks never even start. Give
# the deploy a repository secret named BASELINE_PR_TOKEN (a fine-grained PAT with Contents:
# read+write and Pull requests: read+write on this repo) and pushes made with it DO start the
# required checks, so the PR can go green. This script prefers that token when it is present and
# works without it otherwise.
#
# This script never merges the baseline PR — merging it either way is a human click, or a run of
# the one sanctioned merge gate (`scripts/safe-pr-merge.ts`, AGENTS.md) once its required checks are
# green. Nothing here bypasses a gate, and nothing here becomes a second one: the baseline PR runs
# the same required checks as any other PR, and only the sanctioned gate (or a human) ever merges it.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASELINE_FILE="docs/DEPLOY_BASELINE.txt"
GIT_ID=(-c user.name="ezhalah-deploy" -c user.email="deploy@users.noreply.github.com")
# The PAT wins when present; github.token is the fallback. `gh` reads GH_TOKEN.
export GH_TOKEN="${BASELINE_PR_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}"

have_gh() { command -v gh >/dev/null 2>&1 && [ -n "$GH_TOKEN" ]; }

# Push as the TOKEN when one is supplied, not as whatever credential the checkout persisted. This is
# the whole point of BASELINE_PR_TOKEN: a branch pushed with the built-in GITHUB_TOKEN starts no
# workflows (GitHub's recursion guard), so the baseline PR's required checks never run and it can
# never merge itself. Output is scrubbed because git echoes the remote URL on failure.
push_to() {  # $1 = refspec
  local remote target
  remote="$(git remote get-url origin)"
  target="origin"
  case "$remote" in
    https://github.com/*) [ -n "$GH_TOKEN" ] && target="https://x-access-token:${GH_TOKEN}@github.com/${remote#https://github.com/}" ;;
  esac
  git push "$target" "$1" --quiet 2>&1 | sed 's|x-access-token:[^@]*@|x-access-token:***@|g'
  return "${PIPESTATUS[0]}"
}

open_baseline_pr() {   # $1 = sha, $2 = branch
  local sha="$1" branch="$2" url=""
  push_to "+HEAD:refs/heads/$branch" || return 1
  have_gh || { echo "   (no gh CLI or no token — branch $branch IS pushed; open the PR by hand)"; return 1; }
  url="$(gh pr create --base main --head "$branch" \
        --title "chore(deploy): record approved baseline ${sha:0:7}" \
        --body "Automated by \`scripts/record-deploy-baseline.sh\` after a production deploy of \`$sha\`.

\`docs/DEPLOY_BASELINE.txt\` records the commit production actually serves; every future
\`preflight-verify.sh\` refuses to deploy anything that does not contain it. A direct push to main is
refused by branch protection from a runner, so the baseline is recorded the way protection intends —
as a PR, running the same required checks as any other." 2>&1)" || { echo "   gh pr create failed: $url"; return 1; }
  echo "   Baseline PR: $url"
  # This script never merges it. AGENTS.md's merge gate is a single sanctioned door
  # (scripts/safe-pr-merge.ts) and nothing else in the tree may invoke that GitHub action or call
  # its CLI equivalent (scripts/verify-merge-gate-transport.ts enforces that by scanning every
  # tracked file) — arming GitHub's own auto-merge here would be exactly the second door that rule
  # exists to prevent. Advance the floor via `scripts/safe-pr-merge.ts` once its required checks
  # are green, or by hand.
  echo "   MERGE THIS PR to advance the recorded floor — via scripts/safe-pr-merge.ts once its" \
       "required checks are green, or by hand."
  return 0
}

# ── PROBE ────────────────────────────────────────────────────────────────────────────────────────
# Answers "would the baseline actually get recorded from here?" WITHOUT deploying and WITHOUT
# touching main. It never pushes to main: nothing may move main outside a PR, so the push half is
# reported from the authority that decides it (the token's own permissions + main's protection),
# and the fallback half is exercised for real — a branch is pushed, a PR is opened, then both are
# removed again.
if [ "${1:-}" = "--probe" ]; then
  echo "── baseline recording path probe (nothing is deployed, main is not touched) ──"
  if have_gh; then
    echo "token can push to this repo : $(gh api repos/{owner}/{repo} --jq .permissions.push 2>/dev/null || echo unknown)"
    echo "main required checks        : $(gh api repos/{owner}/{repo}/branches/main/protection --jq '[.required_status_checks.contexts[]]|join(", ")' 2>/dev/null || echo 'unreadable with this token')"
  else
    echo "no gh CLI or no token in the environment — the PR fallback CANNOT run from here."
    exit 1
  fi
  BR="deploy/baseline-probe-$(date +%s)"
  git "${GIT_ID[@]}" commit --allow-empty -m "probe: baseline recording path (deleted immediately)" --quiet || {
    echo "❌ probe: cannot commit (git identity?)"; exit 1; }
  if open_baseline_pr "probe" "$BR"; then
    echo "✓ the PR fallback works from here — closing the probe PR and deleting its branch."
    gh pr close "$BR" --delete-branch >/dev/null 2>&1 || git push origin --delete "$BR" >/dev/null 2>&1 || true
    git reset --hard HEAD~1 --quiet
    exit 0
  fi
  git reset --hard HEAD~1 --quiet
  echo "❌ the PR fallback FAILED from here — a deploy would not be able to record its baseline."
  echo "   Fix: give the deploy job 'permissions: contents: write, pull-requests: write' and a"
  echo "   GH_TOKEN, or add the BASELINE_PR_TOKEN secret described at the top of this file."
  exit 1
fi

# ── RECORD ───────────────────────────────────────────────────────────────────────────────────────
LOCAL="${1:?usage: record-deploy-baseline.sh <deployed-sha> | --probe}"
RECORDED_SHA="$(head -1 "$BASELINE_FILE")"           # BEFORE the rewrite — what a failure must report
RECORDED="${RECORDED_SHA:0:7}"
echo ""
# Ask BEFORE rewriting. The rewrite appends a dated log line every time it runs, so `git diff` can
# never be empty afterwards — the old no-op branch was unreachable, and a re-run grew the file by a
# duplicate line and made a pointless commit.
if [ "$RECORDED_SHA" = "$LOCAL" ]; then
  echo "NOTE: baseline already records ${LOCAL:0:7} — nothing to commit."
  exit 0
fi
echo "Recording $LOCAL as the new approved production baseline..."
{ echo "$LOCAL"; tail -n +2 "$BASELINE_FILE"; echo "# $(date +%F)  ${LOCAL:0:7}  deployed via safe-deploy.sh"; } > "$BASELINE_FILE.tmp" \
  && mv "$BASELINE_FILE.tmp" "$BASELINE_FILE"

if git diff --quiet -- "$BASELINE_FILE"; then
  echo "NOTE: baseline already records ${LOCAL:0:7} — nothing to commit."
  exit 0
fi

if ! { git add "$BASELINE_FILE" && git "${GIT_ID[@]}" commit -m "chore(deploy): record approved baseline ${LOCAL:0:7}" --quiet; }; then
  echo "❌ REFUSING TO ADVANCE THE BASELINE: the commit FAILED — this is NOT a no-op."
  echo "   $BASELINE_FILE still records $RECORDED while production now serves ${LOCAL:0:7}, so the"
  echo "   next preflight measures against a stale floor. Record $LOCAL by PR."
  exit 1
fi

if push_to "HEAD:main"; then
  echo "Baseline advanced to ${LOCAL:0:7} and pushed to main."
  exit 0
fi

echo "Direct push to main refused (branch protection, or main moved) — recording it as a PR instead."
BRANCH="deploy/baseline-${LOCAL:0:7}"
if open_baseline_pr "$LOCAL" "$BRANCH"; then
  # Rewind the local commit: safe-deploy's own preflight refuses to run while HEAD != origin/main,
  # so leaving it here would jam the NEXT deploy. The commit is safe on the remote branch.
  git reset --hard HEAD~1 --quiet
  echo "Baseline recorded as a pull request. It advances the floor when that PR merges."
  exit 0
fi

git reset --hard HEAD~1 --quiet
echo "❌ REFUSING TO ADVANCE THE BASELINE: it could be neither pushed to main nor opened as a PR."
echo "   Production now serves ${LOCAL:0:7} while $BASELINE_FILE still records $RECORDED, so the next"
echo "   preflight measures against a STALE floor and this run is RED on purpose."
echo "   One-step fix for the owner: add repository secret BASELINE_PR_TOKEN (fine-grained PAT,"
echo "   Contents: read+write + Pull requests: read+write on this repo) — see the top of this file."
echo "   Until then, open a PR setting the first line of $BASELINE_FILE to $LOCAL."
exit 1
