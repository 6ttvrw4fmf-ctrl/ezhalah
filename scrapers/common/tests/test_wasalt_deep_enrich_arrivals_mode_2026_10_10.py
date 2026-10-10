"""Over the proxy cap, the wasalt DEEP enricher still serves today's arrivals (New Listings Engineer, 2026-10-10).

From 10-08 the residential queue held 19-27k rows and every run refused, so no new wasalt ad got facade /
meters / street width (Advanced Filter fields per arrival 0.6 vs 1.1 over 7 days). Over the cap the run
now fetches only rows scraped in the last ARRIVALS_WINDOW_H hours; if that window alone exceeds the cap
(a flag reset / backfill), it still refuses. Executes enrich_table() against a stub client; the first
test fails on the old refuse-everything breaker.

Run: python -m pytest scrapers/common/tests/test_wasalt_deep_enrich_arrivals_mode_2026_10_10.py -v
"""
from __future__ import annotations

import scrapers.wasalt.enrich as EN
from scrapers.common.tests.test_wasalt_enrich_breaker_counts_2026_10_06 import _api


class _Q:
    def __init__(self, c):
        self.c, self.head, self.f, self.n = c, False, [], None

    def select(self, *a, count=None, head=False, **k):
        self.head = head
        return self

    def eq(self, *a): return self
    def like(self, *a): return self
    def is_(self, *a): return self
    def order(self, *a, **k): return self
    def update(self, *a, **k): return self

    def gte(self, col, val):
        self.f.append(("gte", col))
        return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        if self.n == 1:
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


def test_over_cap_still_fetches_fresh_arrivals(monkeypatch):
    c = _C(pending=27119, fresh=7732)          # 2026-10-10 production numbers
    monkeypatch.setattr(EN.db, "sb", lambda: c)
    out = EN.enrich_table("wasalt_residential_listings", limit=10, workers=1)
    assert not out.get("aborted"), "refused the run although today's arrivals fit under the cap"
    assert c.fetches and ("gte", "scraped_at") in c.fetches[0], c.fetches


def test_over_cap_with_a_huge_fresh_window_still_refuses(monkeypatch):
    c = _C(pending=60000, fresh=15001)
    monkeypatch.setattr(EN.db, "sb", lambda: c)
    out = EN.enrich_table("wasalt_residential_listings", limit=10, workers=1)
    assert out["aborted"] == 60000
    assert c.fetches == []


def test_under_cap_is_unchanged(monkeypatch):
    c = _C(pending=500, fresh=500)
    monkeypatch.setattr(EN.db, "sb", lambda: c)
    EN.enrich_table("wasalt_residential_listings", limit=10, workers=1)
    assert c.fetches == [[]]
