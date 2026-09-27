"""retry_smarter_session(): 2+ browser profiles DIRECT, then the same through the proxy.

SCRAPING_ENGINEER.md step 6 only lets a site be called "down at source" after the crawl has tried
2+ profiles AND the residential proxy. sadin, awal and aqaralsaudia were pinned to chrome124 with no
proxy, so that evidence could never exist. These tests pin the order, the proxy leg, the non-raising
fallback, and that the probe log names every attempt.
"""
from __future__ import annotations

import pytest

from scrapers.common import http


class _Resp:
    def __init__(self, status: int):
        self.status_code = status


def _fake_session(outcomes: dict, calls: list):
    """cc.Session stand-in: outcome keyed by (route, profile); an Exception instance is raised."""
    class _S:
        def __init__(self, impersonate=None, proxies=None):
            self.impersonate = impersonate
            self.proxies = proxies
            self.headers: dict = {}

        def get(self, url, timeout=None):
            route = "proxy" if self.proxies else "direct"
            calls.append((route, self.impersonate))
            out = outcomes.get((route, self.impersonate), 502)
            if isinstance(out, Exception):
                raise out
            return _Resp(out)
    return _S


def _run(monkeypatch, outcomes, proxy_url=""):
    calls: list = []
    monkeypatch.setattr(http.cc, "Session", _fake_session(outcomes, calls))
    if proxy_url:
        monkeypatch.setenv("WASALT_PROXY_URL", proxy_url)
    else:
        monkeypatch.delenv("WASALT_PROXY_URL", raising=False)
    s, tried = http.retry_smarter_session("https://example.test/x", headers={"A": "b"})
    return s, tried, calls


def test_all_down_tries_every_profile_direct_then_through_proxy(monkeypatch):
    s, tried, calls = _run(monkeypatch, {}, proxy_url="http://p.test:1")
    assert calls == [("direct", "chrome124"), ("direct", "safari17_0"), ("direct", "firefox133"),
                     ("proxy", "chrome124"), ("proxy", "safari17_0"), ("proxy", "firefox133")]
    assert tried == ["direct/chrome124:502", "direct/safari17_0:502", "direct/firefox133:502",
                     "proxy/chrome124:502", "proxy/safari17_0:502", "proxy/firefox133:502"]
    # Never raises; falls back to a plain first-profile DIRECT session so the caller's own
    # failure path runs unchanged.
    assert s.impersonate == "chrome124" and s.proxies is None
    assert s.headers == {"A": "b"}


def test_no_proxy_env_means_direct_only(monkeypatch):
    _, tried, calls = _run(monkeypatch, {})
    assert [c[0] for c in calls] == ["direct"] * 3
    assert len(tried) == 3


def test_second_profile_served_stops_there(monkeypatch):
    s, tried, calls = _run(monkeypatch, {("direct", "safari17_0"): 200}, proxy_url="http://p.test:1")
    assert tried == ["direct/chrome124:502", "direct/safari17_0:200"]
    assert s.impersonate == "safari17_0" and s.__dict__["_impersonate_profile"] == "direct/safari17_0"


def test_proxy_route_returned_when_only_proxy_serves(monkeypatch):
    s, tried, _ = _run(monkeypatch, {("proxy", "firefox133"): 200}, proxy_url="http://p.test:1")
    assert tried[-1] == "proxy/firefox133:200"
    assert s.proxies == {"http": "http://p.test:1", "https": "http://p.test:1"}


def test_transport_error_is_recorded_and_next_profile_tried(monkeypatch):
    _, tried, _ = _run(monkeypatch, {("direct", "chrome124"): TimeoutError("t"),
                                     ("direct", "safari17_0"): 200})
    assert tried == ["direct/chrome124:TimeoutError", "direct/safari17_0:200"]


@pytest.mark.parametrize("mod", ["sadin", "aqaralsaudia"])  # awal: its own rotation, #5005
def test_scraper_main_opens_with_retry_smarter_session(mod):
    """The three sources that were dormant on one pinned profile must use the probe."""
    import importlib
    import inspect
    m = importlib.import_module(f"scrapers.{mod}.run")
    assert m.retry_smarter_session is http.retry_smarter_session
    assert "retry_smarter_session(" in inspect.getsource(m.main)
