"""Squares prints price, area and a structured address on the LISTING PAGE — not in its REST payload.

The first version read only the REST API and concluded «this source publishes no price»; the real-user
pass found post 19678's page printing «ريال840,000». The markup below is copied verbatim from that page
(2026-09-26), trimmed to the blocks the scraper reads plus one «عقارات ذات صلة» card, whose price
belongs to ANOTHER listing and must never be taken.
"""
import pytest

import scrapers.squares.run as R

_PAGE = (
    '<div class="title-area"><div class="container"><div class="row"><div class="col-lg-8">'
    '<div class="title-left"><h2 class="title">للبيع فلل البساتين في مدينة بريدة</h2>'
    '<p class="address"> <i class="sl-icon sl-place"></i> بريدة, القصيم, السعودية</p></div></div></div></div></div>'
    '<div class="sl-box property-description"><h6 class="heading">وصف العقار</h6><div class="price-area">'
    ' <span class="status"> ل للبيع </span> <span class="price "> ريال840,000 </span></div></div>'
    '<div class="main-features"><ul><li><div class="single-feature"><p>النوع</p> <span>فيلا</span></div></li>'
    '<li><div class="single-feature"><p>سنة البناء</p> <span>2009</span></div></li>'
    '<li><div class="single-feature"><p>المساحة</p> <span> 350 م2 </span></div></li></ul></div>'
    '<div class="sl-box property-features"><h6 class="heading">مميزات العقار</h6><div class="features-list"><ul>'
    '<li><a href="https://squares.com.sa/property_feature/x/"><span>غرفة سائق</span></a></li>'
    '<li><a href="https://squares.com.sa/property_feature/y/"><span>كراج سيارة</span></a></li></ul></div></div>'
    '<h6>عقارات ذات صلة</h6><div class="price-area"><span class="price "> ريال9,000,000 </span></div>'
    '<p class="address"> العزيزية الجنوبية, مكة, 24352, السعودية</p>'
)


def test_the_listing_pages_own_blocks_are_read():
    d = R.parse_detail(_PAGE)
    assert d["price_text"] == "ريال840,000"                 # not the related card's 9,000,000
    assert d["address"] == "بريدة, القصيم, السعودية"         # not the related card's Makkah line
    assert d["facts"]["المساحة"] == "350 م2" and d["facts"]["سنة البناء"] == "2009"
    assert d["features"] == ["غرفة سائق", "كراج سيارة"]


@pytest.fixture
def _catalog(monkeypatch):
    towns = {"بريدة": (11, 4), "الرياض": (3, 1), "مكة": (6, 2)}
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: towns.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي اشبيلية" if "اشبيلية" in (t or "") else None)


@pytest.mark.parametrize("address, city", [
    ("بريدة, القصيم, 52583, السعودية", "بريدة"),       # «city, region, zip» — the region is not a city
    ("اشبيلية, الرياض, السعودية", "الرياض"),            # «district, city»
    ("جدة", None),                                      # a town the (stub) catalog does not know → NULL
])
def test_the_address_line_is_read_right_to_left(_catalog, address, city):
    assert R.place(address)[0] == city


def test_a_district_in_the_address_is_resolved_against_that_city(_catalog):
    assert R.place("اشبيلية, الرياض, السعودية")[3] == "حي اشبيلية"
