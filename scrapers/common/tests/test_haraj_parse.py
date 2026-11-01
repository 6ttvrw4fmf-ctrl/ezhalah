"""Backlog 311: Haraj fields come only from the post's own JSON-LD + REGA block (real posts, 2026-10-10)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest  # noqa: E402

from scrapers.haraj import parse as P  # noqa: E402
from scrapers.haraj.parse import ld_listing, parse_post  # noqa: E402

SALE = {"@type": "RealEstateListing", "name": "بيت دور وشقتين للبيع في حي العاصمة",
        "description": "معلومات العقار حسب الرخصة\nغرض الإعلان: بيع\nسعر الوحدة: 1300000\nنوع العقار: فيلا\n"
                       "مساحة العقار: 418\nخدمات العقار: كهرباء, مياه\n صاحب الترخيص : فلان الفلاني\n-----\n"
                       "وصف موقع العقار حسب الصك\nالمدينة: الهفوف\nالحي: العاصمة\nموقع العقار على الخريطة: \n"
                       "https://maps.google.com/?q=25.310710680762,49.548544842388",
        "url": "https://haraj.com.sa/11190242898/x/", "datePosted": "2026-10-10T05:38:40.000Z",
        "address": {"addressLocality": "الهفوف"},
        "offers": {"seller": {"@type": "Person", "name": "موسسة البيان العقارية"}}}
FREE = {"@type": "RealEstateListing", "name": "شقه للايجار", "description": "شقة 4 غرف حي الصهلوج",
        "url": "https://haraj.com.sa/11190241684/x/", "address": {"addressLocality": "بريدة"},
        "offers": {"seller": {"name": "abc"}}}


def test_rega_sale():
    p = parse_post(SALE)
    assert (p["deal"], p["price"], p["property_type_ar"], p["area_m2"]) == ("Buy", 1300000.0, "فيلا", 418.0)
    assert (p["city_ar"], p["district_ar"]) == ("الهفوف", "العاصمة")
    assert (p["latitude"], p["longitude"]) == (25.310710680762, 49.548544842388)
    assert p["rega_block"] is True


def test_free_text_post_gives_no_structured_price_or_area():
    p = parse_post(FREE)
    assert p["price"] is None and p["area_m2"] is None and p["deal"] is None and p["rega_block"] is False
    assert p["city_ar"] == "بريدة" and p["latitude"] is None


def test_never_stores_the_seller():
    p = parse_post(SALE)
    assert "seller" not in json.dumps(p, ensure_ascii=False)
    assert "موسسة البيان" not in json.dumps(p, ensure_ascii=False)


def test_ld_listing_from_page():
    html = '<script type="application/ld+json">' + json.dumps(SALE, ensure_ascii=False) + "</script>"
    assert ld_listing(html)["name"] == SALE["name"]
    assert ld_listing("<html></html>") is None


def test_licence_holder_name_is_redacted():
    assert "فلان" not in parse_post(SALE)["description"]


# ── REGA single-choice facade diagonals + «Less Than Year» (2026-10-17: 119 + 14 Haraj ads stored none) ──
@pytest.mark.parametrize("raw,want", [
    ("شمالية شرقية", "شمال شرق"), ("جنوبية غربية", "جنوب غرب"), ("Northeast", "شمال شرق"),
    ("South west", "جنوب غرب"), ("North west", "شمال غرب"), ("South east", "جنوب شرق"),
    ("جنوبية - شرقية", None), ("Eastern - Western", None), ("ثلاثة شوارع", None),   # two+ streets: raw kept
    ("شمالية", "شمال"), ("Eastern", "شرق"),
])
def test_facade_diagonals_are_one_facade(raw, want):
    assert P.facade_of(raw) == want


@pytest.mark.parametrize("raw,want", [("Less Than Year", 0), ("less than a year", 0), ("أقل من سنة", 0),
                                      # REGA's open top bucket = «10 or more» → 10 (the AF clause reads a haraj
                                      # 10 as ≥ 10, upper end unknown; 2026-10-25). Any other open bound stays unknown.
                                      ("اكثر من عشر سنوات", 10), ("أكثر من 10 سنوات", 10), ("Ten Year", 10),
                                      ("أكثر من 20 سنة", None), ("45سنه", 45), ("٤٥ سنة", 45), ("Seven Year", 7)])
def test_less_than_a_year_is_new(raw, want):
    assert P.age_of(raw) == want
