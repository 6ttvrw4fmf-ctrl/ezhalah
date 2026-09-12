"""Regression test for the aqarmonthly Saturday discovery collapses (2026-08-15/22/29, 09-05, 09-12)
— rewritten 2026-09-12 when the root cause the earlier version could not pin was finally measured.

WHAT THIS FILE USED TO ASSERT, AND WHY THAT CHANGED. It was `test_aqarmonthly_discovery_floor.py`,
and it pinned the `floor=<int>` keyword that aqarmonthly's success-path `end_run()` passed, on the
reasoning that a ~93% drop (233-234 -> ~15 rows_seen/shard) could only be a partial crawl. Its own
docstring was candid that the trigger was never established: *"Root cause could not be pinned to a
single mechanism with certainty, so no speculative crawl-logic change was made."* It read the call
with `ast.parse` — a source-TEXT tripwire over a value, which is the barrier shape AGENTS.md records
five 2026-09-04 defects for.

THE ROOT CAUSE, MEASURED. On the fifth consecutive Saturday the source's own GraphQL was queried
directly (HTTP 200, no auth):

    find(daily_renting_filter:{})                    total 3,953   <- the vertical IS alive
    find(daily_renting_filter:{availability:{eq:1}}) total   240   <- the facet we page
    find(daily_renting_filter:{availability:{eq:0}}) total   399

~3,300 listings carry no availability value at all. Discovery held 240 of 240: a COMPLETE crawl of
what the source published. So the premise the floor rested on — that a slice that small cannot be
honest while the vertical is alive — is false in that one specific way, and the assertion this file
used to make (*the Saturday shape must demote to failure*) was asserting a false red into place. It
is inverted below, with the measurement as the reason.

WHAT THE FILE STILL PROTECTS, because that half was always right. A short discovery MUST NOT report
ok=true. An absolute row floor was simply the wrong instrument: it is blind to coverage, so a stream
dying after 900 of a declared 3,800 leaves ~56 ids/shard — over the old floor of 50 — and finalised
healthy, and on the unsharded path that verdict feeds prune_unseen(). The verdict now comes from
`coverage_verdict()` against the source's own declared total, which rejects every truncation shape
the floor passed. The predicate itself, and the paging loop, are executed against an injected
transport in scripts/verify-aqarmonthly-coverage-beats-row-floor.ts; this file covers the end_run()
wiring on the shapes measured in production.

`db.end_run`'s `floor` mechanism is untouched and still covered by test_end_run_honesty.py — only
aqarmonthly's use of it changed.

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

# Measured from scrape_runs: normal per-shard rows_seen is 233-234; every Saturday measured 15-16.
NORMAL_PER_SHARD = 233
SATURDAY_PER_SHARD = 15
# Measured from the source itself on 2026-09-12 (see the module docstring).
SATURDAY_SOURCE_TOTAL = 240
WEEKDAY_SOURCE_TOTAL = 3736


def _success_path_end_run_kwargs() -> set[str]:
    """The keyword names aqarmonthly's success-path end_run() call actually passes."""
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
            continue  # the except-block / incomplete-discovery failure paths
        return {kw.arg for kw in node.keywords if kw.arg}
    raise AssertionError("no success-path end_run() call found in aqarmonthly/run.py")


# ── The predicate itself, imported from the shipped module (not re-implemented here) ─────────────
def _verdict(captured: int, declared: int | None, truncated: bool = False, capped: bool = False):
    from scrapers.aqarmonthly import run as aqm
    return aqm.coverage_verdict(aqm.Discovery(list(range(captured)), declared, truncated, capped))


def test_the_success_path_no_longer_carries_an_absolute_row_floor():
    """A floor and a coverage verdict disagree on exactly the shape this file was rewritten for:
    the floor demotes a complete 240-of-240 crawl, coverage passes it. Only one may decide."""
    kwargs = _success_path_end_run_kwargs()
    assert "floor" not in kwargs, (
        "aqarmonthly's success-path end_run() passes `floor=` again. An absolute row count cannot "
        "tell a complete crawl of a small source answer from a truncated crawl of a large one — "
        "measured 2026-09-12, the source declared 240 and discovery held 240. Use "
        "coverage_verdict() against the source-declared total; see the module docstring.")


def test_the_measured_saturday_shape_is_a_complete_crawl_not_a_partial_one():
    """THE ASSERTION THIS FILE USED TO MAKE IN REVERSE. 240 captured against a source-declared 240
    is everything the source published, so it must finalise healthy — reddening it raised a P1
    `ingestion_check_failed` and failed all 16 shards on five consecutive Saturdays."""
    complete, why = _verdict(SATURDAY_SOURCE_TOTAL, SATURDAY_SOURCE_TOTAL)
    assert complete is True, why


def test_a_normal_weekday_is_complete_too():
    complete, why = _verdict(WEEKDAY_SOURCE_TOTAL, WEEKDAY_SOURCE_TOTAL)
    assert complete is True, why


def test_a_truncated_crawl_still_fails_even_when_it_clears_the_old_floor():
    """The half the old file was right about, at the layer that can actually see it. 900 of a
    declared 3,800 is ~56 ids per shard — comfortably over the old floor of 50, so it finalised
    ok=true, and on the unsharded path that verdict is what prune_unseen() is handed."""
    complete, why = _verdict(900, 3800)
    assert complete is False, "a crawl 76% short of the source-declared total must never be healthy"
    assert "900" in why and "3800" in why, f"the reason must name both numbers, got: {why}"

    stream_died, _ = _verdict(900, 3800, truncated=True)
    assert stream_died is False

    unprovable, _ = _verdict(0, None, truncated=True)
    assert unprovable is False, "no readable first page proves nothing — never 'complete'"


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


def test_a_complete_saturday_shard_finalises_healthy(written):
    """shard=5/16's real Saturday numbers, finalised the way run.py now finalises them: no floor,
    because coverage_verdict already passed the discovery those 15 ids were sliced from."""
    ret = db.end_run(1, ok=True, rows_seen=SATURDAY_PER_SHARD, rows_upserted=14,
                     notes="shard=5/16 priced=14/15 pruned=0 source_total=240 "
                           "coverage=captured 240 of 240 the source declared")
    assert ret is True
    assert written["payload"]["ok"] is True


def test_a_normal_day_shard_finalises_healthy(written):
    ret = db.end_run(1, ok=True, rows_seen=NORMAL_PER_SHARD, rows_upserted=80,
                     notes="shard=5/16 priced=80/233 pruned=0 source_total=3736")
    assert ret is True
    assert written["payload"]["ok"] is True


def test_a_zero_row_run_is_still_demoted(written):
    """The one guard end_run() keeps on its own, and aqarmonthly still opts into: no allow_empty."""
    ret = db.end_run(1, ok=True, rows_seen=0, rows_upserted=0, notes="shard=5/16")
    assert ret is False
    assert written["payload"]["ok"] is False
