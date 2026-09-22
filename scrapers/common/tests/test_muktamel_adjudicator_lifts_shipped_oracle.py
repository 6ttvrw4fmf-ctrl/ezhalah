"""The muktamel adjudicator must measure the SHIPPED oracle, and must fail closed when it cannot.

WHY THIS EXISTS. `scrapers/muktamel/adjudicate_killed.py` decides whether a listing the database
holds inactive is actually gone. If it ever measured a COPY of the removal predicate, a run could
report a clean adjudication of a function production does not use — the
`docs/ops/BARRIER_ENGINEER.md` PART 1.11 shape where a pointer reads as coverage. So the thing under
test here is not the predicate's truth table (run.py owns that); it is that the adjudicator is
really holding run.py's own function, and that it refuses to run rather than degrade when it is not.
"""
from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
ADJ = ROOT / "scrapers" / "muktamel" / "adjudicate_killed.py"
RUN = ROOT / "scrapers" / "muktamel" / "run.py"


def _load():
    spec = importlib.util.spec_from_file_location("mk_adjudicate", ADJ)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_lifts_the_real_symbols_out_of_run_py():
    """The lifted function is run.py's own source, not a reimplementation living in the tool."""
    mod = _load()
    ns = mod._lift(RUN, {"_liveness_signal", "_session"})
    assert ns["BASE"] == "https://www.muktamel.com"

    # The lifted body must be byte-identical to the one run.py defines.
    run_tree = ast.parse(RUN.read_text())
    shipped = next(n for n in run_tree.body
                   if isinstance(n, ast.FunctionDef) and n.name == "_liveness_signal")
    assert ast.unparse(shipped).strip()  # sanity: the shipped definition was found at top level

    # And the adjudicator must not carry its own copy of the predicate.
    adj_tree = ast.parse(ADJ.read_text())
    assert not any(isinstance(n, ast.FunctionDef) and n.name == "_liveness_signal"
                   for n in adj_tree.body), (
        "adjudicate_killed.py defines its own _liveness_signal — it would then measure a copy "
        "instead of the function that decides production kills")


def test_lifted_oracle_agrees_with_the_documented_removal_shape():
    """404/410 and a path change are the measured dead shapes; everything else is NO OPINION."""
    ns = _load()._lift(RUN, {"_liveness_signal", "_session"})
    signal = ns["_liveness_signal"]
    assert signal(404, "", False) == "gone"
    assert signal(410, "", False) == "gone"
    assert signal(200, "", True) == "gone"          # redirected off /real-estates/<id>
    assert signal(200, "", False) is None           # served on its own path -> not a removal
    # The shapes LISTING_LIVENESS.md §1-§3 forbids killing on must stay opinion-free.
    for status in (403, 429, 500, 502, 503, None):
        assert signal(status, "", False) is None, f"status {status} must never read as removal"


def test_lift_fails_closed_when_the_oracle_is_missing(tmp_path):
    """A renamed or deleted predicate must stop the tool, never silently measure nothing."""
    mod = _load()
    stub = tmp_path / "run.py"
    stub.write_text('BASE = "https://www.muktamel.com"\n\n\ndef _something_else():\n    return None\n')
    with pytest.raises(SystemExit) as excinfo:
        mod._lift(stub, {"_liveness_signal", "_session"})
    assert "_liveness_signal" in str(excinfo.value)


def test_a_dead_cohort_run_requires_live_controls():
    """Without a positive control a 'gone' verdict cannot be told apart from a blocked egress."""
    src = ADJ.read_text()
    assert "REFUSING TO RUN: --live-ids is required" in src
    # And the canary must gate the RESULT line, not merely be printed alongside it.
    assert "CANARY FAIL" in src
    tree = ast.parse(src)
    main_fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    returns_before_result = [n for n in ast.walk(main_fn) if isinstance(n, ast.Return)]
    assert len(returns_before_result) >= 2, (
        "main() must return early on a failed canary instead of falling through to a verdict")


def test_the_tool_never_writes_to_the_database():
    """Read-only by construction, checked on the AST rather than the prose.

    A substring scan would trip over this module's own comments (which discuss supabase in order to
    explain why it is NOT imported) and would equally be satisfied by a comment that merely promised
    good behaviour. What actually makes the tool read-only is that it imports no database client and
    calls no write verb, so that is what is asserted.
    """
    tree = ast.parse(ADJ.read_text())

    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for forbidden in ("supabase", "db"):
        assert forbidden not in imported, (
            f"adjudicator imports {forbidden!r}; it must hold no database handle at all")

    called = {node.func.attr for node in ast.walk(tree)
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
    for verb in ("upsert", "insert", "update", "delete", "prune_unseen", "execute"):
        assert verb not in called, f"adjudicator calls {verb}(); it must never write"
