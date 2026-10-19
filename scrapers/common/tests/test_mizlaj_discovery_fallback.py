"""mizlaj discovery: an OFFICE is not a listing, and a dead map-data is not an empty source.

On 2026-09-18 mizlaj reported `0-row run (blocked/empty source?)` for 39 hours while its own site
published 30 listings. Nothing was blocked and nothing was empty:

  GET /api/guest/listings/map-data  ->  200, {"layer": "offices", "total": 9, ...}

The endpoint had switched to the OFFICES layer — real-estate agencies, not properties. Each office
carries a `slug` ("office-5") shaped exactly like a listing slug, so the scraper looped over them,
fetched /guest/listings/office-5 thirty times, got a 404 every time, skipped every record and
recorded a clean zero. Every layer above it read that as "the source has nothing".

Two independent defects, so two guards, both pinned here:

  1. a payload that is not the listings layer is NOT discovery — it must not be iterated
  2. a failed discovery must not be reported as an empty source while the sitemap still lists 30

The detail parser was never broken: /guest/listings/<slug> still serves the same Inertia
props.listing, and map_listing() treats the map-data record as an optional location fallback, so
{} is a valid record — which is what makes the sitemap a complete substitute for discovery alone.

Run: python -m pytest scrapers/common/tests/test_mizlaj_discovery_fallback.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.mizlaj.run import fetch_map_data, fetch_sitemap_slugs  # noqa: E402


class _Resp:
    def __init__(self, payload, status=200):
        self.status_code = status
        self._payload = payload
        self.text = payload if isinstance(payload, str) else json.dumps(payload)

    def json(self):
        if isinstance(self._payload, str):
            raise ValueError("not json")
        return self._payload


class _Session:
    """Answers whatever the test scripts it to, and records what was asked for."""

    def __init__(self, by_url):
        self._by_url = by_url
        self.asked = []

    def get(self, url, **kw):
        self.asked.append(url)
        for frag, resp in self._by_url.items():
            if frag in url:
                return resp
        return _Resp("", status=404)


# ── 1. the offices trap ──────────────────────────────────────────────────────────────────────────
OFFICES = {
    "layer": "offices",
    "mode": "points",
    "total": 9,
    "data": [{"id": 6, "slug": "office-5", "office_name": "شركة أملاك المدينة", "listing_count": 6}],
}


def test_the_offices_layer_is_not_discovery():
    # The exact live payload. Returning its `data` is what produced 30 404s and a silent zero.
    s = _Session({"map-data": _Resp(OFFICES)})
    assert fetch_map_data(s) == [], (
        "an offices payload must yield NO discovery rows — office slugs are not listing slugs, "
        "and iterating them 404s on every fetch while reporting a clean 0-row run"
    )


def test_an_office_slug_never_reaches_the_caller():
    rows = fetch_map_data(_Session({"map-data": _Resp(OFFICES)}))
    assert not any(r.get("slug") == "office-5" for r in rows)


def test_the_listings_layer_is_still_accepted():
    # The guard must reject the wrong layer WITHOUT breaking the healthy case.
    good = {"layer": "listings", "total": 2, "data": [{"slug": "villa-1"}, {"slug": "villa-2"}]}
    assert [r["slug"] for r in fetch_map_data(_Session({"map-data": _Resp(good)}))] == [
        "villa-1",
        "villa-2",
    ]


def test_a_payload_with_no_layer_field_is_still_trusted():
    # Older/other shapes carry no `layer`; the guard must not reject them by absence.
    legacy = {"total": 1, "data": [{"slug": "villa-9"}]}
    assert [r["slug"] for r in fetch_map_data(_Session({"map-data": _Resp(legacy)}))] == ["villa-9"]


# ── 2. the sitemap fallback ──────────────────────────────────────────────────────────────────────
SITEMAP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mizlaj.com.sa/home</loc></url>
  <url><loc>https://mizlaj.com.sa/guest/listings/fyla-fy-alnor-4vdznyiu</loc></url>
  <url><loc>https://mizlaj.com.sa/guest/listings/%D9%81%D9%8A%D9%84%D8%A7-%D9%84%D9%84%D8%A8%D9%8A%D8%B9</loc></url>
  <url><loc>https://mizlaj.com.sa/guest/listings/fyla-fy-alnor-4vdznyiu</loc></url>
  <url><loc>https://mizlaj.com.sa/community/topics/3</loc></url>
</urlset>"""


def test_sitemap_yields_listing_slugs_only():
    got = fetch_sitemap_slugs(_Session({"sitemap.xml": _Resp(SITEMAP_XML)}))
    assert "fyla-fy-alnor-4vdznyiu" in got
    assert not any("community" in g or "home" in g for g in got), "non-listing urls must be skipped"


def test_percent_encoded_arabic_slugs_are_decoded():
    # Most mizlaj slugs are Arabic and arrive percent-encoded; a raw slug 404s on the detail fetch.
    got = fetch_sitemap_slugs(_Session({"sitemap.xml": _Resp(SITEMAP_XML)}))
    assert "فيلا-للبيع" in got, f"expected the decoded Arabic slug, got {got}"


def test_duplicate_urls_are_collapsed():
    got = fetch_sitemap_slugs(_Session({"sitemap.xml": _Resp(SITEMAP_XML)}))
    assert len(got) == len(set(got)) == 2


def test_an_unreachable_sitemap_is_empty_not_an_exception():
    # It is a FALLBACK — it must degrade quietly, never mask the original failure with a crash.
    assert fetch_sitemap_slugs(_Session({})) == []
