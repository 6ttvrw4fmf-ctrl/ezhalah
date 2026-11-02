"""wslnaa 2026-10-29 04:59 (Actions job 123263442024): the nightly ended «sitemap returned no
/properties/ slugs» in 2 s and recorded nothing else, while the same sitemap listed 63 /properties/
URLs to another egress that day and the four previous nightlies each crawled 62. A refused or failed
sitemap is NOT an empty catalogue: the crawl now rides retry_smarter_session() (3 profiles DIRECT, then
the proxy when granted) and the ledger note says what the host answered.

Run: python -m pytest scrapers/common/tests/test_wslnaa_refused_sitemap_is_not_an_empty_site.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.wslnaa.run as W  # noqa: E402

SITEMAP = ("<urlset><url><loc>https://wslnaa.com/properties</loc></url>"
           "<url><loc>https://wslnaa.com/properties/a-1</loc></url>"
           "<url><loc>https://wslnaa.com/buildings/1</loc></url>"
           "<url><loc>https://wslnaa.com/properties/570001</loc></url></urlset>")


class _Resp:
    def __init__(self, status: int, text: str) -> None:
        self.status_code, self.text = status, text


class _Sess:
    def __init__(self, status: int, text: str) -> None:
        self.status, self.text = status, text

    def get(self, url, timeout=0, **_kw):
        return _Resp(self.status, self.text)


def test_a_refused_sitemap_says_what_the_host_answered():
    assert W.fetch_slugs(_Sess(403, "<html>Just a moment...</html>")) == []
    assert W.SITEMAP_TRACE and "HTTP 403" in W.SITEMAP_TRACE[0]


def test_a_served_sitemap_still_yields_only_property_slugs():
    assert W.fetch_slugs(_Sess(200, SITEMAP)) == ["570001", "a-1"]
    assert W.SITEMAP_TRACE == []


def test_a_200_without_property_locs_is_named_too():
    assert W.fetch_slugs(_Sess(200, "<urlset></urlset>")) == []
    assert "0 /properties/ locs" in W.SITEMAP_TRACE[0]


def test_the_crawl_session_probes_profiles_and_the_proxy(monkeypatch):
    seen = {}

    def fake(url, **kw):
        seen["url"], seen["headers"] = url, kw.get("headers")
        return _Sess(200, SITEMAP), ["direct/chrome124:403", "direct/safari17_0:200"]

    monkeypatch.setattr(W, "retry_smarter_session", fake)
    s, tried = W.crawl_session()
    assert seen["url"] == f"{W.BASE}/sitemap.xml"
    assert seen["headers"] == W.SESSION_HEADERS
    assert tried[-1].endswith(":200") and W.fetch_slugs(s) == ["570001", "a-1"]


def test_main_puts_the_attempt_log_in_the_failure(monkeypatch, capsys):
    monkeypatch.setattr(W, "retry_smarter_session",
                        lambda url, **kw: (_Sess(403, "denied"), ["direct/chrome124:403", "proxy/chrome124:403"]))
    monkeypatch.setattr(sys, "argv", ["run", "--dry-run"])
    assert W.main() == 1
    out = capsys.readouterr().out
    assert "no /properties/ slugs" in out and "HTTP 403" in out and "proxy/chrome124:403" in out
