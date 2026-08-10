"""Fleet-wide regression guard (2026-08-09, issue #343 follow-up, owner-requested audit; widened
2026-08-10, daily engineer): every scraper funnels its finalization through db.end_run(), whose
RC-B guard can demote a "healthy" ok call to ok=False (0 rows, a tripped floor, a
degraded/check_tables integrity trip) and RETURNS that effective ok specifically so the caller can
fail the process — see scrapers/common/db.py's end_run() docstring and test_end_run_honesty.py,
which lock the DB-side half of this contract.

Found live 2026-08-09: dealapp's main() called `db.end_run(run_id, ok=True, ...)` as a bare
statement (not `healthy = db.end_run(...)`) and always `return 0`d — so a run RC-B correctly
demoted to ok=False in the DB still exited 0 in GitHub Actions, showing green for 2 straight days
while the platform was silently dead (issue #343, fixed for dealapp in PR #363). A full audit
found the SAME pattern in every one of the other ~33 scrapers — none of them captured end_run()'s
return value either. All were fixed in the same pass this test was added in, and this test was
added to lock the fix down.

WIDENED 2026-08-10 after the lock failed to hold: scrapers/aqar/run_residential.py and
run_commercial.py had the EXACT same bug (found live via a real RC-B demotion — aqar_residential
shard runs 26390/26391, "integrity guard tripped (degraded)" — that still exited 0), and this test
missed both, for two independent reasons now both fixed:
  1. The glob only matched `*/run.py`. aqar's two entrypoints are named `run_residential.py` and
     `run_commercial.py` (aqar shards its matrix by kind, unlike every other scraper), so the
     08-09 audit's file discovery never looked at them at all.
  2. The AST matcher only flagged a literal `ok=True`. Both files write `ok = True` /
     `ok = False` to a local variable across the try/except, then call `db.end_run(..., ok=ok,
     ...)` — an `ast.Name`, not an `ast.Constant`, so even a correctly-globbed file would have
     passed. The healthy-path risk is identical either way: whatever expression is passed as `ok`,
     if the call is a bare statement, a demotion is silently discarded.

This is a STATIC source-lint, not a functional test — parallel to
scripts/verify-dealapp-crawl-budget.ts / scripts/verify-no-vercel-bypass.ts's pattern for non-
Python source guards, just written in Python (via `ast`) since scrapers/ is Python. It parses
every scrapers/*/run*.py and fails if ANY `db.end_run(..., ok=<expr>, ...)` (or a bare
`end_run(..., ok=<expr>, ...)` for a module that imports the function directly) call is a bare
expression statement instead of being assigned to a variable — UNLESS `<expr>` is the literal
`False`. A literal `ok=False` call (the except-block path in every scraper today) is exempt: that
path already returns 1 unconditionally, so whether its own return value is captured changes
nothing. Anything else — `True`, a variable, a comparison, a call — is exactly the
healthy-path-that-might-get-demoted shape and must be captured.

Deliberately enumerates scrapers/*/run*.py via glob rather than a hardcoded roster — a new scraper
(or a new per-kind entrypoint like aqar's) added later is automatically covered, no list to
maintain (mirrors the reasoning in .github/workflows/common-location-tests.yml's path-trigger
comment about enumeration rot). Excludes `run_all.py`/`run_tests.py`-style non-entrypoint helpers
by requiring the stem to be exactly `run` or start with `run_` AND live directly under a
scrapers/<platform>/ directory, same scope the original glob had.

Run: python -m pytest scrapers/common/tests/test_scraper_fleet_end_run_return_captured.py -v
"""
from __future__ import annotations

import ast
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRAPERS_DIR = REPO_ROOT / "scrapers"


def _run_py_files() -> list[Path]:
    return sorted(
        p for p in SCRAPERS_DIR.glob("*/run*.py") if p.stem == "run" or p.stem.startswith("run_")
    )


def _is_false_constant(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is False


def _is_end_run_call(call: ast.Call) -> bool:
    func = call.func
    if isinstance(func, ast.Attribute):
        return func.attr == "end_run"
    if isinstance(func, ast.Name):
        return func.id == "end_run"
    return False


def _end_run_call_risks_a_silent_demotion(call: ast.Call) -> bool:
    """True unless the `ok` kwarg is the literal False (the except-block path, exempt — see
    module docstring). True literal, a variable, or any other expression all count: whatever is
    passed, a bare statement here discards whatever end_run() actually decided."""
    if not _is_end_run_call(call):
        return False
    ok_kwargs = [kw for kw in call.keywords if kw.arg == "ok"]
    if not ok_kwargs:
        return False
    return not _is_false_constant(ok_kwargs[0].value)


def _find_bare_end_run_ok_true_statements(tree: ast.Module) -> list[int]:
    """Line numbers of every `db.end_run(..., ok=<not-literal-False>, ...)` call that is a bare
    expression statement (its return value discarded) rather than assigned to a name."""
    offenders: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            if _end_run_call_risks_a_silent_demotion(node.value):
                offenders.append(node.lineno)
    return offenders


def test_every_scraper_run_py_exists_and_is_discovered():
    # Guards the glob itself against silently matching nothing (e.g. a path typo) — a green test
    # that checked 0 files would be worse than no test at all.
    files = _run_py_files()
    assert len(files) >= 30, (
        f"expected at least 30 scrapers/*/run*.py entrypoints, found {len(files)} — "
        "did the scrapers/ layout change, or is the glob broken?"
    )


def test_detector_actually_catches_a_bare_end_run_ok_true_call():
    """Proves the AST check isn't vacuously true — it must flag the EXACT shape the 2026-08-09
    incident had, the EXACT shape the 2026-08-10 aqar run_residential/run_commercial incident
    had (ok=<variable>, not a literal), and must NOT flag either fixed shape or an ok=False call."""
    bad = textwrap.dedent("""
        def main():
            db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen)
            return 0
    """)
    bad_variable_ok = textwrap.dedent("""
        def main():
            ok = True
            db.end_run(run_id, ok=ok, rows_seen=seen, rows_upserted=seen)
            return 0 if ok else 1
    """)
    fixed = textwrap.dedent("""
        def main():
            healthy = db.end_run(run_id, ok=True, rows_seen=seen, rows_upserted=seen)
            return 0 if healthy else 1
    """)
    fixed_variable_ok = textwrap.dedent("""
        def main():
            ok = True
            healthy = db.end_run(run_id, ok=ok, rows_seen=seen, rows_upserted=seen)
            return 0 if (ok and healthy) else 1
    """)
    except_path = textwrap.dedent("""
        def main():
            db.end_run(run_id, ok=False, rows_seen=seen, rows_upserted=0)
            return 1
    """)

    assert _find_bare_end_run_ok_true_statements(ast.parse(bad)) == [3]
    assert _find_bare_end_run_ok_true_statements(ast.parse(bad_variable_ok)) == [4]
    assert _find_bare_end_run_ok_true_statements(ast.parse(fixed)) == []
    assert _find_bare_end_run_ok_true_statements(ast.parse(fixed_variable_ok)) == []
    assert _find_bare_end_run_ok_true_statements(ast.parse(except_path)) == []


def test_no_scraper_discards_end_runs_return_value_on_the_healthy_path():
    violations: dict[str, list[int]] = {}
    for path in _run_py_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        offenders = _find_bare_end_run_ok_true_statements(tree)
        if offenders:
            violations[str(path.relative_to(REPO_ROOT))] = offenders

    assert not violations, (
        "The following scrapers call db.end_run(..., ok=<not-literal-False>, ...) as a bare "
        "statement, discarding the EFFECTIVE ok it returns — so an RC-B demotion (0 rows, a "
        "tripped floor, a check_tables/degraded integrity trip) stays invisible to CI and the "
        "run still exits 0. Capture the return value instead: `healthy = db.end_run(...)`, then "
        "`return 0 if healthy else 1` — or if `ok` is itself a variable, "
        "`return 0 if (ok and healthy) else 1` (see e.g. scrapers/aqar/run_residential.py for "
        "that pattern, or scrapers/abeea/run.py for the plain-literal one). "
        f"Violations (file: line numbers): {violations}"
    )
