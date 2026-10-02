"""dealapp recover reads each hidden ad through the SAME oracle the liveness job hides with (2026-10-02).

Until 2026-10-02 `scrapers/dealapp/recover.py` fetched with the crawl's unpaced `fetch_one` and
demanded `availability=InStock`. dealapp answers that path with shells and its view-quota wall, so
every run since at least 2026-08-26 read 100% UNKNOWN (1,471 of 1,471 on 2026-10-02) and could
never bring a single live ad back, while 1,932 dealapp ads had been hidden that morning with no page
reading at all. These tests EXECUTE `recover_table` against a stub oracle and a stub database.
"""
from __future__ import annotations

import importlib
import sys

from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN

RES = "dealapp_residential_listings"
COM = "dealapp_commercial_listings"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, store):
        self.t, self.store = table, store
        self.filters: list = []
        self.patch = None
        self.ids = None

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def in_(self, col, vals):
        self.filters.append((col, set(vals), "in"))
        return self

    def update(self, patch):
        self.patch = patch
        return self

    def _match(self, r):
        for f in self.filters:
            if len(f) == 3:
                if r.get(f[0]) not in f[1]:
                    return False
            elif r.get(f[0]) != f[1]:
                return False
        return True

    def execute(self):
        rows = [r for r in self.store.get(self.t, []) if self._match(r)]
        if self.patch is not None:
            for r in rows:
                r.update(self.patch)
        return _Resp(rows)


def _load(monkeypatch, store, verdicts):
    sys.modules.pop("scrapers.dealapp.recover", None)
    rec = importlib.import_module("scrapers.dealapp.recover")

    class _C:
        def table(self, name):
            return _Query(name, store)

    monkeypatch.setattr(rec, "sb", lambda: _C())
    monkeypatch.setattr(rec.liveness_run, "_session", lambda *a, **k: object())
    monkeypatch.setattr(rec.liveness_run, "probe_listing",
                        lambda s, url, budget=None: (verdicts[url], 200))
    return rec


def _row(i, url):
    return {"id": i, "ad_number": f"DA{i}", "listing_url": url, "active": False}


def test_only_an_oracle_ALIVE_row_comes_back(monkeypatch):
    urls = {u: v for u, v in [("https://dealapp.sa/ar/ad-details/1", ALIVE),
                              ("https://dealapp.sa/ar/ad-details/2", UNKNOWN),
                              ("https://dealapp.sa/ar/ad-details/3", DEAD)]}
    store = {RES: [_row(i + 1, u) for i, u in enumerate(urls)], COM: [], "ops_adjudicated_listing": []}
    rec = _load(monkeypatch, store, urls)
    st = rec.recover_table(RES, 0, 1)
    assert st == {"checked": 3, "recovered": 1, "sold": 1, "unknown": 1}
    by_id = {r["id"]: r for r in store[RES]}
    assert by_id[1]["active"] is True
    assert by_id[1]["last_verified_alive_at"]          # proven alive, stamped through the contract
    assert by_id[2]["active"] is False and "last_verified_alive_at" not in by_id[2]
    assert by_id[3]["active"] is False and "last_verified_alive_at" not in by_id[3]


def test_unknown_never_reactivates(monkeypatch):
    urls = {f"https://dealapp.sa/ar/ad-details/{i}": UNKNOWN for i in range(1, 6)}
    store = {RES: [_row(i + 1, u) for i, u in enumerate(urls)], COM: [], "ops_adjudicated_listing": []}
    rec = _load(monkeypatch, store, urls)
    assert rec.recover_table(RES, 0, 2)["recovered"] == 0
    assert all(r["active"] is False for r in store[RES])


def test_row_without_url_is_read_by_its_ad_number(monkeypatch):
    url = "https://dealapp.sa/ar/ad-details/77"
    store = {RES: [{"id": 9, "ad_number": "DA77", "listing_url": None, "active": False}],
             COM: [], "ops_adjudicated_listing": []}
    rec = _load(monkeypatch, store, {url: ALIVE})
    assert rec.recover_table(RES, 0, 1)["recovered"] == 1
