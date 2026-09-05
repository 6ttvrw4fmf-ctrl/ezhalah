"""hajer's _image() slider fallback must stay SLIDER-CLASS-ONLY.

The defect this pins, found live 2026-09-05: REM keeps the gallery photo in its own meta and does
not always sync it to WP featured_media (47/119 listings had featured_media=0, e.g. posts 1510
and 1441), so the REST-only read returned [] while the detail page showed the real photo in
<img class="skip-lazy rem-slider-image" src="…">. The fallback reads that slider — and NOTHING
else on the page. The trap: a detail page also carries related-listings thumbnails, site chrome
and the 3 placeholder-logo upload sizes; harvesting any generic <img> would attach ANOTHER
listing's photo to this row (per-listing-binding breach). Only the rem-slider-image class is
proof of ownership.
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.hajer.run import _image  # noqa: E402

PHOTO = "https://hajerhouses.com/wp-content/uploads/2026/01/Screenshot-2026-01-05.png"
PHOTO2 = "https://hajerhouses.com/wp-content/uploads/2026/01/Screenshot-2026-01-06.png"
PLACEHOLDER = "https://hajerhouses.com/wp-content/uploads/2025/09/Screen-Shot-2025-09-12.png"
RELATED = "https://hajerhouses.com/wp-content/uploads/2026/01/other-listing.jpg"

SLIDER = f'<img class="skip-lazy rem-slider-image" src="{PHOTO}" alt="">'
CHROME = (f'<img class="related-thumb" src="{RELATED}">'
          f'<img src="{PLACEHOLDER}" class="logo">')

# 1. Featured media, when real, still wins — the fallback never runs for the 72 synced rows.
featured = {"_embedded": {"wp:featuredmedia": [{"source_url": PHOTO2}]}}
assert _image(featured, SLIDER + CHROME) == [PHOTO2], "featured media must stay first choice"

# 2. THE REASON THIS FILE EXISTS: featured_media=0 → the slider image is recovered from the html.
assert _image({}, SLIDER + CHROME) == [PHOTO], "slider fallback must recover the REM photo"

# 3. Slider-class-only: without the class, no <img> on the page may be harvested — not related
#    listings, not chrome. FEWER images, never a WRONG one.
assert _image({}, CHROME) == [], "a non-slider <img> must never bind to this listing"

# 4. The Screen-Shot placeholder guard applies inside the slider too; empty stays EMPTY.
assert _image({}, f'<img class="rem-slider-image" src="{PLACEHOLDER}">') == []

# 5. Multi-image slider: source (document) order preserved, duplicates collapsed once.
multi = (f'<img class="rem-slider-image" src="{PHOTO}">'
         f'<img class="rem-slider-image" src="{PHOTO2}">'
         f'<img class="rem-slider-image" src="{PHOTO}">')
assert _image({}, multi) == [PHOTO, PHOTO2], "gallery order is the source's, first URL = thumbnail"

print("ok — hajer slider fallback pinned (slider-class-only, placeholder-guarded, order-preserving)")
