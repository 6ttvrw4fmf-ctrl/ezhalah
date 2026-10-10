"""wasalt Arabic enrichment takes the NEWEST pending rows first (New Listings Engineer, 2026-10-07).

The pending queue held ~12k rows and one run clears ~380, so oldest-first starved every new arrival:
985 of 985 wasalt rows scraped in the 3 days to 2026-10-07 still had ar_fetched=false, and their
city/district come from the Arabic page. This executes enrich_table() against a stub client and
records the order the row fetch asks for. Fails on the old `order("id")`.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_newest_first_2026_10_07.py -v
"""
from __future__ import annotations

import scrapers.wasalt.enrich_ar as EAR
from scrapers.common.tests.test_wasalt_enrich_breaker_counts_2026_10_06 import _api


class _Q:
    def __init__(self, log):
        self.log, self.head = log, False

    def select(self, *a, count=None, head=False, **k):
        self.head = head
        return self

    def eq(self, *a): return self
    def like(self, *a): return self
    def is_(self, *a): return self
    def lt(self, *a): return self
    def lte(self, *a): return self
    def gte(self, *a): return self
    def not_(self): return self

    def order(self, col, **k):
        self.log.append(("order", col, bool(k.get("desc", False))))
        return self

    def limit(self, n):
        self.log.append(("limit", n))
        return self

    def update(self, *a, **k): return self

    def execute(self):
        class R:
            data: list = []
        if any(e[0] == "limit" and e[1] != 1 for e in self.log):
            return R()
        return _api(5, self.head)


class _C:
    def __init__(self):
        self.log: list = []

    def table(self, _t):
        return _Q(self.log)


def test_pending_rows_are_fetched_newest_first(monkeypatch):
    c = _C()
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    monkeypatch.setattr(EAR, "_load_catalog", lambda: None, raising=False)
    monkeypatch.setattr(EAR, "_browser_fetch_enabled", lambda: False, raising=False)
    try:
        EAR.enrich_table("wasalt_residential_listings", limit=10, workers=1)
    except Exception:
        pass  # only the order of the pending fetch is under test
    first_order = next(e for e in c.log if e[0] == "order")
    assert first_order == ("order", "id", True), f"pending fetch must be newest first, got {first_order}"
