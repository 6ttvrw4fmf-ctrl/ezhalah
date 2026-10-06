"""lifecycle_spot_check: a hidden row whose ad lives on in a sibling table is not a wrong hide (2026-10-06).

abralosol 10301747 (ABR7444) was retired SUPERSEDED on 2026-09-28 when the same ad was classified
into abralosol_commercial_listings; its URL is live because the commercial row serves it. The
double-check opened it, read 200 and reported "1 wrong answer". This EXECUTES live_in_sibling().
"""
from __future__ import annotations

from scrapers.common import lifecycle_spot_check as sc


class _Q:
    def __init__(self, rows):
        self.rows, self.f = rows, {}

    def select(self, *_a, **_k):
        return self

    def eq(self, k, v):
        self.f[k] = v
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        return type("R", (), {"data": [r for r in self.rows
                                       if all(r.get(k) == v for k, v in self.f.items())]})()


class _C:
    def __init__(self, tables):
        self.tables = tables

    def table(self, t):
        return _Q(self.tables.get(t, []))


T = ["abralosol_commercial_listings", "abralosol_residential_listings"]


def test_superseded_row_is_skipped():
    c = _C({"abralosol_commercial_listings": [{"id": 9, "ad_number": "ABR7444", "active": True}]})
    assert sc.live_in_sibling(c, T, {"table": T[1], "ad_number": "ABR7444"}) is True


def test_a_row_hidden_everywhere_stays_in_the_sample():
    c = _C({"abralosol_commercial_listings": [{"id": 9, "ad_number": "ABR7444", "active": False}]})
    assert sc.live_in_sibling(c, T, {"table": T[1], "ad_number": "ABR7444"}) is False


def test_its_own_table_does_not_count():
    c = _C({T[1]: [{"id": 1, "ad_number": "ABR1", "active": True}]})
    assert sc.live_in_sibling(c, T, {"table": T[1], "ad_number": "ABR1"}) is False
