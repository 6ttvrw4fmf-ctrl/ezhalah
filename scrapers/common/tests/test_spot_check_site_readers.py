"""The double-check reads dealapp and gathern the way their hiding jobs do (2026-10-02).

Judged by HTTP status alone, dealapp's 200 shell read every hidden ad "live" (30 of 30 on
2026-10-02) and gathern was read through a different session than its checker. These tests EXECUTE
_reader_for with each site's own probe stubbed and prove the verdict follows that probe.
"""
from __future__ import annotations

import scrapers.common.lifecycle_spot_check as SC
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN


def test_dealapp_is_read_by_its_liveness_oracle(monkeypatch):
    from scrapers.dealapp import liveness_run
    answers = {"u1": (ALIVE, 200), "u2": (UNKNOWN, 200), "u3": (DEAD, 404)}
    monkeypatch.setattr(liveness_run, "_session", lambda *a, **k: object())
    monkeypatch.setattr(liveness_run, "probe_listing", lambda s, url, budget=None: answers[url])
    read = SC._reader_for("dealapp")
    assert [read(u) for u in ("u1", "u2", "u3")] == [ALIVE, UNKNOWN, DEAD]


def test_gathern_is_read_by_its_checker_session(monkeypatch):
    from scrapers.gathern import liveness as gl
    statuses = {"a": 200, "b": 404, "c": 410, "d": 0, "e": 403, "f": gl.HOME_LANDED}
    monkeypatch.setattr(gl, "proxied_session", lambda use_proxy: object())
    monkeypatch.setattr(gl, "probe", lambda s, url, retries=3, home_status=0: (
        home_status if statuses[url] == gl.HOME_LANDED else statuses[url]))
    read = SC._reader_for("gathern")
    assert [read(u)[0] for u in "abcdef"] == [ALIVE, DEAD, DEAD, UNKNOWN, UNKNOWN, UNKNOWN]
    # 2026-10-17: 919 served units read "transient" every hour; the double-check must say whether
    # that is a home-page landing or no answer at all, or nobody can tell which fix they need.
    assert "home page" in read("f")[1] and "home page" not in read("d")[1]
    row = {"listing_url": "f"}
    assert SC.pick_reader("gathern", None, None)[1](row) == UNKNOWN and "home page" in row["evidence"]


def test_other_sites_keep_the_generic_judge():
    assert SC._reader_for("aqar") is None
    assert SC._reader_for("wasalt") is None


def test_a_daily_direct_site_is_read_by_its_own_oracle(monkeypatch):
    """sanadak, 2026-10-03: its removed ads answer a 200 app shell, so a status read called 8 of 8
    hidden ads "live". The double-check must ask the oracle the hiding job asks, by ad_number."""
    from scrapers.common import fleet_liveness as FL
    said = {"A1": ("live", "page carries A1"), "A2": ("gone", "shell, no listing"), "A3": ("unknown", "5xx")}
    seen_controls = []

    def factory(control):
        seen_controls.append(control)
        return lambda ad: said[ad]
    monkeypatch.setitem(FL.SITES, "sanadak", "x:y()")
    monkeypatch.setattr(FL, "oracle_for", lambda spec, control: factory(control))
    ctl = {"ad_number": "C", "listing_url": "u"}
    method, read = SC.pick_reader("sanadak", None, ctl)
    assert method == "site-oracle"
    assert seen_controls == [ctl]
    rows = [{"ad_number": a, "listing_url": "https://sanadak.sa/x"} for a in ("A1", "A2", "A3")]
    assert [read(r) for r in rows] == [ALIVE, DEAD, UNKNOWN]
    assert read({"ad_number": None, "listing_url": "u"}) == UNKNOWN


def test_reader_order_site_reader_then_oracle_then_marker(monkeypatch):
    from scrapers.common import fleet_liveness as FL
    monkeypatch.setattr(SC, "_reader_for", lambda p: (lambda url: ALIVE) if p == "gathern" else None)
    monkeypatch.setattr(FL, "oracle_for", lambda spec, control: (lambda ad: ("gone", "")))
    assert SC.pick_reader("gathern", None, None)[0] == "site-reader"
    assert SC.pick_reader("tuba", "marker", None)[0] == "site-oracle"
    monkeypatch.delitem(FL.SITES, "tuba")
    assert SC.pick_reader("tuba", "marker", None)[0] == "registered-marker"
    assert SC.pick_reader("aqar", None, None)[0] == "status-only"


def test_dead_visible_score_reads_a_reason_giving_site_reader_as_a_plain_verdict(monkeypatch):
    from scrapers.common import dead_visible_score as DV
    monkeypatch.setattr(DV, "_reader_for", lambda p: (lambda url: (ALIVE, "HTTP 200")))
    method, read = DV.reader_for("gathern", None)
    assert method == "site-reader" and read({"listing_url": "u"}) == ALIVE


def test_ashab_is_read_by_its_own_status_badge(monkeypatch):
    from scrapers.ashab import run as ash
    pages = {"a": ["للإيجار", ash.AVAILABLE], "b": ["للإيجار", "مؤجر"], "c": ["للبيع", "مباع بالكامل"],
             "d": ["للإيجار", "محجوز"], "e": ["للإيجار"]}
    monkeypatch.setattr(SC, "_ashab_session", lambda: object())
    monkeypatch.setattr(ash, "get", lambda s, url: url)
    monkeypatch.setattr(ash, "parse_page", lambda page: {"badges": pages[page]})
    read = SC._reader_for("ashab")
    assert [read(u)[0] for u in "abcde"] == [ALIVE, DEAD, DEAD, UNKNOWN, UNKNOWN]

    def boom(s, url):
        raise RuntimeError("403")
    monkeypatch.setattr(ash, "get", boom)
    assert read("a")[0] == UNKNOWN
