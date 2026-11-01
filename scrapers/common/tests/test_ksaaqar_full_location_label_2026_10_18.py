"""ksaaqar: the district is read from the «الموقع:» box IN FULL, and a label that places the pin in another city gives
this city no district (2026-10-18).

The map line under the price is the theme's copy of the box's label: rendered 2026-10-18, /ad/للبيع-فلل-دبلكس-
في-خميس-مشيط-حي-دره-المو/ prints «خميس مشيط حي دره المو... انظر الخريطة» above a box that says «خميس مشيط حي دره
الموسي». Reading only the map line put the cut words «حي دره المو», «حي العزيز», «حي الصحاف» on live cards; a SHORT
label prints with no «...» («حي التسامح انظر الخريطة»), so it gave no district at all and — with no «...» to stop it —
the city capture swallowed it («جدة جدة حي المروه», «الرياض حي المهدية»: no city_id, so no district). And 7 live
labels name a different city from the one the ad is filed under — «خميس مشيط حي الاسكان» under أبها, «الخبر العزيزية حي
الشراع» under الأحساء, a Riyadh address under جازان — so their district was that other city's. Every string below is
the recorded page, verbatim.
"""
from __future__ import annotations

import pytest

import scrapers.common.db as db
import scrapers.ksaaqar.run as K


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(K, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(K, "find_district_in_text", lambda text, city_id: None)
    monkeypatch.setattr(K, "known_district_keys", lambda city_id: set())


def _box(label):
    return ('<div id="adt-ad-location-box" class="adt-ad-location-box">\n<div class="top-box">\n<h4>الموقع:</h4>\n<p>\n'
            f'<i class="fas fa-location-arrow"></i>{label}                                         </p>\n</div>')


def _text(city, line, label):
    return (f"الدولة: عقارات {city} الحالة: جديدة {line}... انظر الخريطة تم النشر في 19 فبراير 2021 "
            "النوع: للبيع نوع العقار : سكني الوصف: للبيع "
            f"الموقع: {label} اكتب مراجعة معرض المراجعات: اختر ملف")


def _row(city, line, label, title="فلل > فلل للبيع"):
    post = {"id": 1, "link": "https://ksaaqar.com/ad/x/", "title": {"rendered": title},
            "content": {"rendered": ""}, "class_list": []}
    row, _cat, why = K.map_listing(post, _text(city, line, label), _box(label))
    assert row is not None, why
    return row


# (id, filed city, map line as printed, the box's label) — recorded 2026-10-18
CUT = [
    (12226425, "خميس مشيط", "خميس مشيط حي دره المو", "خميس مشيط حي دره الموسي", "حي دره الموسي"),
    (12226419, "الخبر", "الخبر حي العزيز", "الخبر حي العزيزية", "حي العزيزية"),
    (12226975, "الرياض", "الرياض حي الصحاف", "الرياض حي الصحافه, Riyadh, Riyadh, Saudi Arabia", "حي الصحافه"),
]
# The ad's own label names ONE city that is not the category's bucket: filed under the label's city (owner 2026-10-18).
REFILED = [
    (12226411, "أبها", "خميس مشيط حي الاسكان", "خميس مشيط حي الاسكان", "خميس مشيط", "حي الاسكان"),
    (12225953, "أبها", "خميس مشيط حي الراقي", "خميس مشيط حي الراقي", "خميس مشيط", "حي الراقي"),
]
# …but not when the title names a DIFFERENT city (12226684: a Riyadh postal address on an ad titled «… صبيا …»), nor
# when the label names two cities: no district of the category city comes from it, and the stored one clears.
ELSEWHERE = [
    (12226684, "جازان", "محطة كهرباء حي قرطبة، 3",
     "محطة كهرباء حي قرطبة، 3712 طريق الدمام، 6480، قرطبة، الرياض 13245، السعودية", "ارض حجه صبيا مرفوعه في احكام"),
    (0, "الدمام", "الخبر، الدمام السعودية", "الخبر، الدمام السعودية", "فلل > فلل للبيع"),
]


@pytest.mark.parametrize("ad,city,line,label,want", CUT)
def test_the_cut_map_line_is_read_whole_from_the_box(ad, city, line, label, want):
    assert K.location_box_label(_box(label)) == label
    row = _row(city, line, label)
    assert row["neighborhood"] == want, ad
    assert row["additional_info"]["map_line"] == label.split(",")[0]


@pytest.mark.parametrize("ad,city,line,label,new_city,district", REFILED)
def test_the_ads_own_label_city_wins_over_the_category_bucket(ad, city, line, label, new_city, district):
    row = _row(city, line, label)
    assert row["city_ar"] == new_city and row["neighborhood"] == district, ad
    assert row["additional_info"]["category_city_ar"] == city


@pytest.mark.parametrize("ad,city,line,label,title", ELSEWHERE)
def test_a_label_in_another_city_gives_this_city_no_district_and_clears_the_stored_one(ad, city, line, label, title):
    row = _row(city, line, label, title=title)
    assert row["city_ar"] == city, ad
    assert row["neighborhood"] is db.AUTHORITATIVE_NULL, ad
    assert row["district_ar"] is db.AUTHORITATIVE_NULL, ad
    assert row["additional_info"]["district_source"] == "label_names_another_city"


def test_a_district_or_road_named_after_a_city_is_not_another_city():
    assert not K.names_other_city("حي الرياض والفروسية", "Jeddah")         # جدة's حي الرياض
    assert not K.names_other_city("3712 طريق الدمام، الرياض 13245", "Riyadh")
    assert not K.names_other_city("عقارات الرياض الرياض حي ضهر البن", "Riyadh")
    assert K.names_other_city("امارة منطقة الرياض", "Jeddah")
    assert K.names_other_city("الخبر العزيزية حي الشراع", "Hofuf")


def test_the_city_a_label_appends_to_its_district_is_not_part_of_the_district():
    assert K.neighborhood_word("حي طيب الاسم خميس مشيط", None, None) == "حي طيب الاسم"
    assert K.neighborhood_word("عقارات حي النسيم الرياض", None, None) == "حي النسيم"
    assert K.neighborhood_word("حي الملقا شمال الرياض", None, None) == "حي الملقا"      # live, 2026-10-18
    assert K.neighborhood_word("حي النرجس بالرياض", None, None) == "حي النرجس"
    assert K.neighborhood_word("حي الرياض", None, None) == "حي الرياض"     # there the city's name IS the district


def test_without_a_box_the_map_line_answers_as_before():
    post = {"id": 1, "link": "https://ksaaqar.com/ad/x/", "title": {"rendered": "فلل > فلل للبيع"},
            "content": {"rendered": ""}, "class_list": []}
    row, _cat, why = K.map_listing(post, "الدولة: عقارات الرياض الحالة: جديدة الرياض حي النضيم... انظر الخريطة "
                                         "النوع: للبيع نوع العقار : سكني", "")
    assert row is not None, why
    assert row["neighborhood"] == "حي النضيم"


def _short_page(category, label):
    """A short label, verbatim layout: no «...» between it and «انظر الخريطة», no status box before it."""
    text = (f"الدولة: عقارات {category} {label} انظر الخريطة تم النشر في 3 مارس 2021 النوع: للبيع نوع العقار : سكني "
            f"الموقع: {label} اكتب مراجعة")
    page_html = ('<strong>الدولة: </strong><a style="color:#777777" class="ctg-tag" '
                 f'href="https://ksaaqar.com/search-results/?ad_country=1116">عقارات {category}</a> </p> '
                 f'<i class="fas fa-map-marker-alt"></i>{label}<a href="#adt-ad-location-box">انظر الخريطة</a></span> '
                 + _box(label))
    return text, page_html


@pytest.mark.parametrize("ad,category,label,want", [
    (12226361, "أبها", "حي التسامح", "حي التسامح"),          # «ڤيلا بحى التسامح …»: served no district before
    (12225902, "أبها", "حي الراقي", "حي الراقي"),
])
def test_a_short_label_with_no_dots_still_gives_its_district(ad, category, label, want):
    text, page_html = _short_page(category, label)
    post = {"id": 1, "link": "https://ksaaqar.com/ad/x/", "title": {"rendered": "فلل > فلل للبيع"},
            "content": {"rendered": ""}, "class_list": []}
    row, _cat, why = K.map_listing(post, text, page_html)
    assert row is not None, why
    assert row["city_ar"] == category and row["neighborhood"] == want, ad


@pytest.mark.parametrize("category,label", [("جدة", "جدة حي المروه"), ("الرياض", "حي المهدية"), ("جدة", "جدة السعودية")])
def test_the_city_is_the_category_never_the_category_glued_to_the_label(category, label):
    text, page_html = _short_page(category, label)
    assert K.parse_city(text, "", page_html) == category
