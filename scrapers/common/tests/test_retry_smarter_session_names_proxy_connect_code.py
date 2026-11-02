"""2026-10-20: the residential proxy answered «ProxyError» on every host since 10-19 21:00 UTC, and
the route log said only the exception type. The proxy's own CONNECT status (407 credential, 402
balance, 403 refused) is the one fact that tells the owner what to fix, so it goes into the log."""
from __future__ import annotations

import sys
import types

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import http as H  # noqa: E402


class ProxyError(Exception):
    pass


class _Refused:
    def __init__(self, *a, **k):
        self.headers = {}

    def get(self, url, timeout=0):
        raise ProxyError("Failed to perform, curl: (56) CONNECT tunnel failed, response 407. See https://curl.se/")


class _Timeout(_Refused):
    def get(self, url, timeout=0):
        raise TimeoutError("timed out")


def test_the_connect_status_reaches_the_route_log(monkeypatch):
    monkeypatch.setenv("WASALT_PROXY_URL", "http://user:pw@proxy.invalid:823")
    monkeypatch.setattr(H.cc, "Session", _Refused)
    _, tried = H.retry_smarter_session("https://example.invalid/", order=("chrome124",))
    assert tried == ["direct/chrome124:ProxyError(407)", "proxy/chrome124:ProxyError(407)"]


def test_an_error_without_a_connect_status_stays_the_bare_type(monkeypatch):
    monkeypatch.delenv("WASALT_PROXY_URL", raising=False)
    monkeypatch.setattr(H.cc, "Session", _Timeout)
    _, tried = H.retry_smarter_session("https://example.invalid/", order=("chrome124",))
    assert tried == ["direct/chrome124:TimeoutError"]
