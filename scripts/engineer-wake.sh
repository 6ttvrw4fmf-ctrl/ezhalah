#!/usr/bin/env bash
# Wakes an engineer routine for a failed workflow run, but ONLY for NEW failures: jobs that failed
# in this run and did not fail in the previous completed run of the same workflow. A job that was
# already failing last time is being handled (or the nightly run will handle it), so waking again
# only burns a session. Owner, 2026-09-27: the ⚡ Scraping Engineer ran 7 times in one afternoon,
# 3 of them for one site (awal) that was already switched off and out of tries, and its own crawl
# re-runs woke a second copy of itself.
#
# Called by scraping-engineer-wake-up.yml and lifecycle-engineer-wake-up.yml. Needs `gh` with
# GH_TOKEN (actions: read). DRY_RUN=1 prints the decision instead of firing.
set -euo pipefail
: "${REPO:?}" "${RUN_ID:?}" "${WORKFLOW_ID:?}" "${WF_NAME:?}" "${RUN_URL:?}" "${ENGINEER:?}" "${KIND:?}" "${SCOPE:?}"

if [ -z "${DRY_RUN:-}" ] && { [ -z "${FIRE_URL:-}" ] || [ -z "${FIRE_TOKEN:-}" ]; }; then
  echo "::notice::$ENGINEER wake-up not configured yet (no fire URL/token secret) — skipping."
  exit 0
fi

failed_jobs() {  # $1 = run id → one failed job name per line, sorted
  local page=1 body
  while :; do
    body=$(gh api "repos/$REPO/actions/runs/$1/jobs?filter=latest&per_page=100&page=$page")
    jq -r '.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | .name' <<<"$body"
    [ "$(jq '.jobs | length' <<<"$body")" -lt 100 ] && break
    page=$((page + 1)); [ "$page" -gt 10 ] && break
  done | site_key | sort -u
}

# A matrix job's name carries every matrix field ("sync (awal, python -m …, true)"), so editing the
# matrix renames the job and would make an old failure look new. Compare on the site alone:
# "sync (awal, …)" → "sync (awal)"; names without a matrix ("Sweep abha") stay as they are.
site_key() { sed -E 's/^([^(]*\([[:space:]]*[^,)]+).*$/\1)/'; }

now=$(failed_jobs "$RUN_ID")
prev_id=$(gh api "repos/$REPO/actions/workflows/$WORKFLOW_ID/runs?status=completed&per_page=20" \
  | jq -r --argjson id "$RUN_ID" '[.workflow_runs[] | select(.id < $id)][0].id // empty')
prev=""
[ -n "$prev_id" ] && prev=$(failed_jobs "$prev_id")

if [ -z "$now" ]; then
  new="(the run failed without a failed job; nothing to compare)"
else
  new=$(comm -23 <(printf '%s\n' "$now") <(printf '%s\n' "$prev") | sed '/^$/d')
fi

if [ -z "$new" ]; then
  echo "::notice::No NEW failures in \"$WF_NAME\" run $RUN_ID: the same jobs failed in run ${prev_id:-none}. Not waking $ENGINEER; the nightly run handles them."
  exit 0
fi

list=$(printf '%s\n' "$new" | paste -sd ';' - | cut -c1-1500)
text="INSTANT WAKE-UP: $KIND workflow \"$WF_NAME\" failed with NEW failures (jobs that did not fail in the previous run): $list. Run $RUN_ID: $RUN_URL . $SCOPE"
if [ -n "${DRY_RUN:-}" ]; then
  echo "DRY_RUN would wake $ENGINEER: $text"
  exit 0
fi

body=$(jq -n --arg t "$text" '{text: $t}')
code=$(curl -sS -o /tmp/fire.json -w '%{http_code}' -X POST "$FIRE_URL" \
  -H "Authorization: Bearer $FIRE_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d "$body")
echo "fire endpoint answered HTTP $code"
if [ "$code" = "429" ]; then
  echo "::warning::Hourly fire limit reached — the nightly run will pick this failure up."
  exit 0
fi
[ "$code" = "200" ] || { cat /tmp/fire.json; exit 1; }
jq -r '"engineer session: " + .claude_code_session_url' /tmp/fire.json
