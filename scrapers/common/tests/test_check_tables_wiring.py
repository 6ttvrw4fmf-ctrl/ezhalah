"""Batch 5 (2026-07-16): every scraper's SUCCESS-path end_run() must pass check_tables so the
per-run field-range check (mon_check_run_field_ranges, deployed dark by Batch 0) is actually
invoked fleet-wide. This test is the regression lock: a new scraper copied from an old template,
or an edit that drops the kwarg, fails CI instead of silently opting back out of integrity
demotion.

Purely static (AST over the source files) — no imports of the scrapers, no network, no env.

Contract asserted, per entry file:
  • every end_run(...) whose `ok` is not the literal False passes check_tables=[...] as a
    non-empty list of string literals — EXCEPT the one sanctioned exemption: a call with
    allow_empty=True and rows_seen=0 (gathern's commercial no-op) writes no rows, so there is
    nothing to range-check.
  • every table named belongs to that scraper (platform-prefixed *_listings, or the legacy
    central 'listings' for scrapers/aqar/run.py) — check_tables must never point a scraper's
    field check at another platform's table.
"""
from __future__ import annotations

import ast
from pathlib import Path

SCRAPERS = Path(__file__).resolve().parents[2]  # .../scrapers

# The fleet's entry files: every per-platform run.py plus aqar's two production entry points
# (aqar/run.py is the legacy orchestrator writing the central `listings` table).
ENTRY_FILES = sorted(SCRAPERS.glob("*/run.py")) + [
    SCRAPERS / "aqar" / "run_residential.py",
    SCRAPERS / "aqar" / "run_commercial.py",
]


def _end_run_calls(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
            if name == "end_run":
                yield node


def _kw(call: ast.Call, name: str):
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _is_literal(node, value) -> bool:
    return isinstance(node, ast.Constant) and node.value is value


def test_every_success_path_end_run_passes_check_tables():
    checked_files = 0
    wired_calls = 0
    problems: list[str] = []

    for path in ENTRY_FILES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        rel = path.relative_to(SCRAPERS)
        platform = rel.parts[0]
        calls = list(_end_run_calls(tree))
        if not calls:
            problems.append(f"{rel}: no end_run() call found — not a scraper entry file?")
            continue
        checked_files += 1

        for call in calls:
            ok = _kw(call, "ok")
            if _is_literal(ok, False):
                continue  # failure path: the field check never runs on ok=False, kwarg not required
            allow_empty = _kw(call, "allow_empty")
            rows_seen = _kw(call, "rows_seen")
            if _is_literal(allow_empty, True) and isinstance(rows_seen, ast.Constant) and rows_seen.value == 0:
                continue  # sanctioned no-op (gathern commercial): writes nothing, nothing to check
            ct = _kw(call, "check_tables")
            if ct is None:
                problems.append(f"{rel}:{call.lineno}: success-path end_run() missing check_tables")
                continue
            if not isinstance(ct, (ast.List, ast.Tuple)) or not ct.elts:
                problems.append(f"{rel}:{call.lineno}: check_tables must be a non-empty literal list")
                continue
            for elt in ct.elts:
                if not (isinstance(elt, ast.Constant) and isinstance(elt.value, str)):
                    problems.append(f"{rel}:{call.lineno}: check_tables entries must be string literals")
                    continue
                t = elt.value
                legacy_ok = platform == "aqar" and t == "listings"
                if not legacy_ok and not (t.startswith(f"{platform}_") and t.endswith("_listings")):
                    problems.append(
                        f"{rel}:{call.lineno}: table {t!r} does not belong to platform {platform!r}")
            wired_calls += 1

    assert not problems, "\n".join(problems)
    # sanity floor: the walker must actually be seeing the fleet, not vacuously passing.
    assert checked_files >= 30, f"only {checked_files} entry files checked — glob broken?"
    assert wired_calls >= 30, f"only {wired_calls} wired success-path calls found"
