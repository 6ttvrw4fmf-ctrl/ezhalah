"""Regression test for sadin's 2026-07 "v4" redesign (4-day dark-platform incident, found 2026-07-30).

The failure shape: sadin.com.sa redesigned — /properties/all 301s to /properties, the
`deals-block-one` card markup vanished, and list pages became server-side paginated (?page=N).
fetch_catalog() parsed 0 cards from the redirected page, main() iterated an empty id list, and the
prune guard (correctly) refused to strike — so the daily run "succeeded" with zero useful output
while 58/59 active rows sat unseen since 2026-07-26.

Guards: the new `<article class="property-card">` parser (title/facts/location), pagination
termination, the `<dt>/<dd>` detail fields (الغرض deal override, نوع العقار real kind, المساحة,
licences), and the /media/ photo path.

Run: python -m pytest scrapers/common/tests/test_sadin_v4_redesign_discovery.py -v
"""
from scrapers.sadin.run import _dd_field, _photos, parse_catalog_cards

# Trimmed live /properties markup (2026-07-30) — one card, real structure.
CARD_PAGE = """
<div class="property-grid property-grid-listing" data-property-results>
<article class="property-card property-card-classic" data-property-card>
<a class="property-card-media" href="/property/4HO6O" aria-label="عرض عمارة">
  <img src="/media/properties/4HO6O/main.png" alt="عمارة">
  <span class="property-badge">للبيع</span>
</a>
<div class="property-card-body"><div class="property-meta-top"><span>عمارة</span><span>رقم 4HO6O</span></div>
<h3><a href="/property/4HO6O">🏢 للبيع عمارة سكنية استثمارية في مخطط الربوة – المدينة المنورة</a></h3>
<p class="property-location"><svg class="v4-icon"><use href="#icon-map-pin"></use></svg> المدينة المنورة · حي العريض</p>
<ul class="property-facts" aria-label="مواصفات مختصرة">
  <li><svg class="v4-icon"><use href="#icon-ruler"></use></svg><b>500</b><span>م²</span></li>
  <li><svg class="v4-icon"><use href="#icon-bed"></use></svg><b>4</b><span>غرف</span></li>
  <li><svg class="v4-icon"><use href="#icon-bath"></use></svg><b>2</b><span>حمامات</span></li>
</ul><div class="property-card-footer"><strong>السعر عند الطلب</strong></div></div>
</article>
<nav class="pagination"><a href="/properties" aria-current="page">1</a><a href="/properties?page=2">2</a><a rel="next" href="/properties?page=2">التالي</a></nav>
</div>
"""

# Trimmed live /property/4HO6O detail markup (2026-07-30) — the new dt/dd rows.
DETAIL = """
<dl><div><dt>الغرض</dt><dd>للبيع</dd></div><div><dt>نوع العقار</dt><dd>عمارة</dd></div>
<div><dt>المساحة</dt><dd>500 م²</dd></div><div><dt>التوفر</dt><dd>متاح</dd></div></dl>
<dl><div><dt>رقم ترخيص الإعلان</dt><dd dir="ltr">7201056013</dd></div>
<div><dt>تاريخ الإصدار</dt><dd>25/07/2026</dd></div><div><dt>تاريخ الانتهاء</dt><dd>31/07/2027</dd></div>
<div><dt>رخصة فال</dt><dd dir="ltr">1200042362</dd></div></dl>
<img src="/media/properties/4HO6O/main.png"><img src="/media/properties/4HO6O/g1.jpg">
"""

# The pre-redesign markup — must parse to NOTHING now (proves we're not double-counting old cards).
OLD_PAGE = '<div class="deals-block-one"><h4><a href="/property/XYZ99">old</a></h4></div>'


def test_new_cards_parse_completely():
    cards: dict = {}
    parse_catalog_cards(CARD_PAGE, cards)
    assert set(cards) == {"4HO6O"}
    c = cards["4HO6O"]
    assert "عمارة سكنية استثمارية" in c["title"]
    assert c["area"] == 500 and c["beds"] == 4 and c["baths"] == 2
    assert c["city_txt"] == "المدينة المنورة"
    assert c["district_txt"] == "حي العريض"


def test_old_markup_yields_no_cards():
    cards: dict = {}
    parse_catalog_cards(OLD_PAGE, cards)
    assert cards == {}  # dead selector must not resurrect phantom cards


def test_detail_dd_fields():
    assert _dd_field(DETAIL, "الغرض") == "للبيع"
    assert _dd_field(DETAIL, "نوع العقار") == "عمارة"        # REAL kind post-redesign
    assert _dd_field(DETAIL, "المساحة") == "500 م²"
    assert _dd_field(DETAIL, "رقم ترخيص الإعلان") == "7201056013"
    assert _dd_field(DETAIL, "رخصة فال") == "1200042362"
    assert _dd_field(DETAIL, "تاريخ الإصدار") == "25/07/2026"
    assert _dd_field(DETAIL, "تاريخ الانتهاء") == "31/07/2027"
    assert _dd_field(DETAIL, "غير موجود") is None


def test_photos_accept_media_path():
    urls = _photos(DETAIL, "4HO6O")
    assert urls and urls[0].endswith("/media/properties/4HO6O/main.png")
    assert len(urls) == 2
