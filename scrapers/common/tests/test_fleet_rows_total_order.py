"""fleet_liveness._rows pages the worklist with offsets. That only partitions the table when the
order is TOTAL: every row one run touches gets the same last_liveness_probe_at, and Postgres may
order a tie differently on every request, so rows were read twice while others were never read
(2026-10-26: haraj 1,755 of 13,037 active unread for 2+ days, rakez 191, tuba 163, each run
reporting «covered 100%»). The fake below orders ties differently on every request, exactly as
Postgres may, unless the order ends in a unique column."""
from __future__ import annotations

import random

import scrapers.common.fleet_liveness as F


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, c, t):
        self.c, self.t, self.orders, self.off, self.n = c, t, [], 0, None

    def select(self, *a, **k): return self
    def eq(self, col, v): return self
    def gte(self, col, v): return self
    def order(self, col, desc=False, nullsfirst=False): self.orders.append((col, desc)); return self
    def range(self, a, b): self.off, self.n = a, b - a + 1; return self

    def execute(self):
        self.c.requests += 1
        rows = list(self.c.rows)
        random.Random(self.c.requests).shuffle(rows)       # a tie's order differs per request
        for col, desc in reversed(self.orders):
            rows.sort(key=lambda r: r.get(col) or "", reverse=desc)
        return _Res([dict(r) for r in rows[self.off: self.off + self.n]])


class _Client:
    def __init__(self, rows): self.rows, self.requests = rows, 0
    def table(self, t): return _Q(self, t)


STAMP = "2026-10-24T07:24:06+00:00"
ORDER = [("missing_count", True), ("last_liveness_probe_at", False)]


def _table(n):
    return [{"id": i, "ad_number": f"A{i}", "missing_count": 0, "last_liveness_probe_at": STAMP}
            for i in range(1, n + 1)]


def test_every_row_is_read_exactly_once_across_pages_of_tied_rows(monkeypatch):
    monkeypatch.setattr(F, "PAGE", 100)
    rows = _table(1000)
    got = F._rows(_Client(rows), "t", "id, ad_number", order=ORDER, limit=len(rows))
    ids = [r["id"] for r in got]
    assert len(ids) == len(set(ids)) == 1000


def test_the_order_without_a_tiebreaker_really_loses_rows(monkeypatch):
    """CONTROL: the fake is strict enough to catch the old code: ordering on the tied key alone,
    as _rows did before 2026-10-26, does not read every row."""
    monkeypatch.setattr(F, "PAGE", 100)
    rows = _table(1000)
    c, seen = _Client(rows), set()
    for off in range(0, 1000, 100):
        q = c.table("t").select("id")
        for col, desc in ORDER:
            q = q.order(col, desc=desc)
        seen |= {r["id"] for r in q.range(off, off + 99).execute().data}
    assert len(seen) < 1000


def test_rows_without_an_ad_number_do_not_shift_the_next_page(monkeypatch):
    monkeypatch.setattr(F, "PAGE", 100)
    rows = _table(300)
    for r in rows[::7]:
        r["ad_number"] = None
    got = F._rows(_Client(rows), "t", "id, ad_number", order=ORDER, limit=len(rows))
    assert {r["id"] for r in got} == {r["id"] for r in rows if r["ad_number"]}
