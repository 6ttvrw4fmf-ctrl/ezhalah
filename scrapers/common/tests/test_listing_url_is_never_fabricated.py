"""A card's link must go where the source actually serves the listing (fix/wslnaa-listing-url-
literal-none, 2026-09-20).

Incident: wslnaa's tRPC payload omits `slug` for its six building-level combination offers
("الجزء السكني بالكامل — 8 شقق وقبو", "3 فتحات تجارية متجاورة", …, numeric slugs 540001 /
570001-570005). `listing_url` is an f-string over `p["slug"]`, so the missing key rendered the
LITERAL text "None": six live cards linked to https://wslnaa.com/properties/None, which the site
answers with «العقار غير موجود». A 200 from the site is no defence — the SPA returns 200 for its
own not-found view — and nothing in the fleet asserted the link was real, so this shipped and was
only caught by clicking every one of the 169 live links by hand.

Both halves are locked here, and both EXECUTE production code rather than a copy of it:
  1. `db._reject_unusable_listing_url` — the tripwire at the one point every batch write
     converges — raises on a URL ending in a language literal, for EVERY platform, not just this
     one. It must not fire on the real URLs already in production (including the Arabic-slug and
     percent-encoded ones), or it would block good rows.
  2. wslnaa's `fetch_one` must carry the slug it ASKED for into the payload. The sitemap slug is
     authoritative — the page serves fine at it — so the response echoing it back is optional.
     Asserted by running the real function against a stubbed transport, so deleting the fallback
     fails here instead of in production.

Run: python -m pytest scrapers/common/tests/test_listing_url_is_never_fabricated.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scrapers.common import db  # noqa: E402


# ---------------------------------------------------------------- 1. the fleet-wide tripwire
FABRICATED = [
    "https://wslnaa.com/properties/None",          # the exact URL that shipped
    "https://wslnaa.com/properties/None/",
    "https://example.com/property/null",
    "https://example.com/ad/undefined",
    "https://example.com/p/NaN",
    "https://example.com/detail?id=None",
]

# Real listing_url values live in production right now — the guard must stay silent on all of
# them. The Arabic and percent-encoded ones are the interesting cases: a sloppier pattern that
# matched "None" anywhere, or tripped on non-ASCII, would deactivate real inventory.
REAL = [
    "https://wslnaa.com/properties/540001",
    "https://wslnaa.com/properties/nada-avenue-apartment-11",
    "https://wslnaa.com/properties/معرض-للايجار-السنوي-طويق-رغد-أفنيو-90001",
    "https://compoundin.com/rent/show/663bbfd93626c/the-residence-olaya",
    "https://safera.inblaj.net/property/%d9%81%d9%8a%d9%84%d8%a7-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9/",
    "https://aqarnajran.com/%d8%a8%d9%8a%d8%aa-%d9%84%d9%84%d8%a8%d9%8a%d8%b9/",
    "https://sa.aqar.fm/12345",
    # a slug that merely CONTAINS the word is legitimate — only a trailing literal is the bug
    "https://example.com/properties/None-of-the-above-villa",
    "https://example.com/properties/nulls-farm",
]


@pytest.mark.parametrize("url", FABRICATED)
def test_fabricated_url_is_refused(url: str) -> None:
    with pytest.raises(ValueError, match="fabricated listing_url"):
        db._reject_unusable_listing_url(
            {"ad_number": "WS1", "listing_url": url}, table="wslnaa_commercial_listings")


@pytest.mark.parametrize("url", REAL)
def test_real_url_passes(url: str) -> None:
    db._reject_unusable_listing_url(
        {"ad_number": "WS1", "listing_url": url}, table="wslnaa_commercial_listings")


def test_guard_runs_inside_the_shared_batch_writer() -> None:
    """The guard is worthless if it is defined but never called. Assert it sits in the call chain
    of `_wasalt_batch` — the one function every new platform's upsert_* helper delegates to."""
    import inspect
    assert "_reject_unusable_listing_url" in inspect.getsource(db._wasalt_batch)


# ---------------------------------------------------------------- 2. wslnaa carries its slug
class _StubResponse:
    status_code = 200

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def json(self) -> list:
        return [{"result": {"data": {"json": self._payload}}}]


class _StubSession:
    """Stands in for the network only. `fetch_one` itself is the real production function."""

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def get(self, *_a, **_k) -> _StubResponse:
        return _StubResponse(self._payload)


def _wslnaa():
    from scrapers.wslnaa import run as wslnaa_run
    return wslnaa_run


def test_missing_slug_falls_back_to_the_requested_one() -> None:
    """The six combination offers: payload has a title and a price but no `slug`."""
    w = _wslnaa()
    payload = {"title": "الجزء السكني بالكامل — 8 شقق وقبو (2,364 م² تقريباً)",
               "status": "available", "mode": "rent"}
    got = w.fetch_one(_StubSession(payload), "570005")
    assert got["slug"] == "570005", "the sitemap slug must survive an API response that omits it"
    assert "None" not in f"{w.BASE}/properties/{got['slug']}"


def test_present_slug_is_not_overwritten() -> None:
    """A response that DOES carry its own slug stays source-truth — the fallback fills a gap,
    it never overrules the source (`derived-never-overrules-source`)."""
    w = _wslnaa()
    got = w.fetch_one(_StubSession({"slug": "nada-avenue-apartment-11", "title": "شقة"}),
                      "some-other-slug")
    assert got["slug"] == "nada-avenue-apartment-11"
