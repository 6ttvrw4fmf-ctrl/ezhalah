"""Over the proxy cap, the wasalt Arabic enricher still serves TODAY'S ARRIVALS (New Listings Engineer, 2026-10-10).

From 10-08 the residential queue held 19-27k rows and every run refused in 0 s, so 137 of 7,552 wasalt
arrivals in 24 h had no city (the Arabic page is where it comes from) and were unsearchable. Over the
cap the run now fetches no-city rows first, then rows scraped in the last ARRIVALS_WINDOW_H hours; if
that fresh window alone exceeds the cap (a flag reset / backfill), it still refuses. These execute
enrich_table() against a stub client; the first test fails on the old refuse-everything breaker.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_arrivals_mode_2026_10_10.py -v
"""
from __future__ import annotations

import pytest

import scrapers.wasalt.enrich_ar as EAR
from scrapers.common.tests.test_wasalt_enrich_breaker_counts_2026_10_06 import _api


class _Q:
    def __init__(self, c):
        self.c, self.head, self.f = c, False, []

    def select(self, *a, count=None, head=False, **k):
        self.head = head
        return self

    def eq(self, *a): return self
    def like(self, *a): return self
    def lt(self, *a): return self
    def lte(self, *a): return self
    def not_(self): return self
    def update(self, *a, **k): return self

    def is_(self, col, val):
        self.f.append(("is", col, val))
        return self

    def gte(self, col, val):
        self.f.append(("gte", col))
        return self

    def order(self, *a, **k): return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        if self.n == 1:   # a count
            return _api(self.c.fresh if ("gte", "scraped_at") in self.f else self.c.pending, self.head)
        self.c.fetches.append(list(self.f))

        class R:
            data: list = []
        return R()


class _C:
    def __init__(self, pending, fresh):
        self.pending, self.fresh, self.fetches = pending, fresh, []

    def table(self, _t):
        return _Q(self)


@pytest.fixture(autouse=True)
def _no_catalog(monkeypatch):
    monkeypatch.setattr(EAR, "_load_catalog", lambda: None, raising=False)
    monkeypatch.setattr(EAR, "_browser_fetch_enabled", lambda: False, raising=False)


def test_over_cap_still_fetches_no_city_rows_then_fresh_arrivals(monkeypatch):
    c = _C(pending=27119, fresh=7732)          # 2026-10-10 production numbers
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    out = EAR.enrich_table("wasalt_residential_listings", limit=10, workers=1, retry_errs=0)
    assert not out.get("aborted"), "refused the run although today's arrivals fit under the cap"
    assert c.fetches[0] == [("is", "city", "null")], c.fetches
    assert ("gte", "scraped_at") in c.fetches[1], c.fetches


def test_over_cap_with_a_huge_fresh_window_still_refuses(monkeypatch):
    c = _C(pending=60000, fresh=15001)         # a flag reset / backfill shape
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    out = EAR.enrich_table("wasalt_residential_listings", limit=10, workers=1, retry_errs=0)
    assert out["aborted"] == 60000
    assert c.fetches == []


def test_under_cap_is_unchanged_newest_first_without_filters(monkeypatch):
    c = _C(pending=500, fresh=500)
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    EAR.enrich_table("wasalt_residential_listings", limit=10, workers=1, retry_errs=0)
    assert c.fetches[0] == []
