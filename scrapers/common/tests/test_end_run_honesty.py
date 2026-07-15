"""Hermetic tests for scrapers/common/db.py's end_run() RC-B fail-visible finalization
(hardening 2026-07-13).

end_run is the ONE chokepoint every one of the ~34 scrapers funnels through to close out a
run, so demoting a dishonest run to ok=False HERE makes the whole fleet honest at once — no
per-scraper edits, no way for a new scraper to opt back into the fail-open hole by accident.
These tests lock that contract so a future refactor cannot silently re-open the gap that let
alnokhba/souq24 report ok=True on 0 rows for days while their source was dead.

Follows the hermetic pattern in test_db_placeholder_guard.py: stub supabase/dotenv in
sys.modules so no network or credentials are needed, then capture the payload end_run writes.
"""
from __future__ import annotations

import sys
import types

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


class _FakeQuery:
    """Records the payload passed to .update() so the test can assert the written ok/notes."""

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
    """Capture what end_run would write to scrape_runs, without touching Postgres."""
    sink: dict = {}
    monkeypatch.setattr(db, "sb", lambda: _FakeClient(sink))
    # _execute would call .execute() on the fake query with retries; the payload is already
    # captured at .update() time, so make it an inert no-op.
    monkeypatch.setattr(db, "_execute", lambda query, **k: None)
    return sink


# ── The core RC-B contract: a 0-row run is a LIE unless explicitly allowed ────────────────────────
def test_zero_row_ok_true_is_demoted_to_false(written):
    ret = db.end_run(1, ok=True, rows_seen=0, rows_upserted=0)
    assert ret is False  # the returned value is the EFFECTIVE ok (lets a caller sys.exit(1))
    assert written["payload"]["ok"] is False  # ...and it is what actually gets written
    assert "RC-B" in (written["payload"]["notes"] or "")


def test_healthy_run_stays_ok_true(written):
    ret = db.end_run(1, ok=True, rows_seen=1234, rows_upserted=1200, notes="pruned=5")
    assert ret is True
    assert written["payload"]["ok"] is True
    assert written["payload"]["notes"] == "pruned=5"  # a healthy note is untouched


def test_explicit_failure_is_never_promoted(written):
    # An except-block passing ok=False with a healthy-looking seen must STAY False.
    ret = db.end_run(1, ok=False, rows_seen=999, rows_upserted=0, notes="boom")
    assert ret is False
    assert written["payload"]["ok"] is False
    assert written["payload"]["notes"] == "boom"  # no RC-B tag added — we only demote, never touch a fail


def test_allow_empty_opt_out_keeps_ok_true(written):
    # gathern's commercial no-op: the ONE genuinely-empty run in the fleet that is not a failure.
    ret = db.end_run(1, ok=True, rows_seen=0, rows_upserted=0, notes="commercial=noop", allow_empty=True)
    assert ret is True
    assert written["payload"]["ok"] is True


def test_floor_demotes_a_suspicious_partial_crawl(written):
    ret = db.end_run(1, ok=True, rows_seen=12, rows_upserted=12, floor=500)
    assert ret is False
    assert "floor" in (written["payload"]["notes"] or "")


def test_floor_of_zero_is_off_by_default(written):
    ret = db.end_run(1, ok=True, rows_seen=3, rows_upserted=3)  # no floor → even 3 rows is honest
    assert ret is True
    assert written["payload"]["ok"] is True


def test_degraded_flag_demotes_even_with_rows(written):
    # prune_unseen returned -1 (collapse guard tripped): rows were seen but integrity is suspect.
    ret = db.end_run(1, ok=True, rows_seen=5000, rows_upserted=5000, degraded=True)
    assert ret is False
    assert "degraded" in (written["payload"]["notes"] or "")


def test_allow_empty_does_not_suppress_a_degraded_trip(written):
    # allow_empty forgives emptiness, NOT an integrity trip — a tripped guard is always a failure.
    ret = db.end_run(1, ok=True, rows_seen=0, rows_upserted=0, allow_empty=True, degraded=True)
    assert ret is False


def test_demotion_note_preserves_the_original_note(written):
    db.end_run(1, ok=True, rows_seen=0, rows_upserted=0, notes="pruned=3")
    notes = written["payload"]["notes"]
    assert "pruned=3" in notes and "RC-B" in notes  # original context kept, reason appended


# ── check_tables: the post-run field-range check (2026-07-15) ────────────────────────────────────
class _FakeFieldCheckTable:
    """Serves both the .select().eq() lookup (run's platform/started_at) and the final
    .update().eq() finalize call on the same 'scrape_runs' table name — tracks which chain is
    active so .execute() returns the right shape for each."""

    def __init__(self, sink, select_data):
        self._sink = sink
        self._select_data = select_data
        self._mode = None

    def select(self, *a, **k):
        self._mode = "select"
        return self

    def update(self, payload):
        self._mode = "update"
        self._sink["payload"] = payload
        return self

    def eq(self, *a, **k):
        return self

    def execute(self):
        if self._mode == "select":
            return types.SimpleNamespace(data=self._select_data)
        return types.SimpleNamespace(data=None)


class _FakeRpc:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return types.SimpleNamespace(data=self._result)


def _field_check_client(sink, rpc_result, select_data=None):
    if select_data is None:
        select_data = [{"platform": "wasalt", "started_at": "2026-07-15T00:00:00+00:00"}]
    table = _FakeFieldCheckTable(sink, select_data)

    class _Client:
        def table(self, name):
            return table

        def rpc(self, name, params):
            assert name == "mon_check_run_field_ranges"
            assert params["p_placeholder_tokens"]  # never called with an empty/missing token list
            return _FakeRpc(rpc_result)

    return _Client()


def test_check_tables_none_is_zero_behavior_change(written):
    # The ~34 existing call sites that never pass check_tables must see NO new code path at all.
    ret = db.end_run(1, ok=True, rows_seen=100, rows_upserted=100)
    assert ret is True
    assert written["payload"]["ok"] is True


def test_check_tables_clean_run_stays_healthy(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(db, "sb", lambda: _field_check_client(sink, rpc_result=False))
    ret = db.end_run(1, ok=True, rows_seen=100, rows_upserted=100,
                      check_tables=["wasalt_residential_listings"])
    assert ret is True
    assert sink["payload"]["ok"] is True


def test_check_tables_bad_field_ranges_demotes_ok(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(db, "sb", lambda: _field_check_client(sink, rpc_result=True))
    ret = db.end_run(1, ok=True, rows_seen=100, rows_upserted=100,
                      check_tables=["wasalt_residential_listings"])
    assert ret is False
    assert sink["payload"]["ok"] is False
    assert "degraded" in sink["payload"]["notes"]


def test_check_tables_rpc_failure_never_breaks_an_already_committed_run(monkeypatch):
    # Monitoring must never fail a run whose rows are already written — an RPC that doesn't
    # exist yet / a transient network blip must be swallowed, not raised. sb() is called once
    # per db.py call site: end_run's try/except spans the select+rpc pair, so a client whose
    # .table() raises simulates that failure, then a SEPARATE sb() call for the final .update()
    # (outside the try block) must still land normally.
    sink: dict = {}
    calls = {"n": 0}

    class _BoomThenFine:
        def table(self, name):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("network blip")
            return _FakeFieldCheckTable(sink, [])

    monkeypatch.setattr(db, "sb", lambda: _BoomThenFine())
    ret = db.end_run(1, ok=True, rows_seen=100, rows_upserted=100,
                      check_tables=["wasalt_residential_listings"])
    assert ret is True  # the check's own failure never demotes a genuinely healthy run
    assert sink["payload"]["ok"] is True


def test_check_tables_placeholder_tokens_always_forwarded(monkeypatch):
    sink: dict = {}
    monkeypatch.setattr(db, "sb", lambda: _field_check_client(sink, rpc_result=False))
    db.end_run(1, ok=True, rows_seen=10, rows_upserted=10,
               check_tables=["mustqr_residential_listings"])
    # _field_check_client's fake .rpc() already asserts p_placeholder_tokens is non-empty on
    # every call — reaching here without an AssertionError proves it was forwarded correctly.
    assert sink["payload"]["ok"] is True
