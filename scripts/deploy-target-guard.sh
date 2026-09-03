#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────
# PRODUCTION-TARGET GUARD — single source of truth (owner P0, non-negotiable — 2026-07-21).
#
# The ONLY production frontend URL is https://ezhalah-app.vercel.app, served by the canonical
# Vercel project `ezhalah-app`. This file holds the constants and the two PURE PREDICATES that
# decide (1) "is this checkout linked to the canonical project?" and (2) "did the canonical alias
# actually receive the exact build we just deployed?". It is SOURCED by:
#   • scripts/safe-deploy.sh      (refuses to deploy on a wrong link; asserts the alias moved)
#   • scripts/preflight-verify.sh (re-checks the link before any deploy path runs)
#   • scripts/verify-deploy-target-guard.ts  (the permanent regression test)
# so all three can never drift apart. The predicates print NOTHING and have NO side effects —
# each caller renders its own message. Change the canonical project HERE and nowhere else.
# ─────────────────────────────────────────────────────────────────────────────────────────

DTG_EXPECT_PROJECT_ID="prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX"
DTG_EXPECT_PROJECT_NAME="ezhalah-app"
DTG_EXPECT_ORG_ID="team_0lVrGRoJbCRIWovPNkfnmwJ7"
DTG_CANONICAL_URL="https://ezhalah-app.vercel.app"

# dtg_read_link_field <dir> <field> → prints .vercel/project.json's <field> for <dir> ("" on any error).
dtg_read_link_field() {
  node -e '
    const path = require("path");
    try {
      const p = require(path.resolve(process.argv[1], ".vercel/project.json"));
      process.stdout.write(String(p[process.argv[2]] || ""));
    } catch { process.stdout.write(""); }
  ' "$1" "$2" 2>/dev/null || printf ''
}

# dtg_link_is_canonical <dir> → return 0 iff <dir>/.vercel/project.json links to the canonical
# ezhalah-app project (BOTH projectId AND projectName must match). Missing file / garbage / wrong
# id / wrong name → return 1. This is the guard that stops a stray `vercel link` or a fresh
# wrong-linked worktree from deploying the app to a different Vercel project.
dtg_link_is_canonical() {
  local dir="${1:-.}"
  [ -f "$dir/.vercel/project.json" ] || return 1
  local id name
  id="$(dtg_read_link_field "$dir" projectId)"
  name="$(dtg_read_link_field "$dir" projectName)"
  [ "$id" = "$DTG_EXPECT_PROJECT_ID" ] && [ "$name" = "$DTG_EXPECT_PROJECT_NAME" ]
}

# dtg_alias_serves <expected_bundle> <alias_bundle> → return 0 iff the canonical alias is serving
# EXACTLY the just-deployed build: both non-empty AND identical. An empty alias read, or any
# mismatch, → return 1 ("the alias didn't move / deployed off-target"). This is what makes a
# deploy NEVER report success when https://ezhalah-app.vercel.app is still serving an old bundle.
dtg_alias_serves() {
  local expected="$1" actual="$2"
  [ -n "$expected" ] && [ -n "$actual" ] && [ "$expected" = "$actual" ]
}

# dtg_bundle_hash <bundle_path> → prints the content hash embedded in an Expo web entry filename
# (e.g. "_expo/static/js/web/entry-a4fd39e6….js" → "a4fd39e6…"); prints "" for anything else.
dtg_bundle_hash() {
  printf '%s' "$1" | sed -nE 's|^.*/entry-([a-f0-9]+)\.js$|\1|p'
}

# dtg_md5 <file> → md5 of <file>'s bytes. md5sum on Linux/CI, md5 -q on macOS. "" if neither exists.
dtg_md5() {
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | cut -d' ' -f1
  elif command -v md5 >/dev/null 2>&1; then md5 -q "$1"
  else printf ''; fi
}

# dtg_bundle_is_authentic <file> <bundle_path> → return 0 iff <file> really IS the artifact named by
# <bundle_path>: md5(bytes) == the hash in the filename. Expo names the web entry bundle after the md5
# of its own content (verified 2026-09-03 against production), so this turns "the alias serves a URL
# with the right name" into "the alias serves the right BYTES" — an error page, a truncated CDN read,
# or a same-named-but-different artifact all fail here. Empty file / unparseable name → return 1.
dtg_bundle_is_authentic() {
  local file="$1" want
  want="$(dtg_bundle_hash "$2")"
  [ -n "$want" ] && [ -s "$file" ] && [ "$(dtg_md5 "$file")" = "$want" ]
}
