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
