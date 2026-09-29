"""http.get() retries smarter on a BLOCK instead of giving up on the first 403.

aqar-sweep run 36360844470 (2026-09-28): all 95 city shards fetched 0 pages because get() was
pinned to chrome124 on the direct route and bailed on the first 403 without a log line. These
tests pin: other profiles are tried direct, the proxy leg runs only when the workflow opts in,
the working route is pinned for the host, a 404 is never escaped, one stray 403 on a healthy host
does not end the run, and a host that is blocked everywhere fails fast after EXHAUST_AFTER escapes.
"""
from __future__ import annotations

import pytest

from scrapers.common import http

URL = "https://sa.aqar.fm/x"


class _Resp:
    def __init__(self, status: int):
        self.status_code = status
        self.text = ""


def _install(monkeypatch, outcome, proxy_url=""):
    """outcome(route, profile, url) -> status int or Exception instance."""
    calls: list = []

    class _S:
        def __init__(self, impersonate=None, proxies=None):
            self.impersonate = impersonate
            self.proxies = proxies
            self.headers: dict = {}

        def get(self, url, timeout=None, allow_redirects=True, proxies=None):
            route = "proxy" if (self.proxies or proxies) else "direct"
            calls.append((route, self.impersonate, url))
            out = outcome(route, self.impersonate, url)
            if isinstance(out, Exception):
                raise out
            return _Resp(out)

    monkeypatch.setattr(http.cc, "Session", _S)
    monkeypatch.setattr(http, "_throttle", lambda url: None)
    monkeypatch.setattr(http.time, "sleep", lambda s: None)
    for name, val in (("_host_route", {}), ("_host_exhausted", set()), ("_escape_failures", {}),
                      ("_escape_locks", {})):
        monkeypatch.setattr(http, name, val)
    monkeypatch.setattr(http, "_local", http.threading.local())
    if proxy_url:
        monkeypatch.setenv("SCRAPE_PROXY_FALLBACK_URL", proxy_url)
    else:
        monkeypatch.delenv("SCRAPE_PROXY_FALLBACK_URL", raising=False)
    return calls


def test_403_on_chrome124_escapes_to_another_profile_and_pins_it(monkeypatch):
    calls = _install(monkeypatch, lambda r, p, u: 200 if p == "firefox133" else 403)
    assert http.get(URL).status_code == 200
    assert calls[0][:2] == ("direct", "chrome124")
    assert ("direct", "firefox133") in [c[:2] for c in calls]
    assert not any(c[0] == "proxy" for c in calls)
    n = len(calls)
    assert http.get(URL + "2").status_code == 200
    assert [c[:2] for c in calls[n:]] == [("direct", "firefox133")]   # pinned: one request, no re-probe


def test_proxy_leg_only_when_workflow_opts_in(monkeypatch):
    outcome = lambda r, p, u: 200 if r == "proxy" else 403
    calls = _install(monkeypatch, outcome)
    assert http.get(URL) is None
    assert not any(c[0] == "proxy" for c in calls)

    calls = _install(monkeypatch, outcome, proxy_url="http://p.test:1")
    assert http.get(URL).status_code == 200
    assert calls[-1][:2] == ("proxy", "chrome124")


def test_refused_connection_is_escaped_too(monkeypatch):
    calls = _install(monkeypatch, lambda r, p, u: ConnectionResetError("reset") if p == "chrome124" else 200)
    assert http.get(URL).status_code == 200


def test_404_is_never_escaped(monkeypatch):
    calls = _install(monkeypatch, lambda r, p, u: 404, proxy_url="http://p.test:1")
    assert http.get(URL) is None
    assert len(calls) == 1


def test_one_stray_403_on_a_healthy_host_does_not_end_the_run(monkeypatch):
    calls = _install(monkeypatch, lambda r, p, u: 403 if u.endswith("/gone") else 200)
    assert http.get(URL).status_code == 200
    assert http.get("https://sa.aqar.fm/gone") is None
    assert http.get(URL).status_code == 200
    assert "sa.aqar.fm" not in http._host_exhausted


def test_blocked_everywhere_fails_fast_after_exhaust_after(monkeypatch):
    calls = _install(monkeypatch, lambda r, p, u: 403, proxy_url="http://p.test:1")
    for i in range(http.EXHAUST_AFTER):
        assert http.get(f"{URL}{i}") is None
    assert "sa.aqar.fm" in http._host_exhausted
    n = len(calls)
    assert http.get(URL + "z") is None
    assert len(calls) - n == 1   # only the normal first attempt; no escape probes after exhaustion


def test_wasalt_explicit_proxy_path_is_untouched(monkeypatch):
    monkeypatch.setenv("WASALT_PROXY_URL", "http://w.test:1")
    calls = _install(monkeypatch, lambda r, p, u: 403, proxy_url="http://p.test:1")
    assert http.get("https://wasalt.sa/x") is None
    assert len(calls) == 1


def test_a_kept_404_is_returned_as_the_answer_not_collapsed_to_none(monkeypatch):
    """Liveness passes keep=(404, 410): for it a 404 IS the answer. Without keep, None (unchanged)."""
    _install(monkeypatch, lambda r, p, u: 404)
    assert http.get(URL) is None
    assert http.get(URL, keep=(404, 410)).status_code == 404
    _install(monkeypatch, lambda r, p, u: 403)
    assert http.get(URL, keep=(404, 410)) is None      # a block is never kept: still no answer
