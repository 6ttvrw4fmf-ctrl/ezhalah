"""OWNER ORDER 2026-11-12 (backlog 1828): a real browser re-checks a site before any «down» verdict.

fahadalshahri, 11-10 → 11-12: our curl_cffi sessions read HTTP 403 and the site was paged P0
silent_scraper_death, while a real browser passed its automatic «Checking your browser … Just a moment»
page in seconds and read all 26 products. The shared http.get() escape now ends with a browser leg:
  (a) the browser reads the page → served from the browser, host pinned to it for the run;
  (b) the browser fails too      → the old failure (None) stands;
  (c) a CAPTCHA                  → STOP: never solved, host walled for the run, owner line logged.
"""
from __future__ import annotations

import pytest

import scrapers.common.browser_recheck as BR
import scrapers.common.http as http

CF_AUTO = "<html><title>Just a moment...</title>Checking your browser before accessing</html>"
TURNSTILE = '<html><div class="cf-turnstile" data-sitekey="x"></div></html>'


@pytest.fixture
def fresh(monkeypatch):
    monkeypatch.setenv("SCRAPE_BROWSER_RECHECK", "1")
    for d in (http._host_route, http._escape_failures):
        d.clear()
    http._host_exhausted.clear()
    BR.walled_hosts.clear()
    BR.log.clear()
    monkeypatch.setattr(BR, "_pace", lambda host: None)
    monkeypatch.setattr(http, "_throttle", lambda url: None)
    monkeypatch.setattr(http.time, "sleep", lambda s: None)


class _R:
    def __init__(self, code, text=""):
        self.status_code, self.text = code, text


def _curl_always(monkeypatch, code, text=""):
    class S:
        def get(self, *a, **k):
            return _R(code, text)
    monkeypatch.setattr(http, "session", lambda: S())
    monkeypatch.setattr(http, "_route_session", lambda *a, **k: S())
    monkeypatch.setattr(http, "_rotate_session", lambda: S())


def _browser(monkeypatch, status, body, verdict=None):
    calls = []

    def page_fetch(url, wait_s):
        calls.append(url)
        return status, body, {"content-type": "application/json"}, verdict or BR.classify(status, body)
    monkeypatch.setattr(BR, "_page_fetch", page_fetch)
    return calls


def test_classify():
    assert BR.classify(403, CF_AUTO) == "challenge"
    assert BR.classify(200, TURNSTILE) == "captcha"
    assert BR.classify(200, '{"x": 1}') == "ok"
    assert BR.classify(503, "Service Unavailable") == "failed"


def test_a_403_the_browser_reads_is_served_and_pinned(fresh, monkeypatch):
    _curl_always(monkeypatch, 403, CF_AUTO)
    calls = _browser(monkeypatch, 200, '[{"id": 1}]')
    r = http.get("https://shop.test/wp-json/wc/store/products")
    assert r is not None and r.status_code == 200 and r.json() == [{"id": 1}] and r.via == "browser"
    assert http._host_route["shop.test"] == http.BROWSER_ROUTE
    r2 = http.get("https://shop.test/wp-json/wc/store/products?page=2")   # pinned: straight to the browser
    assert r2 is not None and len(calls) == 2
    assert "browser re-check shop.test: ok" in BR.summary()


def test_the_browser_failing_too_keeps_the_failure(fresh, monkeypatch):
    _curl_always(monkeypatch, 403, "Forbidden")
    _browser(monkeypatch, 503, "origin down")
    assert http.get("https://down.test/x") is None
    assert "shop.test" not in http._host_route and "browser re-check down.test: failed" in BR.summary()


def test_a_captcha_stops_and_is_never_asked_again(fresh, monkeypatch):
    _curl_always(monkeypatch, 403, TURNSTILE)
    calls = _browser(monkeypatch, None, TURNSTILE, "captcha")
    assert http.get("https://walled.test/x") is None
    assert "walled.test" in BR.walled_hosts and "walled.test" in http._host_exhausted
    assert "never solved or bypassed" in BR.summary()
    assert http.get("https://walled.test/y") is None and len(calls) == 1


def test_a_503_challenge_page_is_a_wall_not_a_hiccup(fresh, monkeypatch):
    _curl_always(monkeypatch, 503, CF_AUTO)
    calls = _browser(monkeypatch, 200, "<html>ads</html>")
    r = http.get("https://cf.test/list")
    assert r is not None and r.via == "browser" and len(calls) == 1


def test_off_switch(fresh, monkeypatch):
    monkeypatch.setenv("SCRAPE_BROWSER_RECHECK", "0")
    _curl_always(monkeypatch, 403, CF_AUTO)
    calls = _browser(monkeypatch, 200, "ok")
    assert http.get("https://off.test/x") is None and calls == []


def test_a_healthy_host_never_opens_the_browser(fresh, monkeypatch):
    _curl_always(monkeypatch, 200, "fine")
    calls = _browser(monkeypatch, 200, "ok")
    assert http.get("https://fine.test/x").text == "fine" and calls == []


def test_no_chromium_means_unavailable_not_a_crash(fresh, monkeypatch):
    def boom(url, wait_s):
        raise RuntimeError("Executable doesn't exist")
    monkeypatch.setattr(BR, "_page_fetch", boom)
    r, verdict = BR.recheck("https://x.test/a", reason="HTTP 403")
    assert r is None and verdict == "unavailable"


def test_the_identity_is_honest():
    assert "EzhalahBot" in BR.HONEST_UA and "ezhalah.com" in BR.HONEST_UA
    assert BR.MIN_INTERVAL_S >= 1.0 and BR.WAIT_S <= 20


def test_on_by_default_in_a_crawl_off_by_default_in_unit_tests(monkeypatch):
    monkeypatch.delenv("SCRAPE_BROWSER_RECHECK", raising=False)
    assert BR.enabled() is False                       # PYTEST_CURRENT_TEST is set right now
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    assert BR.enabled() is True                        # a real crawl: on


# ── therc: the 11-13 16:55 UTC crawl read «sitemap.xml answered HTTP 403 after 5 tries» on every route ──
import scrapers.therc.run as THERC  # noqa: E402

_XML = "<urlset><url><loc>https://therc.aqar.digital/properties/villa-1</loc></url></urlset>"


class _S:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), 0

    def get(self, url, **k):
        self.calls += 1
        return self.answers.pop(0)


def test_therc_403_sitemap_goes_through_the_shared_escape(monkeypatch):
    monkeypatch.setattr(THERC.time, "sleep", lambda s: None)
    asked = []
    monkeypatch.setattr(THERC.http_shared, "get",
                        lambda url, **k: asked.append(url) or BR.BrowserResponse(url, 200, _XML))
    out = THERC.sitemap_urls(_S([_R(403, CF_AUTO)] * 5))
    assert out == [("https://therc.aqar.digital/properties/villa-1", None)] and asked == [THERC.SITEMAP]


def test_therc_plain_503_never_opens_the_escape(monkeypatch):
    monkeypatch.setattr(THERC.time, "sleep", lambda s: None)
    monkeypatch.setattr(THERC.http_shared, "get", lambda url, **k: pytest.fail("escape on a plain 503"))
    with pytest.raises(RuntimeError, match="HTTP 503 after 5 tries"):
        THERC.sitemap_urls(_S([_R(503, "down")] * 5))


def test_therc_escape_refused_too_names_it(monkeypatch):
    monkeypatch.setattr(THERC.time, "sleep", lambda s: None)
    monkeypatch.setattr(THERC.http_shared, "get", lambda url, **k: None)
    BR.log.clear()
    with pytest.raises(RuntimeError, match=r"HTTP 403 after 5 tries .*refused too"):
        THERC.sitemap_urls(_S([_R(403, "Forbidden")] * 5))
