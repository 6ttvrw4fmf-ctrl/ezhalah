"""fleet_liveness controls (♻️ 2026-11-13): a row our own reader already read gone is never a known-live control.
opensooq OSQ288563804 (struck at 05:00) was the most recently SEEN ad, so the 03:31 recheck opened with it as a
control, read it gone and quarantined the pass: the dead ad blocked its own removal. The struck rows are filtered
in the QUERY, before the limit, so a first page of struck rows cannot starve the pool (CodeRabbit on #12130)."""
from __future__ import annotations

from scrapers.common import fleet_liveness as F

POOL = [  # newest first: the first MIN_CANARIES are ALL struck
    *({"ad_number": f"D{i}", "last_seen_at": f"2026-11-13T0{9 - i}:00", "missing_count": 1} for i in range(5)),
    {"ad_number": "L1", "last_seen_at": "2026-11-13T03:00", "missing_count": 0},
    {"ad_number": "L2", "last_seen_at": "2026-11-13T02:00", "missing_count": None},
    {"ad_number": "L3", "last_seen_at": "2026-11-13T01:00", "missing_count": 0},
    {"ad_number": "L4", "last_seen_at": "2026-11-13T00:30", "missing_count": 0},
    {"ad_number": "L5", "last_seen_at": "2026-11-13T00:10", "missing_count": 0},
]


def _rows_fake(calls):
    def _rows(client, table, cols, *, order, limit, since=None, unstruck=False):
        calls.append(unstruck)
        rows = [r for r in POOL if not (unstruck and r["missing_count"])]   # the query's own filter
        return [dict(r, _table=table) for r in rows][:limit]
    return _rows


def test_struck_rows_are_never_controls_even_when_the_first_page_is_all_struck(monkeypatch):
    calls: list = []
    monkeypatch.setattr(F, "_rows", _rows_fake(calls))
    got = [r["ad_number"] for r in F.controls(None, {"x_residential_listings": 10})]
    assert got == ["L1", "L2", "L3", "L4", "L5"][:F.MIN_CANARIES], got
    assert calls and all(calls), "every control query must filter struck rows before its limit"


def test_the_query_filter_treats_null_as_unstruck(monkeypatch):
    class Q:
        def __init__(self): self.ors = []
        def select(self, *_): return self
        def eq(self, *_): return self
        def gte(self, *_): return self
        def or_(self, f): self.ors.append(f); return self
        def order(self, *_, **__): return self
        def range(self, *_): return self
    q = Q()

    class C:
        def table(self, _): return q
    monkeypatch.setattr(F, "_execute", lambda query, what=None, **k: type("R", (), {"data": []})())
    F._rows(C(), "t", "ad_number", order=[("last_seen_at", True)], limit=5, unstruck=True)
    assert q.ors == ["missing_count.is.null,missing_count.eq.0"]
