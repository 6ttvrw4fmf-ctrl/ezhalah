"""dealapp recover: «checked» means dealapp gave a fresh page, and a run that got none fails (2026-10-02).

Run 57878 (2026-10-02 17:08 → 18:53 UTC) wrote «recovered=0 sold=0 unknown=3548 of checked=3548»
and finished green. Its log shows what happened: 100 rows every 11 minutes (the 9-renders-a-minute
pace) for 105 minutes, about 945 rows, then the other ~2,600 in under two seconds once the time was
up, each counted as "checked" with no request sent. The 945 it did render were the newest-hidden
batch in id order, and dealapp answers those with its «no such ad» page (11 of 11 sampled from a
home IP), while a hidden ad its sitemap still lists read ALIVE and was never reached.

These tests EXECUTE recover against the real oracle (liveness_run.probe_listing) with a scripted
dealapp and an in-memory database. Synthetic ads only.
"""
from __future__ import annotations

import copy
import sys
import time
import types

import pytest

from scrapers.common.tests.test_dealapp_recover_uses_liveness_oracle import _Query
from scrapers.dealapp import liveness_run
from scrapers.dealapp import recover as rec
from scrapers.dealapp.liveness import OriginBudget

RES = "dealapp_residential_listings"
COM = "dealapp_commercial_listings"

FRESH = {"x-cache": "Miss from cloudfront"}
STALE = {"x-cache": "Hit from cloudfront", "age": "184390"}     # a two-day-old CDN copy
LISTING = '<title>ad</title><script id="real-estate-listing-schema-{}"></script>'
NO_AD = '<title>home</title><script id="ng-state"></script>'    # what a made-up id renders
WALL = "<title>صفحة التسجيل</title>"
BLOCK = "<html>The request could not be satisfied</html>"       # an edge/API refusal, not dealapp's app


class _Dealapp:
    """dealapp, scripted per ad: whichever cache key is asked, that ad's page comes back.
    pages[adid] = (body, headers) for an HTTP 200, or (body, headers, status)."""

    def __init__(self, pages):
        self.pages, self.asked = pages, []

    def get(self, url, **_k):
        adid = liveness_run._adid(url)
        self.asked.append(adid)
        text, headers, *status = self.pages[adid]
        return types.SimpleNamespace(status_code=status[0] if status else 200, text=text.format(adid),
                                     url=url, headers=headers)


def _row(i, hidden_at="2026-10-02T11:30:46+00:00"):
    return {"id": i, "ad_number": f"DA{i}", "active": False, "deactivated_at": hidden_at,
            "listing_url": f"https://dealapp.sa/ar/ad-details/{i}"}


@pytest.fixture()
def rig(monkeypatch):
    """Recover wired to a scripted dealapp, an in-memory database and a pacer that never sleeps."""
    def build(store, pages, sitemap=frozenset(), time_left=3600.0):
        store.setdefault(RES, []), store.setdefault(COM, []), store.setdefault("ops_adjudicated_listing", [])
        dealapp = _Dealapp(pages)
        clock = [0.0]
        pacer = OriginBudget(per_min=10_000, clock=lambda: clock[0],
                             sleep=lambda s: clock.__setitem__(0, clock[0] + s))
        monkeypatch.setattr(rec, "sb", lambda: types.SimpleNamespace(table=lambda name: _Query(name, store)))
        monkeypatch.setattr(liveness_run, "_session", lambda *a, **k: dealapp)
        monkeypatch.setattr(liveness_run, "harvest_sitemap_ids", lambda s, budget=None: sitemap)
        monkeypatch.setattr(liveness_run, "_ORIGIN", pacer)
        monkeypatch.setattr(liveness_run, "_DEADLINE", time.monotonic() + time_left)
        return dealapp, pacer
    return build


def test_a_row_the_run_never_asked_is_not_checked(rig):
    store = {RES: [_row(1), _row(2), _row(3)]}
    dealapp, _ = rig(store, {}, time_left=-1.0)          # the run's time is already up
    st = rec.recover_table(RES, 0, 2)
    assert st["checked"] == 0, "a row nobody asked dealapp about was counted as checked"
    assert (st["not_reached"], st["unknown"]) == (3, 0)
    assert dealapp.asked == []


def test_checked_counts_fresh_pages_only_and_unknown_writes_nothing(rig):
    store = {RES: [_row(1), _row(2), _row(3), _row(4)]}
    before = copy.deepcopy(store[RES])
    pages = {"1": (LISTING, FRESH), "2": (NO_AD, FRESH), "3": (LISTING, STALE), "4": (WALL, FRESH)}
    _, pacer = rig(store, pages)
    st = rec.recover_table(RES, 0, 1)
    assert st["checked"] == 2, "only ads 1 and 2 got a fresh page about the ad"
    assert {k: st[k] for k in ("recovered", "sold", "unknown", "wall", "no_answer", "not_reached")} == {
        "recovered": 1, "sold": 0, "unknown": 1, "wall": 1, "no_answer": 1, "not_reached": 0}
    assert store[RES][0]["active"] is True and store[RES][0]["last_verified_alive_at"]
    assert store[RES][1:] == before[1:], "a row that did not read ALIVE was written to"
    assert pacer._pause_until > 0, "a fresh wall means the quota is spent: the pacer must sit out a window"


def test_ads_dealapp_still_lists_are_read_first_then_newest_hidden(rig):
    store = {RES: [_row(1), _row(2), _row(3, "2026-09-29T04:19:52+00:00")],
             COM: [_row(44, "2026-09-01T00:00:00+00:00")]}
    dealapp, _ = rig(store, {a: (NO_AD, FRESH) for a in ("1", "2", "3", "44")}, sitemap=frozenset({"3", "44"}))
    st = rec.recover([RES, COM], 0, 1)
    assert dealapp.asked == ["3", "44", "1", "2"]
    assert (st["hidden"], st["in_sitemap"], st["checked"]) == (4, 2, 4)


def test_one_blocked_reply_is_not_checked_and_one_real_page_is(rig):
    store = {RES: [_row(1), _row(2), _row(3)]}
    rig(store, {"1": (BLOCK, FRESH, 403), "2": (NO_AD, FRESH), "3": ("", FRESH)})
    st = rec.recover_table(RES, 0, 1)
    assert (st["checked"], st["unknown"], st["no_answer"]) == (1, 1, 2)
    assert all(r["active"] is False for r in store[RES])


def test_an_ad_hidden_in_both_tables_comes_back_as_one_card(rig):
    """One source URL, two of our rows: its page reading ALIVE cannot prove both. Residential is
    read first (as before the two tables became one worklist) and the other row stays hidden."""
    twin = {**_row(9), "ad_number": "DA1", "listing_url": _row(1)["listing_url"]}
    store = {RES: [_row(1)], COM: [twin, _row(2)]}
    dealapp, _ = rig(store, {"1": (LISTING, FRESH), "2": (LISTING, FRESH)}, sitemap=frozenset({"1"}))
    st = rec.recover([RES, COM], 0, 1)
    assert [r["active"] for r in store[RES] + store[COM]] == [True, False, True]
    assert st["recovered"] == 2 and st["same_ad_twice"] == 1
    assert dealapp.asked.count("1") == 1, "the same page was read twice for one ad"
    # The next run finds the residential row live, so the sibling guard keeps the twin hidden.
    assert rec.recover([RES, COM], 0, 1)["recovered"] == 0 and store[COM][0]["active"] is False


@pytest.mark.parametrize("pages, minutes, code, said", [
    ({}, "-1", 1, "not_reached=2"),                                       # out of time before any read
    ({"1": (WALL, FRESH), "2": (WALL, FRESH)}, "105", 1, "wall=2"),         # walled on every ad
    ({"1": (LISTING, STALE), "2": (LISTING, STALE)}, "105", 1, "no_answer=2"),   # only stale CDN copies
    # Blocked on every ad: a fresh reply that is not dealapp's page says nothing about the ad.
    ({"1": (BLOCK, FRESH, 403), "2": (BLOCK, FRESH, 403)}, "105", 1,
     "unknown=0 of checked=0 | not checked: wall=0 no_answer=2"),
    ({"1": (BLOCK, FRESH, 429), "2": (BLOCK, FRESH, 401)}, "105", 1, "no_answer=2"),
    ({"1": (NO_AD, FRESH, 503), "2": (NO_AD, FRESH, 403)}, "105", 1, "no_answer=2"),   # the app, refusing
    ({"1": ("", FRESH), "2": (BLOCK, FRESH)}, "105", 1, "no_answer=2"),     # HTTP 200, but not the app
    ({"1": (NO_AD, FRESH), "2": (NO_AD, FRESH)}, "105", 0, "unknown=2 of checked=2"),   # read, not there
])
def test_a_run_with_no_fresh_page_fails_and_says_why(rig, monkeypatch, pages, minutes, code, said):
    store = {RES: [_row(1), _row(2)]}
    rig(store, pages)
    ended = {}
    monkeypatch.setattr(rec, "begin_run", lambda name: 7)
    monkeypatch.setattr(rec, "end_run", lambda run_id, **k: ended.update(k))
    monkeypatch.setattr(sys, "argv", ["recover", "--table", RES, "--minutes", minutes])
    assert rec.main() == code
    assert ended["ok"] is (code == 0) and said in ended["notes"]
    assert ended["rows_seen"] == (2 if code == 0 else 0) and ended["rows_upserted"] == 0
    assert all(r["active"] is False for r in store[RES])


def test_nothing_hidden_is_a_healthy_empty_run(rig, monkeypatch):
    rig({}, {})
    ended = {}
    monkeypatch.setattr(rec, "begin_run", lambda name: 7)
    monkeypatch.setattr(rec, "end_run", lambda run_id, **k: ended.update(k))
    monkeypatch.setattr(sys, "argv", ["recover"])
    assert rec.main() == 0 and ended["ok"] is True
