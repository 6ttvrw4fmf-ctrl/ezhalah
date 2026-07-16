"""Regression test for abeea's discovery path (2026-07-16 dark-source incident).

Guards the root cause of the 0-row runs of 2026-07-14 and 2026-07-16: abeea.com.sa switched SEO
plugins (Yoast → Rank Math) and the Yoast property sitemaps (property-sitemap1/2.xml) started
serving the themed 404 PAGE — HTTP 404 with a full HTML body. The old sitemap_urls() never
checked status_code, silently parsed the 404 HTML, found zero <loc> tags, and the run completed
"ok" with rows_seen=0 in ~1 second while 136 live rows sat untouched (only the prune circuit
breakers prevented data loss).

The fix makes the default WP REST property list (/wp-json/wp/v2/properties, rest_base confirmed
via /wp-json/wp/v2/types) the PRIMARY discovery path, keeps sitemaps as a fallback, and makes the
sitemap parser refuse non-200 responses.

Run: python -m pytest scrapers/common/tests/test_abeea_discovery.py -v
"""
from scrapers.abeea.run import _is_property_url, discover_urls, rest_urls, sitemap_urls

PROP = "https://abeea.com.sa/en/property/villa-for-rent-in-al-sadafah-district-al-khobar/"
PROP2 = "https://abeea.com.sa/en/property/apartment-for-rent-in-al-bahar-district-al-khobar/"
ARCHIVE_ROOT = "https://abeea.com.sa/en/property/"

# The real failure shape: HTTP 404 whose body is the themed WordPress 404 page. It even contains
# a <loc>-looking property URL (via embedded markup) — a status-blind parser would swallow it.
_404_PAGE = f"""<!doctype html><html><head>
<title>Page Not Found - Abeea Real Estate</title></head>
<body>Sorry! <loc>{PROP}</loc></body></html>"""

_SITEMAP_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://abeea.com.sa/en/</loc></url>
<url><loc>{ARCHIVE_ROOT}</loc></url>
<url><loc>{PROP}</loc></url>
<url><loc>{PROP2}</loc></url>
<url><loc>{PROP}</loc></url>
</urlset>"""


class _Resp:
    def __init__(self, status_code=200, text="", body=None):
        self.status_code = status_code
        self.text = text
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


class _Session:
    """Canned-response stand-in for cc.Session — url prefix → response (no network)."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, url, **kw):
        self.calls.append(url)
        for prefix, resp in self.routes.items():
            if url.startswith(prefix):
                return resp(url) if callable(resp) else resp
        return _Resp(status_code=404, text=_404_PAGE)


def test_is_property_url_keeps_details_drops_archive_root():
    assert _is_property_url(PROP) is True
    assert _is_property_url(ARCHIVE_ROOT) is False
    assert _is_property_url("https://abeea.com.sa/en/blog/") is False


def test_sitemap_urls_refuses_404_bodies():
    # The exact incident shape: every sitemap URL serves the themed 404 page. Zero URLs — and
    # crucially the <loc> inside the 404 HTML must NOT be harvested.
    s = _Session({"https://abeea.com.sa/": _Resp(status_code=404, text=_404_PAGE)})
    assert sitemap_urls(s) == []


def test_sitemap_urls_parses_healthy_sitemap_dedup_and_root_skip():
    s = _Session({
        "https://abeea.com.sa/sitemap.xml": _Resp(text=_SITEMAP_XML),
        # the dead Yoast pair keeps serving the 404 page (default route)
    })
    assert sitemap_urls(s) == [PROP, PROP2]


def test_rest_urls_paginates_and_stops_on_short_page():
    page1 = [{"link": f"https://abeea.com.sa/en/property/p{i}/"} for i in range(100)]
    page2 = [{"link": PROP}, {"link": ARCHIVE_ROOT}, {"link": None}]

    def rest(url):
        return _Resp(body=page2 if "page=2" in url else page1)

    s = _Session({"https://abeea.com.sa/wp-json/wp/v2/properties": rest})
    urls = rest_urls(s)
    assert len(urls) == 101  # 100 + PROP; archive root + null link dropped
    assert urls[-1] == PROP
    assert not any("page=3" in c for c in s.calls)  # short page 2 ended pagination


def test_discover_prefers_rest_over_sitemap():
    s = _Session({
        "https://abeea.com.sa/wp-json/wp/v2/properties": _Resp(body=[{"link": PROP}]),
        "https://abeea.com.sa/sitemap.xml": _Resp(text=_SITEMAP_XML),
    })
    assert discover_urls(s) == [PROP]
    assert not any("sitemap" in c for c in s.calls)


def test_discover_falls_back_to_sitemap_when_rest_dark():
    # REST 404s (e.g. site later disables the REST API) → static sitemap fallback still works.
    s = _Session({
        "https://abeea.com.sa/wp-json/wp/v2/properties": _Resp(status_code=404, text="nope"),
        "https://abeea.com.sa/sitemap.xml": _Resp(text=_SITEMAP_XML),
    })
    assert discover_urls(s) == [PROP, PROP2]


def test_discover_both_paths_dark_returns_empty_not_crash():
    # Total darkness (the 2026-07-16 state pre-fix, had REST not existed): empty list, no raise —
    # main() then records a 0-row run and RC-B demotes it; prune's 0-seen breaker keeps the data.
    s = _Session({})
    assert discover_urls(s) == []


if __name__ == "__main__":
    test_is_property_url_keeps_details_drops_archive_root()
    test_sitemap_urls_refuses_404_bodies()
    test_sitemap_urls_parses_healthy_sitemap_dedup_and_root_skip()
    test_rest_urls_paginates_and_stops_on_short_page()
    test_discover_prefers_rest_over_sitemap()
    test_discover_falls_back_to_sitemap_when_rest_dark()
    test_discover_both_paths_dark_returns_empty_not_crash()
    print("OK — abeea discovery regression tests pass")
