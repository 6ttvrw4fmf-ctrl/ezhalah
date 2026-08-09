"""Fleet-wide regression guard (2026-08-09, issue #343 follow-up, owner-requested audit): every
scraper funnels its finalization through db.end_run(), whose RC-B guard can demote a "healthy"
ok=True call to ok=False (0 rows, a tripped floor, a degraded/check_tables integrity trip) and
RETURNS that effective ok specifically so the caller can fail the process — see
scrapers/common/db.py's end_run() docstring and test_end_run_honesty.py, which lock the DB-side
half of this contract.

Found live 2026-08-09: dealapp's main() called `db.end_run(run_id, ok=True, ...)` as a bare
statement (not `healthy = db.end_run(...)`) and always `return 0`d — so a run RC-B correctly
demoted to ok=False in the DB still exited 0 in GitHub Actions, showing green for 2 straight days
while the platform was silently dead (issue #343, fixed for dealapp in PR #363). A full audit
found the SAME pattern in every one of the other ~33 scrapers — none of them captured end_run()'s
return value either. All were fixed in the same pass this test was added in.

This is a STATIC source-lint, not a functional test — parallel to
scripts/verify-dealapp-crawl-budget.ts / scripts/verify-no-vercel-bypass.ts's pattern for non-
Python source guards, just written in Python (via `ast`) since scrapers/ is Python. It parses
every scrapers/*/run.py and fails if ANY `db.end_run(..., ok=True, ...)` (or a bare `end_run(...,
ok=True, ...)` for a module that imports the function directly) call is a bare expression
statement instead of being assigned to a variable. An `ok=False` call (the except-block path) is
exempt: that path already returns 1 unconditionally in every scraper today, so whether its own
return value is captured changes nothing — the whole risk is the HEALTHY-looking path silently
losing a demotion.

Deliberately enumerates scrapers/*/run.py via glob rather than a hardcoded roster — a new scraper
added later is automatically covered, no list to maintain (mirrors the reasoning in
.github/workflows/common-location-tests.yml's path-trigger comment about enumeration rot).

Run: python -m pytest scrapers/common/tests/test_scraper_fleet_end_run_return_captured.py -v
"""
from __future__ import annotations

import ast
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRAPERS_DIR = REPO_ROOT / "scrapers"


def _run_py_files() -> list[Path]:
    return sorted(SCRAPERS_DIR.glob("*/run.py"))


def _is_true_constant(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is True


def _is_end_run_call(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Attribute):
        return func.attr == "end_run"
    if isinstance(func, ast.Name):
        return func.id == "end_run"
    return False


def _end_run_call_is_ok_true(call: ast.Call) -> bool:
    if not _is_end_run_call(call):
        return False
    return any(kw.arg == "ok" and _is_true_constant(kw.value) for kw in call.keywords)


def _find_bare_end_run_ok_true_statements(tree: ast.Module) -> list[int]:
    """Line numbers of every `db.end_run(..., ok=True, ...)` call that is a bare expression
    statement (its return value discarded) rather than assigned to a name."""
    offenders: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            if _end_run_call_is_ok_true(node.value):
                offenders.append(node.lineno)
    return offenders


def test_every_scraper_run_py_exists_and_is_discovered():
    # Guards the glob itself against silently matching nothing (e.g. a path typo) — a green test
    # that checked 0 files would be worse than no test at all.
    files = _run_py_files()
    assert len(files) >= 30, (
        f"expected at least 30 scrapers/*/run.py files, found {len(files)} — "
        "did the scrapers/ layout change, or is the glob broken?"
    )


def test_detector_actually_catches_a_bare_end_run_ok_true_call():
    """Proves the AST check isn't vacuously true — it must flag the EXACT shape the 2026-08-09
    incident had, and must NOT flag the fixed shape or an ok=False call."""
    bad = textwrap.dedent("""
        def main():
            db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen)
            return 0
    """)
    fixed = textwrap.dedent("""
        def main():
            healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen)
            return 0 if healthy else 1
    """)
    except_path = textwrap.dedent("""
        def main():
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0)
            return 1
    """)

    assert _find_bare_end_run_ok_true_statements(ast.parse(bad)) == [3]
    assert _find_bare_end_run_ok_true_statements(ast.parse(fixed)) == []
    assert _find_bare_end_run_ok_true_statements(ast.parse(except_path)) == []


def test_no_scraper_discards_end_runs_return_value_on_the_healthy_path():
    violations: dict[str, list[int]] = {}
    for path in _run_py_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        offenders = _find_bare_end_run_ok_true_statements(tree)
        if offenders:
            violations[str(path.relative_to(REPO_ROOT))] = offenders

    assert not violations, (
        "The following scrapers call db.end_run(..., ok=True, ...) as a bare statement, "
        "discarding the EFFECTIVE ok it returns — so an RC-B demotion (0 rows, a tripped floor, "
        "a check_tables/degraded integrity trip) stays invisible to CI and the run still exits 0. "
        "Capture the return value instead: `healthy = db.end_run(...)`, then "
        "`return 0 if healthy else 1` (see e.g. scrapers/abeea/run.py for the pattern). "
        f"Violations (file: line numbers): {violations}"
    )
