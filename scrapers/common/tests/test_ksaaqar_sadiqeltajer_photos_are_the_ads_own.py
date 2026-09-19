"""ksaaqar + sadiqeltajer: a listing's photos are its OWN, never a neighbour's.

Same trap as the price bug, in the image dimension. Both themes render OTHER ads on every detail
page — ksaaqar in `.category-img-box` (related/recent cards), sadiqeltajer in the «اعلانات مشابهة»
section — and those cards carry real listing photos. A gallery scraper that grabs "the images on
the page" would stamp a neighbour's photos onto this listing. Each fixture below is markup captured
verbatim from a live page, the neighbour's image left in, so a regression has something to grab.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_sadiqeltajer_photos_are_the_ads_own.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.ksaaqar.run import own_photos  # noqa: E402
from scrapers.sadiqeltajer.run import photos as sq_photos  # noqa: E402

# ksaaqar: one OWN gallery slide (.img-box, anchor = full-size image) next to a RELATED-ad card
# (.category-img-box, an image_picker thumbnail). Verbatim from a live apartment page.
KSA_OWN = """<div class="img-box"> <a href="https://ksaaqar.com/wp-content/uploads/2022/06/IMG_20220619_11003553480381719033.jpg" data-fancybox="gallery" class="lightbox"> <img src="https://ksaaqar.com/wp-content/uploads/2022/06/IMG_20220619_11003553480381719033-600x410.jpg" alt="شقق تمليك فاخره حي النور"> </a>"""
KSA_RELATED = """<div class="category-img-box"> <a href="https://ksaaqar.com/ad/%d8%b4%d9%82%d9%87-%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1-4/"> <img class="img-fluid" src="https://ksaaqar.com/wp-content/uploads/2026/09/1000057264-308x410.jpg" alt="شقه ايجار"> </a>"""

# sadiqeltajer: one OWN slide (.slide-img) BEFORE the similar-ads boundary, and a neighbour photo
# placed AFTER «اعلانات مشابهة» so it must be excluded by construction.
SQ_OWN = """<div class="slide-img"> <img src="https://sadiq-eltajer.sa/storage/webp/b82179f956012b2d16adaff228951ec6.webp" alt="ارض مخطط السلمان شمال بريدة" loading="lazy" decoding="async" width="800"> </div>"""
SQ_SIMILAR_URL = """https://sadiq-eltajer.sa/storage/webp/bf97386058f11f5dde2b1653c3628727.webp"""


def test_ksaaqar_reads_its_own_full_size_gallery():
    urls = own_photos(KSA_OWN + KSA_RELATED)
    assert urls == ['https://ksaaqar.com/wp-content/uploads/2022/06/IMG_20220619_11003553480381719033.jpg']


def test_ksaaqar_never_captures_a_related_ads_thumbnail():
    # The related card's image_picker thumbnail is physically present; it must not appear.
    urls = own_photos(KSA_OWN + KSA_RELATED) or []
    assert not any('image_picker' in u or '/ad/' in u for u in urls)
    assert own_photos(KSA_RELATED) is None, 'a page with ONLY related cards has no own photos'


def test_ksaaqar_land_ad_with_no_gallery_is_None_not_a_borrowed_image():
    assert own_photos('<html><body><div class="category-img-box"><a href="x.jpg"><img src="y.png"></a></div></body></html>') is None


def test_sadiqeltajer_reads_its_own_slide():
    assert sq_photos(SQ_OWN) == ['https://sadiq-eltajer.sa/storage/webp/b82179f956012b2d16adaff228951ec6.webp']


def test_sadiqeltajer_never_captures_a_similar_ads_photo():
    page = SQ_OWN + 'اعلانات مشابهة' + '<div class="slide-img"><img src="' + SQ_SIMILAR_URL + '"></div>'
    urls = sq_photos(page)
    assert SQ_SIMILAR_URL not in (urls or []), 'a photo after the similar-ads boundary must be excluded'
    assert urls == ['https://sadiq-eltajer.sa/storage/webp/b82179f956012b2d16adaff228951ec6.webp']


def test_sadiqeltajer_chrome_is_not_a_photo():
    chrome = '<div class="slide-img"><img src="https://sadiq-eltajer.sa/storage/images/settings/logo.webp"></div>'
    assert sq_photos(chrome) is None
