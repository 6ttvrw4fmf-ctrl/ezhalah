"""عقار نجران: the listing photo is the WordPress FEATURED image, not an <img> in the post body.

Measured 2026-10-07: 0 of 39 active rows carried a photo while every re-read page (source-reread
37577198963, 4/4) shows og:image and three JSON-LD images. These execute photos() and
attach_featured_photos() on stub posts / a stub session.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqarnajran import run as R  # noqa: E402

UP = "https://aqarnajran.com/wp-content/uploads/2025/11/"


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._b = status, body

    def json(self):
        return self._b


class _Stub:
    def __init__(self, by_id):
        self.by_id, self.urls = by_id, []

    def get(self, url, params=None, timeout=None):
        self.urls.append(url)
        mid = int(url.rstrip("/").rsplit("/", 1)[1])
        hit = self.by_id.get(mid)
        if isinstance(hit, Exception):
            raise hit
        return _Resp(200, {"source_url": hit}) if hit else _Resp(404, {"code": "rest_post_invalid_id"})


def test_a_post_whose_only_photo_is_featured_gets_it():
    post = {"content": {"rendered": "<p>مستودع للإيجار</p>"}, "featured_media": 77}
    assert R.attach_featured_photos(_Stub({77: UP + "warehouse.jpg"}), [post]) == 1
    assert R.photos(post) == [UP + "warehouse.jpg"]


def test_featured_comes_first_and_body_images_follow_without_duplicates():
    body = f'<img src="{UP}a.jpg"><img src="{UP}warehouse.jpg"><img src="{UP}a-300x200.jpg">'
    post = {"content": {"rendered": body}, "_featured_photo": UP + "warehouse.jpg"}
    assert R.photos(post) == [UP + "warehouse.jpg", UP + "a.jpg"]


def test_no_featured_media_reads_nothing_and_stays_none():
    post = {"content": {"rendered": ""}, "featured_media": 0}
    stub = _Stub({})
    assert R.attach_featured_photos(stub, [post]) == 0 and stub.urls == []
    assert R.photos(post) is None


def test_a_failed_or_missing_media_read_is_absent_not_a_guess():
    a = {"content": {"rendered": ""}, "featured_media": 5}
    b = {"content": {"rendered": ""}, "featured_media": 6}
    assert R.attach_featured_photos(_Stub({5: TimeoutError("stall")}), [a, b]) == 0
    assert R.photos(a) is None and R.photos(b) is None


def test_the_site_logo_is_never_a_photo():
    post = {"content": {"rendered": ""}, "featured_media": 9}
    R.attach_featured_photos(_Stub({9: UP + "aqarnajran-logo.png"}), [post])
    assert R.photos(post) is None


def test_the_walk_asks_for_featured_media():
    assert "featured_media" in Path(R.__file__).read_text(encoding="utf-8").split("def fetch_posts")[1]
