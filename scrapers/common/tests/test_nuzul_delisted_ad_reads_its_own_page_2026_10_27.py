"""A Nuzul ad missing from a COMPLETE list is retired when its own web page is gone (2026-10-27).

yameen: YMN45960/45197/45194/52439 left the public list on 10-25; www.yameen.sa/properties/<id> answers 404
(a seen control answers 200), but the API detail still says «available». The API-only oracle could never
retire them, and prune_unseen's collapse cap (4 of 10 = 40%) refused the prune every run (P0
silent_scraper_death). delisted_or_api_gone lets the own page decide when the API still says live, and
prune_complete_crawl reads the unseen ads after a refused prune, inside the collapse cap.
"""
from __future__ import annotations

from scrapers.goldendeal import run as G


def test_api_gone_wins():
    v = G.delisted_or_api_gone(lambda ad: ("gone", "withdrawn"), lambda ad: ("live", "200"))
    assert v("YMN1")[0] == "gone"


def test_api_live_but_own_page_404_is_gone():
    v = G.delisted_or_api_gone(lambda ad: ("live", "available"), lambda ad: ("gone", "404 while control 200"))
    verdict, why = v("YMN45960")
    assert verdict == "gone" and "own page" in why and "api said live" in why


def test_api_live_and_own_page_live_stays_live():
    v = G.delisted_or_api_gone(lambda ad: ("live", "available"), lambda ad: ("live", "200"))
    assert v("YMN1")[0] == "live"


def test_own_page_unknown_never_kills():
    v = G.delisted_or_api_gone(lambda ad: ("live", "available"), lambda ad: ("unknown", "no control"))
    assert v("YMN1")[0] == "live"
    v2 = G.delisted_or_api_gone(lambda ad: ("unknown", "blocked"), lambda ad: ("unknown", "blocked"))
    assert v2("YMN1")[0] == "unknown"


def test_refused_prune_reads_the_unseen_own_pages(monkeypatch):
    calls = {}
    monkeypatch.setattr(G.db, "prune_unseen", lambda *a, **k: -1)
    monkeypatch.setattr(G.db, "sb", lambda: object())
    monkeypatch.setattr(G.db, "own_page_status_oracle", lambda c, t, seen: (lambda ad: ("gone", "404")))

    def fake_strike(table, seen, source, verify_gone=None, **kw):
        calls["seen"], calls["verdict"], calls["kw"] = set(seen), verify_gone("YMN45960"), kw
        return 3
    monkeypatch.setattr(G.db, "strike_read_gone", fake_strike)
    rows = [{"ad_number": f"YMN{i}"} for i in range(6)]
    out = G.prune_complete_crawl("yameen_residential_listings", rows, "Yameen", lambda ad: ("live", "available"))
    assert out == -1, "the refused prune still marks the run degraded"
    assert calls["seen"] == {f"YMN{i}" for i in range(6)}
    assert calls["verdict"][0] == "gone"
    assert calls["kw"].get("_from_refused_prune") is True


def test_an_accepted_prune_reads_nothing_extra(monkeypatch):
    monkeypatch.setattr(G.db, "prune_unseen", lambda *a, **k: 0)
    monkeypatch.setattr(G.db, "strike_read_gone", lambda *a, **k: (_ for _ in ()).throw(AssertionError("not called")))
    assert G.prune_complete_crawl("t", [{"ad_number": "YMN1"}], "Yameen", lambda ad: ("live", "x")) == 0
