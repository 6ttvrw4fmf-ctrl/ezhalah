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

SHARED-RUNNER SCRAPERS (2026-09-20). Some platforms are tenants of ONE product and delegate their
whole run to a shared module — gudai / safera / alhumaidan are three offices on the inblaj.net
WordPress product and each run.py is a four-line wrapper around
scrapers.common.inblaj_platform.run_platform(slug=..., ...). Their run.py therefore contains no
end_run() call at all, and this test's "no end_run() call found" branch fired on all three.

EXEMPTING THEM WOULD HAVE REMOVED THE GUARANTEE, so instead the same guarantee is asserted where it
actually lives, plus the one risk the shared shape introduces that per-platform files never had:
  • the shared runner must itself pass check_tables on its success path, derived from the slug it
    was handed (so the tables can only ever be that platform's);
  • and the wrapper must pass a slug EQUAL TO ITS OWN DIRECTORY NAME. That is the real hazard of a
    copy-pasted wrapper: gudai/run.py calling run_platform(slug="safera") would silently write one
    office's listings into another office's tables, range-check the wrong tables, and file the run
    under the wrong ledger — a failure no amount of literal-list checking in the shared module
    would catch.
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


# Shared runners: module path -> the kwarg carrying the platform slug.
SHARED_RUNNERS = {"scrapers.common.inblaj_platform": "slug"}


def _shared_runner_slug(tree: ast.AST):
    """The slug a wrapper hands to a shared runner, or None if this is not such a wrapper."""
    imported = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module in SHARED_RUNNERS
        for alias in node.names
    }
    if not imported:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) in imported:
            for kw in node.keywords:
                if kw.arg == "slug" and isinstance(kw.value, ast.Constant):
                    return kw.value.value
    return None


def test_every_success_path_end_run_passes_check_tables():
    checked_files = 0
    wired_calls = 0
    shared_wrappers: list[str] = []
    problems: list[str] = []

    for path in ENTRY_FILES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        rel = path.relative_to(SCRAPERS)
        platform = rel.parts[0]
        calls = list(_end_run_calls(tree))
        if not calls:
            shared = _shared_runner_slug(tree)
            if shared is None:
                problems.append(f"{rel}: no end_run() call found — not a scraper entry file?")
                continue
            if shared != platform:
                problems.append(
                    f"{rel}: delegates to a shared runner with slug={shared!r}, but this directory "
                    f"is {platform!r} — a copy-pasted wrapper would write another platform's tables")
            shared_wrappers.append(platform)
            checked_files += 1
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

    # Every shared runner a wrapper delegates to must carry the SAME guarantee at its own
    # end_run: check_tables present, and built from the slug it was handed rather than hardcoded.
    for mod in SHARED_RUNNERS:
        src = SCRAPERS.parent / (mod.replace(".", "/") + ".py")
        if not src.exists():
            problems.append(f"{mod}: shared runner module is missing")
            continue
        rtree = ast.parse(src.read_text(encoding="utf-8"))
        rcalls = [c for c in _end_run_calls(rtree) if not _is_literal(_kw(c, "ok"), False)]
        if not rcalls:
            problems.append(f"{mod}: shared runner has no success-path end_run()")
            continue
        for call in rcalls:
            ct = _kw(call, "check_tables")
            if ct is None:
                problems.append(f"{mod}:{call.lineno}: success-path end_run() missing check_tables")
                continue
            if not isinstance(ct, (ast.List, ast.Tuple)) or not ct.elts:
                problems.append(f"{mod}:{call.lineno}: check_tables must be a non-empty list")
                continue
            # Each entry must be an f-string interpolating the slug — the only construction that
            # cannot name another platform's table.
            for elt in ct.elts:
                srcseg = ast.unparse(elt)
                if "slug" not in srcseg or "_listings" not in srcseg:
                    problems.append(
                        f"{mod}:{call.lineno}: check_tables entry {srcseg!r} is not derived from the "
                        f"platform slug — a shared runner must not be able to name another "
                        f"platform's table")

    assert not problems, "\n".join(problems)
    # sanity floor: the walker must actually be seeing the fleet, not vacuously passing.
    assert checked_files >= 30, f"only {checked_files} entry files checked — glob broken?"
    assert wired_calls >= 30, f"only {wired_calls} wired success-path calls found"
    assert len(shared_wrappers) >= 3, (
        f"expected the inblaj tenant wrappers to be recognised, saw {shared_wrappers}")
