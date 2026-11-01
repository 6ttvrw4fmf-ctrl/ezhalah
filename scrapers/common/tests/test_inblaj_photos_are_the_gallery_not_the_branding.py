"""An inblaj listing's photos are its swiper gallery — never the office's header/footer branding.

Measured on production 2026-09-27: `photos()` scanned every `<img>` under /wp-content/uploads/ on
the page, so the branding rode along on every row — gudai's header logo
(output-onlinepngtools-4-e1772490357840.png) on 12/12, safera's three «سفيرة العقارات» header
logos plus its footer logo on 9/9. None of those file names contains «logo», so the name filter
never saw them. The gallery is the Elementor swiper (`class="swiper-slide-image"`, lazy-loaded
through `data-src` on gudai, plain `src` on safera); anything outside it is not the listing's.

Executes the REAL `photos` out of the production module over the markup shapes the two live sites
serve (trimmed), never a retyped copy.

Run: python -m pytest scrapers/common/tests/test_inblaj_photos_are_the_gallery_not_the_branding.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common.inblaj_platform import photos  # noqa: E402

UP = "https://x.inblaj.net/wp-content/uploads"

GUDAI = f"""
<a href="/"><img fetchpriority="high" width="600" height="567"
  src="{UP}/2025/11/output-onlinepngtools-4-e1772490357840.png"
  class="attachment-full size-full wp-image-1754" alt="" decoding="async"></a>
<img class="swiper-slide-image lazyload" data-src="{UP}/2025/11/1665683986.webp" alt="a"
  src="data:image/svg+xml;base64,PHN2Zz4=">
<img class="swiper-slide-image lazyload" data-src="{UP}/2025/11/1665683985.webp" alt="b"
  src="data:image/svg+xml;base64,PHN2Zz4=">
"""

SAFERA = f"""
<img src="{UP}/2025/12/Screenshot_2025-12-11_140118-removebg-preview.png" alt="سفيرة العقارات">
<img src="{UP}/2025/12/Untitled_design-removebg-preview.png" height="auto" width="250px" alt="سفيرة العقارات" />
<img class="swiper-slide-image" src="{UP}/2026/01/image_2026-01-18_204736109.png" alt="i1" />
<img class="swiper-slide-image" src="{UP}/2026/01/image_2026-01-22_210130994-1024x768.png" alt="i2" />
<img class="swiper-slide-image" src="{UP}/2026/01/image_2026-01-18_204736109.png" alt="loop clone" />
<img src="{UP}/2025/12/81f12aa2-removebg-preview-1.png" alt="شعار سفيرة العقارات" class="footer-logo">
"""


def test_gudai_header_logo_is_not_a_photo():
    assert photos(GUDAI) == [f"{UP}/2025/11/1665683986.webp", f"{UP}/2025/11/1665683985.webp"]


def test_safera_branding_is_not_a_photo_and_loop_clones_collapse():
    assert photos(SAFERA) == [
        f"{UP}/2026/01/image_2026-01-18_204736109.png",
        f"{UP}/2026/01/image_2026-01-22_210130994-1024x768.png",
    ]


def test_a_page_with_only_branding_has_no_photos():
    # Negative control: branding alone must read as photo-less (NULL), not as a photo.
    assert photos(SAFERA.split('<img class="swiper')[0]) is None
