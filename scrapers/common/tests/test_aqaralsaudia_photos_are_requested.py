"""منصة العروض العقارية (aqaralsaudia): the photo must actually be REQUESTED, not just parsed.

Found live 2026-09-14, against the owner's explicit "make sure we scrape the photo": all 16
aqaralsaudia listings had NULL photos, while every one of them publishes a real featured image —
`featured_media` on every post, resolving to a 594KB JPEG that answers 200 image/jpeg.

`_photos()` was correct the whole time. `fetch_all` was not: it asked for `?_embed=wp:term`, and
WordPress only populates `_embedded[<relation>]` for relations the `_embed` parameter NAMES. So
`_embedded` arrived carrying `wp:term` and nothing else, `_photos()` looked for `wp:featuredmedia`,
found nothing, and returned [] on every listing — silently, because an absent photo is a legitimate
source fact elsewhere in the fleet and nothing could tell the two apart.

WHY THIS TEST EXECUTES RATHER THAN GREPS. A source-text assertion ("the URL contains
wp:featuredmedia") would pass while the parse was broken, and this repo has been bitten by exactly
that (A COMMENT IS NOT A CODE PATH). Instead the stub session honours WordPress's real contract — it
embeds a relation ONLY if the request asked for it — so the request and the parse are pinned together
by one behavioural check: drop the relation from the URL and photos go empty, exactly as in prod.

Run: python -m pytest scrapers/common/tests/test_aqaralsaudia_photos_are_requested.py -v
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqaralsaudia import run  # noqa: E402

# Shapes copied from the live payload (probed 2026-09-14, post 9086).
FEATURED_URL = "https://aqaralsaudia.com/wp-content/uploads/2026/04/IMG_8475-1.jpeg"
GALLERY_FILE = "2026/04/IMG_8477.jpeg"
GALLERY_URL = f"https://aqaralsaudia.com/wp-content/uploads/{GALLERY_FILE}"


def _post() -> dict:
    return {
        "id": 9086,
        "link": "https://aqaralsaudia.com/property/dor-awl-alban/",
        "title": {"rendered": "دور اول فاخر بحي البيان شرق الرياض"},
        "property_meta": {"REAL_HOMES_property_images": [{"file": GALLERY_FILE}]},
    }


class _Resp:
    def __init__(self, payload, status=200, pages=1):
        self._payload, self.status_code = payload, status
        # The real endpoint paginates via this header; the scraper reads it to know when to stop.
        self.headers = {"X-WP-TotalPages": str(pages)}

    def json(self):
        return self._payload


class _WordPress:
    """Honours WP's real _embed contract: a relation appears in _embedded ONLY if asked for.

    This is the whole point of the test — it is what makes a wrong URL observable in the OUTPUT.
    """

    def __init__(self):
        self.urls: list[str] = []

    def get(self, url, timeout=None):
        self.urls.append(url)
        q = parse_qs(urlparse(url).query)
        if int(q.get("page", ["1"])[0]) > 1:
            return _Resp(None, status=400)          # WP answers 400 past the last page (1 page here)
        asked = {r.strip() for r in (q.get("_embed", [""])[0]).split(",") if r.strip()}
        post = _post()
        embedded = {}
        if "wp:term" in asked:
            embedded["wp:term"] = [[]]
        if "wp:featuredmedia" in asked:
            embedded["wp:featuredmedia"] = [{"id": 9080, "source_url": FEATURED_URL}]
        if embedded:
            post["_embedded"] = embedded
        return _Resp([post])


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch):
    monkeypatch.setattr(run, "_throttle", lambda *a, **k: None)
    monkeypatch.setattr(run.time, "sleep", lambda *a, **k: None)


def test_the_featured_photo_survives_a_real_fetch():
    # THE REGRESSION. Before the fix this returned [] — the source's photo never reached us.
    s = _WordPress()
    posts = run.fetch_all(s)
    assert len(posts) == 1, f"the stub should yield one post, got {posts!r}"
    photos = run._photos(posts[0])
    assert FEATURED_URL in photos, (
        "the source's featured image did not survive fetch_all → _photos. If _embed stopped naming "
        f"wp:featuredmedia, WordPress omits it and photos go silently empty. got {photos!r}")


def test_the_featured_photo_comes_FIRST_and_the_gallery_follows():
    # Order matters: the card shows photos[0], so the featured image must lead.
    photos = run._photos(run.fetch_all(_WordPress())[0])
    assert photos[0] == FEATURED_URL, f"featured image must lead the list, got {photos!r}"
    assert GALLERY_URL in photos, (
        "the theme's own gallery (REAL_HOMES_property_images) must also be collected; "
        f"got {photos!r}")


def test_dropping_the_relation_from_the_request_is_what_broke_it():
    # The anchor: this is the ONLY reason the bug was invisible. A post fetched without the
    # relation yields no featured photo, which is why a URL-only change caused a data outage.
    without = _WordPress().get(f"{run.REST}/properties?page=1&_embed=wp:term").json()[0]
    assert "wp:featuredmedia" not in (without.get("_embedded") or {}), (
        "WP must not embed a relation nobody asked for — otherwise the stub is more generous than "
        "the real endpoint and the test above proves nothing")
    assert FEATURED_URL not in run._photos(without), (
        "the stub must reproduce the defect when the relation is not requested — otherwise the "
        "test above passes vacuously and proves nothing")


def test_the_request_asks_for_both_relations_it_parses():
    # Belt to the braces above: whatever else changes, the one request the scraper makes must ask
    # for both relations whose data _photos()/_terms() go on to read.
    s = _WordPress()
    run.fetch_all(s)
    first = s.urls[0]
    asked = parse_qs(urlparse(first).query).get("_embed", [""])[0]
    assert "wp:featuredmedia" in asked, f"_embed must request wp:featuredmedia — got {first!r}"
    assert "wp:term" in asked, f"_embed must still request wp:term — got {first!r}"


def test_a_source_that_genuinely_has_no_photo_still_reports_none():
    # SOURCE IS TRUTH: the fix must not manufacture a photo where the source publishes none.
    bare = {"id": 1, "link": "https://aqaralsaudia.com/property/x/", "property_meta": {},
            "_embedded": {"wp:term": [[]]}}
    assert run._photos(bare) == [], "no photo at source must stay empty, never a placeholder"


def test_photo_urls_are_absolute_and_on_the_source_host():
    # A relative path would render as a broken image; a foreign host would be someone else's photo.
    for u in run._photos(run.fetch_all(_WordPress())[0]):
        assert re.match(r"^https://aqaralsaudia\.com/", u), f"not an absolute source-host URL: {u}"
