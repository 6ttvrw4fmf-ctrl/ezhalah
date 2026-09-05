"""Regression test for the 2026-09-05 eaqartabuk image-capture fix (scrapers/eaqartabuk/run.py).

Root cause (live-verified): the scraper only ever read the list API's single `featured_image`
field, so every multi-photo listing was truncated to exactly 1 photo (DB coverage was exactly
1 img/listing). RealHomes stores gallery slides as media ATTACHMENTS of the property post; the
standard /wp-json/wp/v2/media?parent={id} endpoint is open on this site and returns them all
(live post 10470: 7 attachments = its 7 on-page flexslider slides; parent=10272 → 0,
parent=6674 → 1 — binding is exact by construction, related-listings thumbs cannot leak in).

Pins: the parent={pid} binding, the media_type=='image' filter (video/file attachments out),
featured-first order with the gallery's own order preserved after it, dedupe of the featured
repeat, and the two degradation rules — gallery failure → featured-only, nothing at all →
imageless (never fabricate).

Run: python -m pytest scrapers/eaqartabuk/test_gallery_extraction.py -v
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# stub the scraper's DB module so importing run.py needs no credentials (sibling-test idiom)
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.eaqartabuk import run  # noqa: E402
from scrapers.eaqartabuk.run import _gallery, map_listing  # noqa: E402

CDN = "https://eaqartabuk.com/wp-content/uploads/2025/12"


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class _FakeSession:
    """Stands in for _session()'s curl_cffi session; records the params of every media call."""

    def __init__(self, status=200, body=None):
        self._resp = _Resp(status, body)
        self.calls: list[dict] = []

    def get(self, url, params=None, timeout=None):
        assert url == run.MEDIA
        self.calls.append(params or {})
        return self._resp


def _with_session(fake):
    run._local.s = fake  # _session() caches per-thread on run._local


def _item(pid=10470, featured=f"{CDN}/photo-1-1-1024x717.jpeg"):
    return {
        "id": pid, "title": "فيلا بحي الريان", "link": f"https://eaqartabuk.com/?p={pid}",
        "date": "2026-09-01", "meta": {}, "featured_image": featured, "excerpt": "",
    }


MP = {"usage": "residential", "operation": "sale", "status": "بيع", "city": "تبوك", "district": ""}


# ── _gallery: parent binding + media_type filter + order + logo guard ──────────────────────────
def test_gallery_binds_by_parent_and_excludes_non_images():
    fake = _FakeSession(body=[
        {"media_type": "image", "source_url": f"{CDN}/photo-1-1.jpeg"},
        {"media_type": "video", "source_url": f"{CDN}/tour.mp4"},        # video attachment → out
        {"media_type": "file", "source_url": f"{CDN}/deed.pdf"},         # file attachment → out
        {"media_type": "image", "source_url": f"{CDN}/site-logo.png"},   # _BAD_IMG guard → out
        {"media_type": "image", "source_url": f"{CDN}/photo-2-1.jpeg"},
        {"media_type": "image", "source_url": f"{CDN}/photo-3-1.jpeg"},
    ])
    _with_session(fake)
    urls = _gallery(10470)
    # attachment order preserved, non-images and logo filtered
    assert urls == [f"{CDN}/photo-1-1.jpeg", f"{CDN}/photo-2-1.jpeg", f"{CDN}/photo-3-1.jpeg"]
    # per-listing binding: the ONLY thing asked for is THIS post's attachments, in id order
    assert fake.calls == [{"parent": 10470, "per_page": 100, "orderby": "id", "order": "asc"}]


def test_gallery_wp_error_object_is_empty_not_a_crash():
    _with_session(_FakeSession(body={"code": "rest_forbidden"}))
    assert _gallery(1) == []


# ── map_listing: featured first, gallery order after, featured dupe removed ────────────────────
def test_featured_first_gallery_order_preserved_featured_deduped():
    gallery = [f"{CDN}/photo-1-1.jpeg",   # == featured after _full_img strips -WxH → dedupe
               f"{CDN}/photo-2-1.jpeg", f"{CDN}/photo-3-1.jpeg"]
    row, _ = map_listing(_item(), MP, None, gallery)
    assert row["photo_urls"] == [f"{CDN}/photo-1-1.jpeg",   # featured, full-res, still first
                                 f"{CDN}/photo-2-1.jpeg", f"{CDN}/photo-3-1.jpeg"]


def test_gallery_failure_degrades_to_featured_only():
    row, _ = map_listing(_item(), MP, None, [])
    assert row["photo_urls"] == [f"{CDN}/photo-1-1.jpeg"]


def test_no_featured_no_gallery_stays_imageless():
    row, _ = map_listing(_item(featured=None), MP, None, [])
    assert row["photo_urls"] == []


if __name__ == "__main__":
    test_gallery_binds_by_parent_and_excludes_non_images()
    test_gallery_wp_error_object_is_empty_not_a_crash()
    test_featured_first_gallery_order_preserved_featured_deduped()
    test_gallery_failure_degrades_to_featured_only()
    test_no_featured_no_gallery_stays_imageless()
    print("OK — eaqartabuk gallery-extraction regression tests pass")
