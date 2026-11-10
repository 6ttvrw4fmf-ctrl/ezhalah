"""Rulebook «a down site must fail two checks»: when senan's API route answers nothing, the run names what
the HOMEPAGE answers and which /api/ routes its own scripts use (the site may have changed, not died —
maqam left the same Nuzul engine on 2026-11-07)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.senan import run as S  # noqa: E402


class _R:
    def __init__(self, status, text, url):
        self.status_code, self.text, self.url = status, text, url


class _Sess:
    def get(self, url, **_):
        if url.endswith(".js"):
            return _R(200, 'fetch("/api/public/listings?page="+n)', url)
        return _R(200, '<html><script src="/assets/index-abc.js"></script><title>سنان العقارية</title><a href="/api/v3/units">x</a><a href="/units/12">u</a></html>',
                  "https://www.senanrealestate.sa/")


def test_a_dead_route_reports_the_homepage_and_the_routes_it_names():
    out = S.site_changed_probe(_Sess())
    assert "homepage 200 at www.senanrealestate.sa" in out
    assert "/api/public/listings" in out and "/api/v3/units" in out
    assert "title='سنان العقارية'" in out and "('/units', 1)" in out


def test_the_probe_never_raises_on_a_network_error():
    class Bad:
        def get(self, *a, **k):
            raise ConnectionError("x")
    assert S.site_changed_probe(Bad()) == "homepage: ConnectionError"


def test_a_failed_script_read_is_counted_and_named():
    # CodeRabbit (PR #11247): a swallowed script error hid why a route list was empty.
    class Half(_Sess):
        def get(self, url, **kw):
            if url.endswith(".js"):
                return _R(500, "", url)
            return super().get(url, **kw)
    out = S.site_changed_probe(Half())
    assert "scripts failed=1" in out and "HTTP 500" in out
