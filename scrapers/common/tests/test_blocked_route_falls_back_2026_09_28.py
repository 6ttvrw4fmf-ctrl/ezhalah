"""2026-09-28 small-sources-sync failures: a walled route or a short 5xx burst must not end a crawl.

- ialqarawi: every profile DIRECT drew an empty HTTP 202 challenge; session() must then try the
  residential proxy (WASALT_PROXY_URL) instead of raising.
- ryadah: the WP REST list 403'd the pinned chrome profile; main() must probe profiles + proxy via
  retry_smarter_session() and fetch() must not override the served session's profile per request.
- dwelleo: the catalogue API threw HTTP 500 on one page for ~9 s and the 3-try retry gave up; a
  catalogue page now gets 6 tries, and a page still failing after them still raises.
"""
from __future__ import annotations

import importlib
import inspect

import pytest

from scrapers.common import http


def test_ialqarawi_session_falls_back_to_proxy_when_direct_is_walled(monkeypatch):
    m = importlib.import_module("scrapers.ialqarawi.run")
    calls: list = []

    def fake(url, *, proxies=None, **kw):
        calls.append(proxies)
        if proxies is None:
            raise RuntimeError("no TLS profile was served (last safari15_5:HTTP 202)")
        return "PROXY_SESSION"

    monkeypatch.setattr(m.http, "negotiated_session", fake)
    monkeypatch.setenv("WASALT_PROXY_URL", "http://p.test:1")
    assert m.session() == "PROXY_SESSION"
    assert calls == [None, {"http": "http://p.test:1", "https": "http://p.test:1"}]


def test_ialqarawi_session_without_proxy_raises_the_direct_failure(monkeypatch):
    m = importlib.import_module("scrapers.ialqarawi.run")

    def fake(url, *, proxies=None, **kw):
        raise RuntimeError("direct walled")

    monkeypatch.setattr(m.http, "negotiated_session", fake)
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)
    with pytest.raises(RuntimeError, match="direct walled"):
        m.session()


def test_ialqarawi_both_routes_walled_names_both(monkeypatch):
    m = importlib.import_module("scrapers.ialqarawi.run")

    def fake(url, *, proxies=None, **kw):
        raise RuntimeError("proxy walled" if proxies else "direct walled")

    monkeypatch.setattr(m.http, "negotiated_session", fake)
    monkeypatch.setenv("WASALT_PROXY_URL", "http://p.test:1")
    with pytest.raises(RuntimeError, match="direct walled .*via proxy: proxy walled"):
        m.session()


def test_ryadah_main_probes_profiles_and_proxy():
    m = importlib.import_module("scrapers.ryadah.run")
    assert m.retry_smarter_session is http.retry_smarter_session
    assert "retry_smarter_session(" in inspect.getsource(m.main)


def test_ryadah_fetch_keeps_the_negotiated_profile(monkeypatch):
    m = importlib.import_module("scrapers.ryadah.run")
    seen: list = []

    class _R:
        status_code = 200

    class _S:
        def get(self, url, **kw):
            seen.append(kw)
            return _R()

    m.fetch(_S(), "https://ryadah.com.sa/x")
    assert "impersonate" not in seen[0]


class _Resp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._p = payload

    def json(self):
        return self._p


def _dwelleo_walk(monkeypatch, fails_on_page_2: int):
    m = importlib.import_module("scrapers.dwelleo.run")
    monkeypatch.setattr(m.time, "sleep", lambda *_: None)
    left = {"n": fails_on_page_2}

    class _S:
        def get(self, url, params=None, timeout=None):
            page = params["page"]
            if page == 2 and left["n"] > 0:
                left["n"] -= 1
                return _Resp(500)
            return _Resp(200, {"data": {"pagination": {"total": 2, "total_pages": 2},
                                        "properties": [{"id": page}]}})
    return m.fetch_catalogue(_S())


def test_dwelleo_catalogue_survives_a_five_try_500_burst(monkeypatch):
    items, total, complete = _dwelleo_walk(monkeypatch, 5)
    assert sorted(items) == [1, 2] and total == 2 and complete


def test_dwelleo_page_failing_past_its_retries_is_read_again_at_the_end(monkeypatch):
    # 6 failures exhaust the first read of page 2; the second-chance read then gets it
    items, total, complete = _dwelleo_walk(monkeypatch, 6)
    assert sorted(items) == [1, 2] and complete


def test_dwelleo_page_that_never_answers_keeps_the_rest_but_is_incomplete(monkeypatch):
    # one HTTP 500 page used to throw the whole crawl away (4 nights in a row, 2026-09-29…10-02)
    items, total, complete = _dwelleo_walk(monkeypatch, 99)
    assert sorted(items) == [1] and complete is False


def test_dwelleo_first_page_failing_still_raises(monkeypatch):
    m = importlib.import_module("scrapers.dwelleo.run")
    monkeypatch.setattr(m.time, "sleep", lambda *_: None)

    class _Down:
        def get(self, url, params=None, timeout=None):
            return _Resp(500)
    with pytest.raises(RuntimeError, match="catalogue page 1 answered HTTP 500"):
        m.fetch_catalogue(_Down())
