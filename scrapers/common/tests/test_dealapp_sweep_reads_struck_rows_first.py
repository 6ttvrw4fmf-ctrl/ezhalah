"""dealapp: the sweep reads struck rows first (2026-10-12).

The crawl's prune re-stamps last_liveness_probe_at on every at-grace row it holds UNKNOWN, so those
rows never fell into the sweep's oldest-first window: 9 shown rows at 3-5 strikes had no sweep reading.
"""
from __future__ import annotations

from scrapers.dealapp import liveness_run as L


class _Q:
    def __init__(self, log):
        self.log, self.struck = log, False

    def __getattr__(self, name):
        def f(*a, **k):
            if name == "gt":
                self.struck = True
            return self
        return f


def test_struck_rows_head_the_worklist(monkeypatch):
    rotation = [{"id": i, "listing_url": f"https://dealapp.sa/ar/ad-details/{i}", "missing_count": 0,
                 "last_liveness_probe_at": "2026-10-01"} for i in range(1, 4)]
    struck = [{"id": 99, "listing_url": "https://dealapp.sa/ar/ad-details/99", "missing_count": 4,
               "last_liveness_probe_at": "2026-10-12T03:00"},
              {"id": 2, "listing_url": "https://dealapp.sa/ar/ad-details/2", "missing_count": 3,
               "last_liveness_probe_at": "2026-10-12T03:00"}]
    queries = []

    class _Client:
        def table(self, _t):
            q = _Q(queries)
            queries.append(q)
            return q

    def fake_execute(q, what=""):
        return type("R", (), {"data": struck if q.struck else rotation})()
    monkeypatch.setattr(L, "_execute", fake_execute)
    got = [r["id"] for r in L._collect_candidates(_Client(), 600)]
    assert got[:2] == [99, 2], "a struck row recently stamped by the crawl must still be read"
    assert sorted(got) == [1, 2, 3, 99] and len(got) == 4, "no duplicates, nothing dropped"


def test_probe_order_puts_struck_before_never_probed():
    rows = [{"id": 1, "listing_url": "u/ad-details/1", "missing_count": 0, "last_liveness_probe_at": None},
            {"id": 2, "listing_url": "u/ad-details/2", "missing_count": 3,
             "last_liveness_probe_at": "2026-10-12"}]
    rows.sort(key=lambda r: L._probe_order(r, None))
    assert [r["id"] for r in rows] == [2, 1]


def _rows(n, struck, start=0):
    return [{"id": start + i, "listing_url": f"u/ad-details/{start + i}", "missing_count": 2 if struck else 0,
             "last_liveness_probe_at": "2026-10-16"} for i in range(n)]


def test_struck_rows_cannot_take_the_whole_budget():
    """2026-10-16: 959 struck rows > --limit 600, so every run re-read 600 UNKNOWN struck rows and the
    28,203 unstruck rows got no reading for 8 days (alive 0, checked in time 96% -> 56.5%)."""
    plan = L._plan_worklist(_rows(959, True) + _rows(2000, False, 10_000), 600)
    assert len(plan) == 600
    assert sum(r["missing_count"] > 0 for r in plan) == 150
    assert plan[0]["missing_count"] > 0, "struck rows still lead"


def test_an_unused_share_goes_to_the_other_side():
    plan = L._plan_worklist(_rows(10, True) + _rows(2000, False, 10_000), 600)
    assert len(plan) == 600 and sum(r["missing_count"] > 0 for r in plan) == 10
    plan = L._plan_worklist(_rows(959, True) + _rows(100, False, 10_000), 600)
    assert len(plan) == 600 and sum(r["missing_count"] == 0 for r in plan) == 100
    small = _rows(5, True) + _rows(5, False, 100)
    assert L._plan_worklist(small, 600) == small


def test_struck_rows_are_read_between_rotation_rows():
    """2026-10-23: read as one block, struck rows only had each other as neighbours, so the
    bracketed no-listing reading (shadow since #8372) could almost never close around one."""
    plan = L._plan_worklist(_rows(959, True) + _rows(2000, False, 10_000), 600)
    head = [r["missing_count"] > 0 for r in plan[:300]]
    assert all(head[i] != head[i + 1] for i in range(len(head) - 1)), "struck and rotation alternate"
    assert sum(r["missing_count"] > 0 for r in plan) == 150 and plan[0]["missing_count"] > 0
