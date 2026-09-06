"""Regression test for the aqarmonthly Saturday discovery-collapse incident (2026-08-22, 2026-08-29,
2026-09-05): every one of the 16 sharded runs reported ok=true while rows_seen fell ~93%
(233-234 -> ~15-16 per shard), then fully recovered the very next day. rows_seen was never
literally zero, so the existing "0-row run" RC-B demotion in db.end_run() never fired, and
scrapers/aqarmonthly/run.py's end_run() call passed no `floor` — so this is exactly the
"silent_partial_success" shape the platform's own docstring warns about: "ok=true suppresses
every failure barrier".

Root-cause investigation (2026-09-06) found NO day-of-week / weekday logic anywhere in
scrapers/aqarmonthly/run.py or the shared libraries it imports — the collapse tracks a live
external fetch (sa.aqar.fm/graphql Search.find), re-queried independently by all 16 shards, and
is corroborated by a genuinely Saturday-unique event hitting the same domain (the
`gh-aqar-deep-fill-weekly` pg_cron job, `0 2 * * 6`, dispatching aqar-deep-fill.yml's ~108-shard
crawl ~2-4 hours earlier). Root cause could not be pinned to a single mechanism with certainty, so
no speculative crawl-logic change was made. What IS a concrete, in-scope scraper-code gap
regardless of the exact trigger: aqarmonthly never told end_run() what a sane lower bound for
rows_seen looks like, even though run.py's own comment already documents one ("~100-240 ids —
never legitimately empty while the vertical is alive"). This test locks that gap shut using the
EXISTING db.end_run() `floor` mechanism (see test_end_run_honesty.py's
test_floor_demotes_a_suspicious_partial_crawl) rather than inventing a new one.

Follows the hermetic supabase/dotenv stub pattern from test_end_run_honesty.py /
test_db_placeholder_guard.py — no network, no credentials.
"""
from __future__ import annotations

import ast
import sys
import types
from pathlib import Path

import pytest

# ── Stub supabase + dotenv (db.py imports both at module load) ───────────────────────────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db  # noqa: E402

RUN_PY = Path(__file__).resolve().parents[2] / "aqarmonthly" / "run.py"

# Measured facts from scrape_runs (2026-09-06 investigation): normal per-shard rows_seen is
# 233-234; the three Saturday incidents measured 15-16 per shard.
NORMAL_PER_SHARD = 233
INCIDENT_PER_SHARD = 15
# run.py's own comment documents the honest floor for a live shard slice.
DOCUMENTED_NORMAL_FLOOR = 100


def _end_run_floor_literal() -> int:
    """Statically pull the `floor=<int>` keyword aqarmonthly's success-path end_run() call passes,
    so this test tracks whatever value is actually wired rather than duplicating it by hand."""
    tree = ast.parse(RUN_PY.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
        if name != "end_run":
            continue
        ok_kw = next((kw.value for kw in node.keywords if kw.arg == "ok"), None)
        if isinstance(ok_kw, ast.Constant) and ok_kw.value is False:
            continue  # the except-block failure path; not the one that needs a floor
        floor_kw = next((kw.value for kw in node.keywords if kw.arg == "floor"), None)
        assert floor_kw is not None, (
            "aqarmonthly/run.py's success-path end_run() call no longer passes `floor=` — "
            "this is the exact gap that let the 2026-08-22/29 + 2026-09-05 Saturday discovery "
            "collapses (233 -> ~15 rows_seen/shard) report ok=true. Re-add a `floor` comfortably "
            "below the documented normal per-shard range and above any real collapse.")
        assert isinstance(floor_kw, ast.Constant) and isinstance(floor_kw.value, int), (
            "floor= must be a plain positive integer literal")
        return floor_kw.value
    raise AssertionError("no success-path end_run() call found in aqarmonthly/run.py")


def test_wired_floor_sits_between_the_incident_and_a_normal_run():
    floor = _end_run_floor_literal()
    assert INCIDENT_PER_SHARD < floor <= DOCUMENTED_NORMAL_FLOOR, (
        f"floor={floor} must be > the observed incident count ({INCIDENT_PER_SHARD}) and <= the "
        f"documented normal per-shard floor ({DOCUMENTED_NORMAL_FLOOR}), or it either misses a "
        "real collapse or false-positives on an honest low-but-real day"
    )


class _FakeQuery:
    def __init__(self, sink):
        self._sink = sink

    def update(self, payload):
        self._sink["payload"] = payload
        return self

    def eq(self, *a, **k):
        return self


class _FakeClient:
    def __init__(self, sink):
        self._sink = sink

    def table(self, name):
        return _FakeQuery(self._sink)


@pytest.fixture
def written(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(db, "sb", lambda: _FakeClient(sink))
    monkeypatch.setattr(db, "_execute", lambda query, **k: None)
    return sink


def test_the_exact_saturday_shape_now_demotes_to_failure(written):
    """Reproduce shard=5/16's real numbers from 2026-08-22 (scrape_runs id 33291-ish: rows_seen=15,
    ok=true) against the wired floor and prove end_run() now demotes it — this run would have
    fired mon_detect_silent_partial_success's underlying condition, and now also fails its OWN
    scrape_runs row, instead of reporting a clean ok=true."""
    floor = _end_run_floor_literal()
    ret = db.end_run(1, ok=True, rows_seen=INCIDENT_PER_SHARD, rows_upserted=14, floor=floor,
                      notes="shard=5/16 priced=14/15 pruned=0")
    assert ret is False
    assert written["payload"]["ok"] is False
    assert "floor" in (written["payload"]["notes"] or "")


def test_a_normal_saturday_recovery_day_is_not_falsely_demoted(written):
    """The wired floor must never trip on an honest, fully-recovered day (e.g. every Sunday the
    incident was followed by) — 233-234 rows/shard must stay a clean ok=true."""
    floor = _end_run_floor_literal()
    ret = db.end_run(1, ok=True, rows_seen=NORMAL_PER_SHARD, rows_upserted=80, floor=floor,
                      notes="shard=5/16 priced=80/233 pruned=0")
    assert ret is True
    assert written["payload"]["ok"] is True
