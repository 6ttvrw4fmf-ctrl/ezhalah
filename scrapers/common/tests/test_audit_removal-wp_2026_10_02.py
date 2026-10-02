"""Owner, 2026-10-02: «just because you didn't see something doesn't mean it's dead … check the ad's
own page to confirm; if it is removed, remove it». remal, shmoualshmal and wslnaa had NO removal step
(none called prune_unseen), so an ad the office deleted stayed active for good. Each now re-reads a
missing ad's OWN page/record and hides it only on a hard 404 there, under a known-live control.

Measured live 2026-10-02 (no site has a removed cohort yet: every active row is in today's list):
  remal         12/12 live ads: 200 + `<body class="… single-estate postid-N">`; never-existed: 404
  shmoualshmal   6/6  live ads: 200 + `<body class="… single-property postid-N">`; never-existed: 404
  wslnaa        59/59 records: 200, active, not deleted, «available»; never-existed slug: 404 tRPC
                NOT_FOUND on properties.bySlug (its PAGE answers 200 for anything, so it is not read)
All fixtures are synthetic."""
import json
import sys

import pytest

import scrapers.common.http_liveness as HL
from scrapers.remal import run as RM
from scrapers.shmoualshmal import run as SH
from scrapers.wslnaa import run as WS

WP = ((RM, "single-estate"), (SH, "single-property"))
SITES = [(RM, "remal"), (SH, "shmoualshmal"), (WS, "wslnaa")]
_404 = '<html><body class="rtl error404 theme-x">الصفحة غير موجودة</body></html>'


def _wp(kind):
    return f'<html><body class="rtl single {kind} postid-7 theme-x"><h1>أرض للبيع</h1></body></html>'


def _rec(**over):
    p = {"id": 1, "slug": "a-1", "active": True, "deletedAt": None, "status": "available", **over}
    return json.dumps([{"result": {"data": {"json": p}}}])


def _err(message="NOT_FOUND", path="properties.bySlug"):
    return json.dumps([{"error": {"json": {"message": message, "code": -32004,
                                           "data": {"code": "NOT_FOUND", "httpStatus": 404, "path": path}}}}])


def test_wp_a_404_on_the_ads_own_url_is_gone_and_its_own_post_page_is_live():
    for R, kind in WP:
        assert R._signal(404, _404, False) == "gone"
        assert R._signal(410, _404, False) == "gone"
        assert R._signal(200, _wp(kind), False) == "live"


def test_wp_anything_unclear_is_unknown_never_gone():
    for R, kind in WP:
        assert R._signal(200, _404, False) is None                    # a 200 shell says nothing
        assert R._signal(200, '<body class="archive post-type-archive">', False) is None
        assert R._signal(404, _404, True) is None                     # the 404 is another path's
        assert R._signal(200, _wp(kind), True) is None                # landed on another post
        for status in (None, 301, 403, 429, 500, 503):
            assert R._signal(status, _404, False) is None
        # a neighbour's card further down the page is not this page's own <body> class
        assert R._signal(200, f'<body class="home"><article class="{kind} postid-9">', False) is None


def test_wslnaa_the_records_own_not_found_is_gone_and_an_open_offer_is_live():
    assert WS._signal(404, _err(), False) == "gone"
    assert WS._signal(200, _rec(), False) == "live"


def test_wslnaa_unmeasured_or_unreadable_answers_are_unknown_never_gone():
    assert WS._signal(404, "<html>Not Found</html>", False) is None       # a gateway's 404
    assert WS._signal(404, _err(message='No "query"-procedure on path'), False) is None
    assert WS._signal(404, _err(path="properties.list"), False) is None
    # values no record carried on the day of measurement: held, never hidden, never called live
    for over in ({"status": "rented"}, {"active": False}, {"deletedAt": "2026-10-01T00:00:00Z"}):
        assert WS._signal(200, _rec(**over), False) is None, over
    assert WS._signal(200, json.dumps([{"result": {"data": {"json": None}}}]), False) is None
    assert WS._signal(200, "<html>app shell</html>", False) is None       # the page, not the record
    assert WS._signal(503, _err(), False) is None and WS._signal(404, _err(), True) is None
    assert WS._signal(403, _rec(), False) is None


@pytest.mark.parametrize("R,gone", [(RM, (404, _404)), (SH, (404, _404)), (WS, (404, _err()))])
def test_a_removal_is_believed_only_beside_a_known_live_control(monkeypatch, R, gone):
    live = (200, _rec()) if R is WS else (200, _wp(dict(WP)[R]))
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "stored_listing_url", lambda tables: (lambda ad: f"https://x/properties/{ad}"))
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: (*gone, False))
    assert R._make_verify_gone(None)("A1")[0] == "unknown", "no control → no removal is believed"
    # a control that itself reads gone means the SOURCE is not answering truthfully
    assert R._make_verify_gone({"ad_number": "C1"})("A1")[0] == "unknown"
    monkeypatch.setattr(HL.LivenessProbe, "fetch",
                        lambda self, url: (*(live if "C1" in url else gone), False))
    assert R._make_verify_gone({"ad_number": "C1"})("A1")[0] == "gone"
    # a row whose own URL cannot be looked up is never removed
    monkeypatch.setattr(R, "stored_listing_url", lambda tables: (lambda ad: None))
    assert R._make_verify_gone({"ad_number": "C1"})("A1")[0] == "unknown"


def _run_main(monkeypatch, R, site, incomplete=False, argv=()):
    """Run the crawler's real main() with the network and the database stubbed out; return every
    prune_unseen call it made."""
    calls = []
    row = {"ad_number": "A1"}

    def walk(*a, **k):
        getattr(R, "INCOMPLETE", [])[:] = ["page 2 returned HTTP 503"] if incomplete else []
        return [{"id": 1}]

    monkeypatch.setattr(sys, "argv", ["run.py", *argv])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "stored_listing_url", lambda tables: (lambda ad: None), raising=False)
    monkeypatch.setattr(R.db, "begin_run", lambda *a, **k: "run")
    monkeypatch.setattr(R.db, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(R.db, f"upsert_{site}_residential_batch", lambda rows: None)
    monkeypatch.setattr(R.db, f"upsert_{site}_commercial_batch", lambda rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen",
                        lambda tbl, seen, **k: calls.append((tbl, set(seen), k)) or 0)
    if R is WS:
        monkeypatch.setattr(R, "fetch_slugs", lambda s, limit=0: ["a-1"] if walk() else [])
        monkeypatch.setattr(R, "fetch_one", lambda s, slug: {"id": 1})
        monkeypatch.setattr(R, "map_listing", lambda p: (row, "residential", ""))
    else:
        monkeypatch.setattr(R, "fetch_listings", walk)
        monkeypatch.setattr(R, "fetch_images", lambda s, posts: {})
        monkeypatch.setattr(R, "fetch_taxonomies", lambda s: {}, raising=False)
        monkeypatch.setattr(R, "map_listing", lambda p, *a: (row, "residential"))
    try:
        assert R.main() == 0
    finally:
        getattr(R, "INCOMPLETE", []).clear()
    return calls


@pytest.mark.parametrize("R,site", SITES)
def test_a_complete_full_run_hands_the_oracle_to_prune_for_both_tables(monkeypatch, R, site):
    calls = _run_main(monkeypatch, R, site)
    assert [c[0] for c in calls] == [f"{site}_residential_listings", f"{site}_commercial_listings"], (
        "this crawler never asks whether a missing ad was removed")
    assert calls[0][1] == {"A1"} and calls[1][1] == set()
    for _tbl, _seen, kw in calls:
        assert callable(kw.get("verify_gone")), "absence alone must never hide a listing"
        assert kw.get("source") == R.SOURCE


@pytest.mark.parametrize("R,site", SITES)
def test_a_partial_walk_or_a_single_vertical_run_never_prunes(monkeypatch, R, site):
    assert _run_main(monkeypatch, R, site, incomplete=True) == []
    assert _run_main(monkeypatch, R, site, argv=("--type", "residential")) == []


class _Resp:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status

    def json(self):
        return self._payload


def test_wp_walk_is_complete_only_when_it_ends_on_a_short_page(monkeypatch):
    for R in (RM, SH):
        monkeypatch.setattr(R.time, "sleep", lambda *a, **k: None)
        pages = {1: _Resp([{"id": i} for i in range(100)]), 2: _Resp(None, 503)}

        class _S:
            def get(self, url, timeout=None):
                return pages[int(url.rsplit("page=", 1)[1])]

        assert len(R.fetch_listings(_S())) == 100 and R.INCOMPLETE, "page 2 was never read"
        pages[2] = _Resp([{"id": 100}])
        assert len(R.fetch_listings(_S())) == 101 and not R.INCOMPLETE


def test_wslnaa_an_unread_record_makes_the_walk_incomplete_and_a_404_does_not():
    class _S:
        def __init__(self, status, payload):
            self.r = _Resp(payload, status)

        def get(self, url, params=None, timeout=None):
            return self.r

    try:
        WS.INCOMPLETE.clear()
        assert WS.fetch_one(_S(404, None), "a-1") is None and not WS.INCOMPLETE
        assert WS.fetch_one(_S(503, None), "a-1") is None and len(WS.INCOMPLETE) == 1
        assert WS.fetch_one(_S(200, {"not": "a tRPC batch"}), "a-1") is None and len(WS.INCOMPLETE) == 2
    finally:
        WS.INCOMPLETE.clear()
