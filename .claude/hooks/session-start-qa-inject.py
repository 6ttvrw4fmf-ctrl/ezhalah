#!/usr/bin/env python3
"""SessionStart hook — inject the Search & Matching QA Engineer canonical contract into
every session that starts in this repo on Claude Code on the Web.

WHY THIS EXISTS (permanent, 2026-08-22):

The Search, Matching & Testing Engineer routine is fired by an account-level scheduled task
whose stored prompt is a COPY of docs/ops/SEARCH_MATCH_QA_ENGINEER.md. Per that file's own
header, "this file is the source of truth — if the routine prompt and this file ever differ,
update the routine to match this file." Without this hook, keeping the two in sync is manual
work someone has to remember to do; a stored prompt can quietly drift while the file evolves
(e.g. §42 FULL-FILTER TRENDING PARITY, added 2026-08-22).

This hook eliminates that drift class entirely. It runs at session start, reads the LIVE file
from the checked-out repo, and injects it as SessionStart additionalContext. The stored routine
prompt becomes advisory; the file is what actually reaches the model on every fire. Edit the
file, commit, merge — every future session sees the new contract automatically, no manual
re-paste needed.

WHAT THIS IS NOT:
- Not a dependency installer (see docs/README for that pattern; unrelated concern).
- Not a policy override — the injected contract is the file itself, verbatim. A future edit to
  the file changes what future sessions see; nothing here silently interprets the file.
- Not a permission grant — it emits additionalContext only. Every safety gate (deploy lock,
  migration drift guard, source truth, RED list) remains in force.

SCOPE:
- Runs only in Claude Code on the Web (CLAUDE_CODE_REMOTE=true). Local IDE sessions can read
  the file directly and don't need the inject.
- No-op (exit 0, no output) if the file is missing or unreadable — a failed inject must never
  break a session start.

The offline guard scripts/verify-search-match-qa-hook-wired.ts (in npm test) protects the
wiring: registration in .claude/settings.json, executable bit, reads the canonical file at
runtime (never a hardcoded copy), guarded no-op on missing file, remote-only.
"""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    if os.environ.get("CLAUDE_CODE_REMOTE") != "true":
        return 0  # local IDE session — no inject needed

    repo = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    path = os.path.join(repo, "docs", "ops", "SEARCH_MATCH_QA_ENGINEER.md")

    try:
        with open(path, "r", encoding="utf-8") as f:
            body = f.read()
    except (OSError, UnicodeDecodeError):
        return 0  # file missing or unreadable — silent no-op

    if not body.strip():
        return 0

    preamble = (
        "AUTOMATIC INJECT from .claude/hooks/session-start-qa-inject.py "
        "(committed to this repo, runs on EVERY session start in Claude Code on the Web).\n\n"
        "This is the CANONICAL, live-at-fire-time contract for the Search, Matching & Testing "
        "Engineer routine (docs/ops/SEARCH_MATCH_QA_ENGINEER.md). It is served straight from "
        "the checked-out file so the stored routine prompt and this file CANNOT drift — the "
        "file is authoritative and this inject is what actually reaches the model on every "
        "session start. If any stored routine prompt disagrees with the text below, this text "
        "wins (owner rule, embedded in the file's own header).\n\n"
        "If this session is a Search & Matching QA Engineer scheduled routine invocation, "
        "follow the contract below end-to-end for your run, without seeking approval on "
        "normal engineering fixes within scope (see §18, §40.8, §42). If this session is "
        "unrelated (interactive dev, or another engineer's routine), you may safely ignore "
        "this inject — it's context, not an instruction to act.\n\n"
        "--- BEGIN docs/ops/SEARCH_MATCH_QA_ENGINEER.md (canonical, verbatim) ---\n\n"
    )
    epilogue = "\n\n--- END docs/ops/SEARCH_MATCH_QA_ENGINEER.md ---\n"

    payload = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": preamble + body + epilogue,
        }
    }
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
