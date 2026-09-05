"""Gallery extraction must bind images to THIS listing only, and store the source's working URLs.

Pins the 2026-09-05 image-capture fix (three stacked defects, verified live that day):
  1. The old #property_slider_carousel/.prettygalery selector was obsolete (0 hits on every live
     page) and its whole-page fallback swept 16-45 uploads URLs per page INCLUDING the 4
     property_unit_carousel related-listings blocks — other listings' photos. Collection is now a
     depth-balanced walk scoped to the lightbox/header gallery divs only.
  2. "artboard" was blacklisted, but the agency's genuine photos are named Artboard-*.png
     (33309: all 5) — that was the 12% zero-image cohort.
  3. Size-stripping the stored URL kills it on this host (HTTP 422 on the stripped originals;
     the raw -WxH variants serve 200) — the base is a DEDUPE KEY only, storage is verbatim.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# stub the scraper's DB module so importing run.py needs no credentials
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.eastabha.run import parse_detail, build_photos, _is_real_photo  # noqa: E402

UP = "https://eastabha.sa/wp-content/uploads/2025/06"

# real page shape (33309, 2026-09-05): lightbox carousel items carry background-image:url(...),
# the header grid repeats the first bases at thumb sizes, and related-listings carousels follow.
PAGE = f"""
<div class="lightbox_property_wrapper">
  <div class="lightbox_property_wrapper_level2">
    <div class="item" href="#1" style="background-image:url({UP}/Artboard-1-5.png)"><div class="owl_caption">x</div></div>
    <div class="item" href="#2" style="background-image:url({UP}/Artboard-2-1110x623.png)"><div class="owl_caption">x</div></div>
  </div>
</div>
<div class="gallery_wrapper row property_header_gallery_wrapper">
  <img src="{UP}/Artboard-1-5-272x189.png"><img src="{UP}/Artboard-2-272x189.png">
</div>
<div class="property_unit_carousel">
  <img src="{UP}/OTHER-LISTING-photo-272x189.jpeg">
</div>
"""

g = parse_detail(PAGE)["gallery"]
# 1. per-listing binding: the related-listings block contributes NOTHING
assert not any("OTHER-LISTING" in u for u in g), f"related-listings photo leaked: {g}"
# lightbox first (source order), then the header thumbs (sibling candidates)
assert g[0] == f"{UP}/Artboard-1-5.png" and g[1] == f"{UP}/Artboard-2-1110x623.png", g

photos = build_photos(None, g)
# 2. artboard files are real photos now; chrome guards still hold
assert _is_real_photo(f"{UP}/Artboard-1-5.png")
assert not _is_real_photo(f"{UP}/logo.png") and not _is_real_photo(f"{UP}/placeholder.jpeg")
# 3. dedupe by base, store VERBATIM (no size strip), sized header sibling replaces the bare first
assert photos == [f"{UP}/Artboard-1-5-272x189.png", f"{UP}/Artboard-2-1110x623.png"], photos

# a bare URL with NO sized sibling anywhere stays as published (33309's live first entry)
assert build_photos(None, [f"{UP}/Artboard-9.png"]) == [f"{UP}/Artboard-9.png"]
# featured is the card thumbnail and dedupes against its own gallery size-variant
assert build_photos(f"{UP}/a.jpeg", [f"{UP}/a-1110x623.jpeg", f"{UP}/b-1110x623.jpeg"]) == [
    f"{UP}/a-1110x623.jpeg", f"{UP}/b-1110x623.jpeg"]

# 4. a page with no gallery divs yields an EMPTY list — never the whole-page sweep
assert parse_detail(f'<div class="property_unit_carousel"><img src="{UP}/x.jpeg"></div>')["gallery"] == []

print("ok: gallery scoped to the listing's own divs; artboard photos kept; sized URLs stored verbatim")
