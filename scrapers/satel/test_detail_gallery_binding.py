"""satel's gallery must come from the DETAIL endpoint, bound by propertyNumber echo.

The defect this pins, found live 2026-09-05: the filter/list API truncates imageList to just the
featured image (1 entry for 225 of 226 live listings), so every Satel row stored exactly one
photo while the per-listing endpoint /property/p/v2/{propertyNumber}?version=2 carried the full
gallery (C0055 → 32, C0094 → 19). The trap in the fix: the detail response must be trusted ONLY
when it echoes OUR propertyNumber back — that echo is the per-listing binding (and we never
touch listings.satel.sa page HTML, whose slug-decoy behavior renders the same fake listing for
any slug). Also pinned: imgOrder = the SOURCE's gallery order (first URL = card thumbnail),
detail failure/empty gallery keeps the featured-image fallback (FEWER images, never a wrong
one), and no-photos-anywhere stays an EMPTY list (never a substitute).
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.satel.run import _fetch_detail, _photo_urls  # noqa: E402

SP = "https://satel-resources.nyc3.digitaloceanspaces.com"
HERO, P2, P3 = f"{SP}/hero_w1200.webp", f"{SP}/p2_w1200.webp", f"{SP}/p3_w1200.webp"


class _Resp:
    status_code = 200

    def __init__(self, j):
        self._j = j

    def json(self):
        return self._j


class _Sess:
    def __init__(self, j):
        self._j = j

    def get(self, url, timeout=None):
        return _Resp(self._j)


# 1. THE REASON THIS FILE EXISTS: the detail record's full gallery, in imgOrder, replaces the
#    list's single featured image; imageList[0] stays the featured/thumbnail image.
detail = {"propertyNumber": "C0055", "imageList": [
    {"filepath": P3, "imgOrder": 2},
    {"filepath": HERO, "imgOrder": 0},
    {"filepath": P2, "imgOrder": 1},
]}
assert _photo_urls(detail) == [HERO, P2, P3], "imgOrder is the source gallery order, hero first"

# 2. Per-listing binding: a 200 that names a DIFFERENT propertyNumber must never bind its gallery
#    to our row — _fetch_detail returns None and the caller keeps the featured fallback.
assert _fetch_detail(_Sess(detail), "C0094") is None, "foreign propertyNumber must not bind"
assert _fetch_detail(_Sess(detail), "C0055") == detail, "own propertyNumber binds"

# 3. A {"data": {...}} wrapper unwraps like fetch_all's list response does.
assert _fetch_detail(_Sess({"data": detail}), "C0055") == detail, "data-wrapper must unwrap"

# 4. Fallback semantics in main(): empty/failed detail keeps the featured image, never blanks it.
featured_only = {"imageList": [{"filepath": HERO, "imgOrder": 0}]}
kept = _photo_urls({"propertyNumber": "C0055", "imageList": []}) or _photo_urls(featured_only)
assert kept == [HERO], "detail failure degrades to the featured image, not to empty"

# 5. Source publishes no photo anywhere → EMPTY list stays empty (never a substitute), and junk
#    entries (non-dict, non-http, presigned dupes) are dropped without crashing the imgOrder sort.
assert _photo_urls({"propertyNumber": "X", "imageList": []}) == []
messy = {"imageList": ["junk", {"filepath": None}, {"filepath": f"{HERO}?X-Amz-Sig=zz", "imgOrder": 1},
                       {"filepath": HERO, "imgOrder": 0}]}
assert _photo_urls(messy) == [HERO], "presign stripped, dupes collapsed, junk skipped"

print("ok — satel detail gallery pinned (pnum-echo binding, imgOrder order, featured fallback)")
