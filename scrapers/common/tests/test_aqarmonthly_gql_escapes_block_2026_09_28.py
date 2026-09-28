"""aqarmonthly-sync run 36384691494 (2026-09-28): all 16 shards discovered 0 ids.

_gql was pinned to chrome124 DIRECT and swallowed every failure, so a site-wide aqar block (the one
that took aqar-sweep to 0 pages the same day) ended the crawl with no escape and no reason logged.
_gql must now walk the other profiles, then the residential proxy when the workflow opts in, pin the
leg that answers JSON, and still fail fast (None, False) when every route is refused.
"""
from __future__ import annotations

import importlib

import pytest

m = importlib.import_module("scrapers.aqarmonthly.run")


class _Resp:
    def __init__(self, status, payload):
        self.status_code, self._p = status, payload

    def json(self):
        if isinstance(self._p, Exception):
            raise self._p
        return self._p


def _install(monkeypatch, served):
    """served(profile, via_proxy) -> _Resp. Records every (profile, via_proxy) posted to."""
    calls: list = []

    class FakeSession:
        def __init__(self, impersonate=None, proxies=None):
            self.leg = (impersonate, proxies is not None)
            self.headers = {}

        def post(self, url, json=None, timeout=None):
            calls.append(self.leg)
            return served(*self.leg)

    monkeypatch.setattr(m.cc, "Session", FakeSession)
    monkeypatch.setattr(m, "_throttle", lambda: None)
    monkeypatch.setattr(m.time, "sleep", lambda s: None)
    monkeypatch.setattr(m, "_route", [("chrome124", False)])
    monkeypatch.setattr(m, "_escape", {"failures": 0, "exhausted": False})
    monkeypatch.setattr(m, "_local", m.threading.local())
    return calls


BLOCK = _Resp(403, ValueError("<html>403 Forbidden</html>"))
OK = _Resp(200, {"data": {"Search": {"find": {"total": 1, "listings": [{"id": 7}]}}}})


def test_direct_block_escapes_through_the_proxy_and_pins_it(monkeypatch):
    monkeypatch.setenv("SCRAPE_PROXY_FALLBACK_URL", "http://p.test:1")
    calls = _install(monkeypatch, lambda prof, proxy: OK if (proxy and prof == "safari17_0") else BLOCK)
    data, errored = m._gql(m.FIND_Q, {})
    assert data == OK._p["data"] and errored is False
    assert m._route[0] == ("safari17_0", True)
    n = len(calls)
    assert m._gql(m.FIND_Q, {})[0] == OK._p["data"]
    assert calls[n:] == [("safari17_0", True)]        # pinned: one request, no re-probe


def test_every_route_blocked_returns_none_then_fails_fast(monkeypatch):
    monkeypatch.setenv("SCRAPE_PROXY_FALLBACK_URL", "http://p.test:1")
    calls = _install(monkeypatch, lambda prof, proxy: BLOCK)
    for _ in range(m.EXHAUST_AFTER):
        assert m._gql(m.FIND_Q, {}) == (None, False)
    assert m._escape["exhausted"] is True
    n = len(calls)
    assert m._gql(m.FIND_Q, {}) == (None, False)
    assert len(calls) == n                              # no probe storm on a real ban


def test_proxy_is_never_used_unless_the_workflow_opts_in(monkeypatch):
    monkeypatch.delenv("SCRAPE_PROXY_FALLBACK_URL", raising=False)
    calls = _install(monkeypatch, lambda prof, proxy: OK if proxy else BLOCK)
    assert m._gql(m.FIND_Q, {}) == (None, False)
    assert all(not proxy for _, proxy in calls)


def test_graphql_business_error_is_not_escaped(monkeypatch):
    err = _Resp(200, {"data": {"Listing": {"get": {"id": 7}}}, "errors": [{"message": "reserved"}]})
    calls = _install(monkeypatch, lambda prof, proxy: err)
    data, errored = m._gql(m.DETAIL_Q, {})
    assert errored is True and data == {"Listing": {"get": {"id": 7}}}
    assert calls == [("chrome124", False)]


def test_workflow_opts_in_to_the_proxy_fallback():
    from pathlib import Path
    wf = (Path(m.__file__).resolve().parents[2] / ".github/workflows/aqarmonthly-sync.yml").read_text()
    assert "SCRAPE_PROXY_FALLBACK_URL: ${{ secrets.WASALT_PROXY_URL }}" in wf
