"""fursaghyr's media top-up must stay PARENT-BOUND — and degrade to fewer images, never wrong ones.

The defect this pins, found live 2026-09-05: the custom fgh/v1/properties endpoint under-reports
some galleries (post 27171 returned only the featured 88C6DD2E-…-768x1152.png crop while the
page's Houzez gallery and the WP media library both carry IMG_8293-1.jpeg). The fix tops up
_photos() from wp/v2/media?parent=<post id>. The traps that would silently corrupt:
  · the parent filter IS the per-listing binding — drop it and every listing inherits the whole
    media library (agent avatar d455ad43-…-150x150.jpeg included);
  · fgh returns -WxH crops of the originals the media endpoint returns un-cropped — dedupe must
    happen on the _full() output or the same photo appears twice;
  · fgh's [0] is the featured image = banner slide 1 and must stay first;
  · a failed/empty media call keeps exactly what fgh gave (a photo-less listing stays imageless).
"""
import os
import sys
import types
from pathlib import Path

os.environ["SCRAPE_MIN_INTERVAL"] = "0"  # no throttling in a stubbed test
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.fursaghyr.run import MEDIA, _photos  # noqa: E402

UP = "https://fursaghyr.com/wp-content/uploads/2026/06"
CROP = f"{UP}/88C6DD2E-CCB7-475D-BE5B-057F1F686531-768x1152.png"
ORIG = f"{UP}/88C6DD2E-CCB7-475D-BE5B-057F1F686531.png"
EXTRA = f"{UP}/IMG_8293-1.jpeg"


class _Resp:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def json(self):
        return self._body


class _Session:
    """Records the media call; returns a canned body (or raises)."""
    def __init__(self, body, status=200, boom=False):
        self._resp, self._boom, self.calls = _Resp(body, status), boom, []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        if self._boom:
            raise ConnectionError("media endpoint down")
        return self._resp


def _img(url):
    return {"id": 1, "source_url": url, "media_type": "image"}

# 1. THE BINDING: the media query must be scoped to THIS post's id — that is the entire
#    per-listing guarantee (?parent= returns only attachments owned by the listing).
s = _Session([_img(EXTRA)])
out = _photos(s, {"id": 27171, "images": [CROP]})
assert len(s.calls) == 1 and s.calls[0][0] == MEDIA
assert s.calls[0][1]["parent"] == 27171, "media call lost its parent binding"
assert s.calls[0][1]["order"] == "asc", "date-asc is what matches the page's slide order"

# 2. fgh stays first (featured = banner slide 1), the media extra follows, crop → full-res.
assert out == [ORIG, EXTRA], out

# 3. Crop-vs-original dedupe: the media endpoint re-serving the un-cropped original of the
#    featured image must NOT create a second slide.
out = _photos(_Session([_img(ORIG), _img(EXTRA)]), {"id": 27171, "images": [CROP]})
assert out == [ORIG, EXTRA], f"crop/original dedupe failed: {out}"

# 4. Only media_type=image; a video or file attachment is never a photo.
out = _photos(_Session([{"id": 2, "source_url": f"{UP}/tour.mp4", "media_type": "video"},
                        _img(EXTRA)]), {"id": 27171, "images": [CROP]})
assert out == [ORIG, EXTRA], out

# 5. The placeholder/logo filter applies to media entries exactly as to fgh URLs.
out = _photos(_Session([_img(f"{UP}/site-logo.png"), _img(EXTRA)]),
              {"id": 27171, "images": [CROP]})
assert out == [ORIG, EXTRA], out

# 6. Degradation = FEWER, never wrong: a dead media endpoint keeps the fgh set untouched…
out = _photos(_Session([], boom=True), {"id": 27171, "images": [CROP]})
assert out == [ORIG], out
# …a non-200 keeps it too…
out = _photos(_Session("<html>", status=500), {"id": 27171, "images": [CROP]})
assert out == [ORIG], out
# …and a photo-less listing with an empty attachment set STAYS imageless (FG27238/FG25012 live).
assert _photos(_Session([]), {"id": 27238, "images": []}) == []

print("ok: fursaghyr media top-up is parent-bound, crop-deduped, fgh-first, and degrades to fewer")
