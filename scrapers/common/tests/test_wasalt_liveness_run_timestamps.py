"""A run log must not say it finished before it started (Data Integrity run #29, 2026-08-18).

What was wrong: all three `wasalt_liveness_runs` inserts wrote `finished_at = now_iso`, and `now_iso`
is captured at the TOP of the run (it is the "seen" stamp for row writes). `started_at` was never
sent at all, so it fell to its `now()` column default — evaluated at INSERT time, i.e. at the END.
Every one of the 52 rows therefore recorded the two timestamps backwards, exactly one runtime apart:

    id 52  started_at 01:57:37  finished_at 01:27:57  gap 1779.7s  notes runtime_s=1779.6

That is not cosmetic. This table is the ONLY audit record of the enum-strike sweep that inactivates
listings in bulk (869 rows on 2026-08-18). Any freshness monitor written against `finished_at` reads
a time one full runtime too early, any duration is negative, and "when did we last confirm wasalt
liveness?" cannot be answered correctly from our own data — the same class of gap that
test_wasalt_enum_strike_kill_evidence.py exists to close for the per-row evidence.

Contract locked here, for every mode (pilot / enforce / enum-strike):
  1. the insert sends BOTH `started_at` and `finished_at` — neither is left to a column default;
  2. `started_at` is the run-start stamp (`now_iso`), not a fresh clock read;
  3. `finished_at` is a FRESH clock read taken at insert time, never `now_iso`.

Static/AST, deliberately: the failure was in a literal dict, it needs no network to check, and an
AST assertion cannot be satisfied by a passing run that happens to be fast.
"""
from __future__ import annotations

import ast
import pathlib

LIVENESS = pathlib.Path(__file__).resolve().parents[2] / "wasalt" / "liveness.py"


def _insert_dicts() -> list[ast.Dict]:
    """Every dict literal passed to .table("wasalt_liveness_runs").insert(...)."""
    tree = ast.parse(LIVENESS.read_text(encoding="utf-8"))
    found: list[ast.Dict] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr != "insert" or not node.args:
            continue
        inner = node.func.value                      # .table("wasalt_liveness_runs")
        if not (isinstance(inner, ast.Call) and isinstance(inner.func, ast.Attribute)
                and inner.func.attr == "table" and inner.args
                and isinstance(inner.args[0], ast.Constant)
                and inner.args[0].value == "wasalt_liveness_runs"):
            continue
        if isinstance(node.args[0], ast.Dict):
            found.append(node.args[0])
    return found


def _by_key(d: ast.Dict) -> dict[str, ast.expr]:
    return {k.value: v for k, v in zip(d.keys, d.values)
            if isinstance(k, ast.Constant) and isinstance(k.value, str)}


def test_all_three_modes_are_covered() -> None:
    assert len(_insert_dicts()) == 3, (
        "expected the pilot, enforce and enum-strike inserts; a new mode must carry the same "
        "timestamp contract")


def test_both_timestamps_are_sent_explicitly() -> None:
    for d in _insert_dicts():
        keys = _by_key(d)
        assert "started_at" in keys, "started_at left to the column default = stamped at INSERT time"
        assert "finished_at" in keys, "finished_at missing"


def test_started_at_is_the_run_start_and_finished_at_is_fresh() -> None:
    for d in _insert_dicts():
        keys = _by_key(d)

        started = keys["started_at"]
        assert isinstance(started, ast.Name) and started.id == "now_iso", (
            "started_at must be the stamp captured at the top of the run (now_iso), not a fresh "
            "clock read taken when the row is written")

        finished = keys["finished_at"]
        assert not (isinstance(finished, ast.Name) and finished.id == "now_iso"), (
            "finished_at must NOT be now_iso — that is the run START, and writing it here is the "
            "2026-08-18 inversion this test exists to prevent")
        assert isinstance(finished, ast.Call), "finished_at must be evaluated at insert time"
        src = ast.unparse(finished)
        assert "datetime.now(timezone.utc)" in src and "isoformat" in src, (
            f"finished_at must be a fresh UTC clock read, got: {src}")
