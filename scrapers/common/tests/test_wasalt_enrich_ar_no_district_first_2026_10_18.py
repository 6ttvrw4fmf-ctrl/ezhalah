"""A live wasalt row served with NO district gets its Arabic page FIRST (2026-10-18).

312 live rows had an English zone the EN→AR bridge could not place and sat up to 23,861 deep in the
newest-first queue, so the index served them with no district for weeks. enrich_table() now reads the
index's no-district rows and puts their un-fetched wasalt rows at the front of the run, inside `limit`.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_no_district_first_2026_10_18.py -v
"""
from __future__ import annotations

import pytest

import scrapers.wasalt.enrich_ar as EAR
from scrapers.common.tests.test_wasalt_enrich_breaker_counts_2026_10_06 import _api


class _Q:
    def __init__(self, c, t):
        self.c, self.t, self.head, self.ids, self.n = c, t, False, None, None

    def select(self, *a, count=None, head=False, **k):
        self.head = head
        return self

    def eq(self, *a): return self
    def like(self, *a): return self
    def lt(self, *a): return self
    def gte(self, *a): return self
    def is_(self, *a): return self
    def not_(self): return self
    def update(self, *a, **k): return self
    def order(self, *a, **k): return self

    def in_(self, col, ids):
        self.ids = list(ids)
        return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        class R:
            data: list = []
        if self.n == 1:
            return _api(self.c.pending, self.head)
        if self.t == "search_listings_ar":
            R.data = [{"listing_id": i} for i in self.c.no_district]
        elif self.ids is not None:
            R.data = [{"id": i, "ad_number": f"WST{i}", "listing_url": f"https://wasalt.sa/en/property/x-{i}"}
                      for i in self.ids if i in self.c.unfetched]
        else:
            R.data = [{"id": i, "ad_number": f"WST{i}", "listing_url": f"https://wasalt.sa/en/property/x-{i}"}
                      for i in sorted(self.c.unfetched, reverse=True)][: self.n or 10]
        return R()


class _C:
    def __init__(self, unfetched, no_district, broken=False):
        self.unfetched, self.no_district, self.broken = set(unfetched), list(no_district), broken
        self.pending = len(self.unfetched)

    def table(self, t):
        if self.broken and t == "search_listings_ar":
            raise RuntimeError("index unreadable")
        return _Q(self, t)


@pytest.fixture(autouse=True)
def _no_net(monkeypatch):
    monkeypatch.setattr(EAR, "_load_catalog", lambda: None, raising=False)
    monkeypatch.setattr(EAR, "_browser_fetch_enabled", lambda: False, raising=False)
    seen: list[int] = []
    monkeypatch.setattr(EAR, "fetch_ar", lambda slug: (seen.append(int(slug.rsplit("-", 1)[-1])) or (False, None, None, None)))
    return seen


def test_no_district_rows_are_fetched_first_within_the_limit(monkeypatch, _no_net):
    c = _C(unfetched=range(1, 101), no_district=[3, 7, 999])     # 999 is not un-fetched → not ours to fetch
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    EAR.enrich_table("wasalt_residential_listings", limit=5, workers=1, retry_errs=0)
    assert _no_net[:2] == [3, 7], _no_net                          # the old newest-first order would start at 100
    assert len(_no_net) == 5 and 999 not in _no_net


def test_mutant_without_the_priority_starts_at_the_newest(monkeypatch, _no_net):
    """Mutation proof: with the priority read disabled the same run never reaches rows 3 and 7."""
    c = _C(unfetched=range(1, 101), no_district=[3, 7])
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    monkeypatch.setattr(EAR, "_no_district_rows", lambda *a, **k: [])
    EAR.enrich_table("wasalt_residential_listings", limit=5, workers=1, retry_errs=0)
    assert 3 not in _no_net and 7 not in _no_net and _no_net[0] == 100


def test_an_unreadable_index_keeps_the_normal_order_and_never_crashes(monkeypatch, _no_net):
    c = _C(unfetched=range(1, 101), no_district=[3], broken=True)
    monkeypatch.setattr(EAR.db, "sb", lambda: c)
    EAR.enrich_table("wasalt_residential_listings", limit=5, workers=1, retry_errs=0)
    assert _no_net and _no_net[0] == 100
