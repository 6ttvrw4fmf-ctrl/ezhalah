"""squares: a night whose first request dies is a FAILED RUN ON RECORD, never a night with no row.

2026-10-07 04:33: one connect timeout on the single chrome session (job 112629728613) killed the
crawl BEFORE db.begin_run(), so scrape_runs had no row and the early-warning robot saw nothing. The
run is now registered first, the fetch goes through retry_smarter_session (3 profiles, then proxy),
and a failure is closed with ok=False and the error. These execute main() with stubs.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.squares.run as SQ  # noqa: E402


class _Db:
    def __init__(self):
        self.calls: list[tuple] = []

    def begin_run(self, slug):
        self.calls.append(("begin", slug))
        return 7

    def end_run(self, run_id, **k):
        self.calls.append(("end", run_id, k.get("ok"), k.get("notes")))
        return True


def test_a_connect_timeout_on_the_first_request_is_recorded_as_a_failed_run(monkeypatch):
    db = _Db()
    monkeypatch.setattr(SQ, "db", db)
    monkeypatch.setattr(sys, "argv", ["run.py"])

    class _Dead:
        def get(self, *a, **k):
            raise TimeoutError("Connection timed out after 40000 milliseconds")

    monkeypatch.setattr(SQ, "walk_session", lambda: _Dead())
    with pytest.raises(TimeoutError):
        SQ.main()
    assert db.calls[0] == ("begin", SQ.SLUG)
    assert db.calls[-1][:3] == ("end", 7, False) and "timed out" in db.calls[-1][3]


def test_the_walk_session_comes_from_the_shared_resilient_path(monkeypatch):
    seen = {}

    def fake(url, **k):
        seen["url"] = url
        return "S", ["direct/chrome124:Timeout", "direct/safari17_0:200"]

    monkeypatch.setattr(SQ, "retry_smarter_session", fake)
    assert SQ.walk_session() == "S" and seen["url"].startswith(SQ.LIST)
