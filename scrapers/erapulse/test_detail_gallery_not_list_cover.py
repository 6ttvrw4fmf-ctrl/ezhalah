"""erapulse photos must come from the DETAIL endpoint — the list truncates to the cover.

The defect this pins, found live 2026-09-05: the LIST endpoint returns `images` truncated to the
single main_* cover (61/63 list items had exactly 1 image), while DETAIL /properties/{id} carries
the full gallery (5 for REF-MSRYGJQV-RFQYH, cover first). The old docstring claimed detail adds
"nothing we store", so the scraper never fetched it and DB coverage sat at exactly 1 img/listing.

Also pinned here, because each one silently corrupts rather than crashes:
  · PDPL: the detail payload exposes contactName/contactPhone/contactEmail/whatsappNumber at TOP
    level — fetch_detail_images must read ONLY `images` out of it, ever.
  · Fallback: a failed/empty/garbage detail keeps the LIST cover — failure degrades to FEWER
    images, never a wrong one, and the cover is never lost.
  · A listing whose source publishes 0 images (REF-MKE6A0PT-VICBT, live) stays imageless.
"""
import inspect
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.erapulse import run as R  # noqa: E402


class _Resp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no body")
        return self._payload


class _Sess:
    """Stub session: returns a canned detail response, records the URL hit."""
    def __init__(self, resp):
        self.resp, self.urls = resp, []

    def get(self, url, **kw):
        self.urls.append(url)
        if isinstance(self.resp, Exception):
            raise self.resp
        return self.resp


GALLERY = [{"url": "/uploads/images/cuid1/main_cover.webp"},
           {"url": "/uploads/images/cuid1/room2.webp"},
           {"url": "/uploads/images/cuid1/room3.webp"}]
# Detail payload EXPOSES PII at top level, exactly like the live API — only `images` may be read.
DETAIL = {"success": True, "data": {"images": GALLERY, "contactName": "فلان الفلاني",
                                    "contactPhone": "0512345678", "whatsappNumber": "0512345678",
                                    "contactEmail": "x@y.z"}}

# 1. Happy path: the raw images list comes back, addressed by the property's OWN id (exact binding).
s = _Sess(_Resp(200, DETAIL))
imgs = R.fetch_detail_images(s, "cuid1")
assert imgs == GALLERY, imgs
assert s.urls == [f"{R.LIST_URL}/cuid1"], s.urls

# 2. PDPL: the function's source must never touch the detail payload's contact fields.
src = inspect.getsource(R.fetch_detail_images)
for pii in ("contactName", "contactPhone", "contactEmail", "whatsappNumber", "metadata", "user"):
    assert pii not in src.split('"""')[2], f"fetch_detail_images code must never read {pii}"

# 3. Every failure mode → None, so the caller keeps the list cover.
assert R.fetch_detail_images(_Sess(ConnectionError("boom")), "cuid1") is None
assert R.fetch_detail_images(_Sess(_Resp(503)), "cuid1") is None
assert R.fetch_detail_images(_Sess(_Resp(200, None)), "cuid1") is None          # non-JSON body
assert R.fetch_detail_images(_Sess(_Resp(200, {"data": {"images": "junk"}})), "cuid1") is None
assert R.fetch_detail_images(_Sess(_Resp(200, {})), "cuid1") is None
assert R.fetch_detail_images(_Sess(_Resp(200, DETAIL)), None) is None           # no id → no fetch

# 4. The override semantics main() uses: `_photos({"images": imgs}) or list_cover`.
LIST_COVER = ["https://api.erapulse.sa/uploads/images/cuid1/main_cover.webp"]
after = R._photos({"images": GALLERY}) or LIST_COVER
assert len(after) == 3 and after[0] == LIST_COVER[0], (
    "detail gallery must be used in SOURCE order with the cover first")
#    detail succeeded but every url is a placeholder → _photos()=[] → the cover is never lost.
assert (R._photos({"images": [{"url": "/img/placeholder.png"}]}) or LIST_COVER) == LIST_COVER
#    detail returned [] and the list had nothing → stays imageless, never substituted.
assert (R._photos({"images": []}) or []) == []

# 5. The wiring shape in main(): detail is fetched for kept rows and falls back to the list cover.
_main = inspect.getsource(R.main)
assert "fetch_detail_images(s, p.get(\"id\"))" in _main, "main() must fetch the detail gallery"
assert '_photos({"images": imgs}) or row["photo_urls"]' in _main, (
    "the override must keep the list cover when detail yields nothing")

print("ok: erapulse photos = detail gallery, PDPL images-only, failure keeps the list cover")
