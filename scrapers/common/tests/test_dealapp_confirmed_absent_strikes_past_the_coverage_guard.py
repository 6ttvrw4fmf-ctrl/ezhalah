"""dealapp: an ad read gone on its OWN page is struck even when the absence prune is guarded (2026-10-06).

Every dealapp crawl shard ends on its time budget and re-sees ~60% of its slice, so prune_unseen's
coverage guard (a guard against counting ABSENCE on a partial walk) tripped every night and the
same run's confirmed_absent() evidence — a fresh render of the ad's own page as dealapp's
no-listing page, between two live-ad renders — was discarded with it: 0 dealapp hides in 7 days
(measured 2026-10-05). These tests EXECUTE run.prune_table() over the REAL prune_unseen against a
stub client, and read what it writes.
"""
from __future__ import annotations

import types

from scrapers.common import db
from scrapers.dealapp import run

TBL = "dealapp_residential_listings"


class _Q:
    def __init__(self, sink):
        self.sink, self.payload = sink, None

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def update(self, payload):
        self.payload = payload
        return self

    def in_(self, _col, ads):
        if self.payload is not None:
            self.sink.append((self.payload, sorted(ads)))
        return self


def _setup(monkeypatch, active):
    written: list = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q(written)))

    def _exec(q, what="", **_k):
        if what.endswith("prune_select"):
            return types.SimpleNamespace(data=[dict(r) for r in active])
        if what.endswith("absent_slice"):
            return types.SimpleNamespace(data=[{"ad_number": r["ad_number"]} for r in active])
        return types.SimpleNamespace(data=[])
    monkeypatch.setattr(db, "_execute", _exec)
    db._PRUNE_TRIPS.clear()
    return written


ACTIVE = [{"ad_number": f"DA{i}", "missing_count": 2 if i == 5 else 0} for i in range(100)]
SEEN_PARTIAL = {f"DA{i}" for i in range(60)} - {"DA5", "DA7"}          # a 58% walk: guard trips
ABSENT = {"5": "fresh origin render: no listing, between two live ads",
          "7": "fresh origin render: no listing, between two live ads"}


def _gone(ad):
    return ("gone", ABSENT["".join(ch for ch in ad if ch.isdigit())]) if ad[2:] in ABSENT else ("unknown", "")


def test_guarded_walk_still_strikes_only_the_confirmed_absent(monkeypatch):
    written = _setup(monkeypatch, ACTIVE)
    killed = run.prune_table(TBL, SEEN_PARTIAL, ABSENT, _gone, 1, 0)
    touched = sorted(a for _p, ads in written for a in ads)
    assert touched == ["DA5", "DA7"], touched                     # the 40 unreached rows untouched
    hide = [ads for p, ads in written if p.get("active") is False]
    strike = [ads for p, ads in written if p.get("missing_count") == 1 and "active" not in p]
    assert hide == [["DA5"]] and strike == [["DA7"]]
    assert killed == 1


def test_no_confirmed_absent_means_nothing_written(monkeypatch):
    written = _setup(monkeypatch, ACTIVE)
    assert run.prune_table(TBL, SEEN_PARTIAL, {}, _gone, 1, 0) == 0
    assert written == []


def test_a_full_walk_is_the_normal_prune_unchanged(monkeypatch):
    written = _setup(monkeypatch, ACTIVE)
    full = {r["ad_number"] for r in ACTIVE} - {"DA7"}
    run.prune_table(TBL, full, ABSENT, _gone, 1, 0)
    assert sorted(a for _p, ads in written for a in ads) == ["DA7"]
