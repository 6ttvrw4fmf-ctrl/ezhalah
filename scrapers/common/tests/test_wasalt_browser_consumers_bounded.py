"""Every wasalt browser consumer fetches through BoundedBrowserFetcher (ops_incident #708 variants).

liveness.py was bounded in PR #4304. The cleanup recheck probe, the enumeration crawl (run.py) and
the Arabic enricher (enrich_ar.py) built the unbounded BrowserFetcher directly, so one stuck
new_page()/page.content() froze the whole job. These tests drive each consumer's REAL entry point
against a child browser that genuinely never answers, and check that the call returns within the
deadline with that consumer's existing "no answer" shape — never an empty result, never a death.
"""
from __future__ import annotations

import time

import pytest

import scrapers.common.cleanup as C
from scrapers.common.tests.test_wasalt_browser_hard_deadline import within
from scrapers.wasalt import browser as B
from scrapers.wasalt import enrich_ar as E
from scrapers.wasalt import run as R

DEADLINE = 1.5
SEARCH = {"props": {"pageProps": {"searchResult": {"count": 1, "totalPages": 1,
                                                    "properties": [{"id": 7}]}}}}
DETAIL = {"props": {"pageProps": {"propertyDetailsV3": {"id": 7, "propertyInfo": {}}}}}


class _HangsOnMarker:
    """Browser contract twin; any URL containing 'hang' never returns."""

    def next_data(self, url):
        if "hang" in url:
            time.sleep(3600)
        return SEARCH if "/search" in url else DETAIL

    def page_data(self, url):
        if "hang" in url:
            time.sleep(3600)
        return DETAIL, 200, 326339

    def close(self):
        pass


@pytest.fixture
def bounded(monkeypatch):
    monkeypatch.setenv("WASALT_BROWSER", "1")
    f = B.BoundedBrowserFetcher(factory=_HangsOnMarker, deadline_s=DEADLINE)
    yield f
    f.close()


@pytest.mark.parametrize("mod, getter", [(C, "_wasalt_browser"), (R, "_browser"), (E, "_browser")],
                         ids=["cleanup", "run", "enrich_ar"])
def test_each_consumer_builds_the_bounded_fetcher(monkeypatch, mod, getter):
    monkeypatch.setattr(mod, "_BROWSER", None)
    got = getattr(mod, getter)()
    assert isinstance(got, B.BoundedBrowserFetcher), f"{mod.__name__} built {type(got).__name__}"
    assert got._proc is None, "building the fetcher must not start a browser"


def test_cleanup_probe_on_a_hung_browser_is_unknown(monkeypatch, bounded):
    monkeypatch.setattr(C, "_BROWSER", bounded)
    assert within(DEADLINE + 20, lambda: C._wasalt_browser_probe(
        "https://wasalt.sa/en/property/hang-1")) == (None, "")
    assert C._wasalt_browser_probe("https://wasalt.sa/en/property/ok-2") == (200, "")
    assert bounded.deadline_kills == 1


def test_run_fetch_page_on_a_hung_browser_is_invalid_not_empty(monkeypatch, bounded):
    monkeypatch.setattr(R, "_BROWSER", bounded)
    monkeypatch.setattr(R, "_throttle", lambda: None)
    out = within(DEADLINE + 20, lambda: R.fetch_page(None, "sale", "hang", "villa", 1))
    assert out == (0, 0, [], False), "a hung page read as a genuinely empty category"
    count, pages, props, valid = R.fetch_page(None, "sale", "residential", "villa", 1)
    assert (count, pages, valid) == (1, 1, True) and props == [{"id": 7}]
    assert bounded.deadline_kills == 1


def test_enrich_fetch_ar_on_a_hung_browser_leaves_the_row_untouched(monkeypatch, bounded):
    monkeypatch.setattr(E, "_BROWSER", bounded)
    monkeypatch.setattr(E, "_throttle", lambda: None)
    out = within(2 * DEADLINE + 20, lambda: E.fetch_ar("hang-7"))
    assert out[0] is False, f"a hung fetch became a definitive answer: {out!r}"
    assert bounded.deadline_kills >= 1


class _Challenged:
    def next_data(self, url):
        B._record_failure("challenge_shell")
        return None

    def close(self):
        pass


def test_failures_counted_in_the_child_reach_the_parents_scrape_runs_tally(monkeypatch):
    """run.py persists fail_reasons_summary() to scrape_runs.notes; the browser now runs in a child,
    so without shipping the counts back every enum run would report no browser failures at all."""
    monkeypatch.setattr(B, "_fail_reasons", B.Counter())
    f = B.BoundedBrowserFetcher(factory=_Challenged, deadline_s=DEADLINE)
    try:
        assert f.next_data("https://wasalt.sa/en/sale/search?page=1") is None
        assert f.next_data("https://wasalt.sa/en/sale/search?page=2") is None
    finally:
        f.close()
    assert "challenge_shell=2" in B.fail_reasons_summary(), B.fail_reasons_summary()
