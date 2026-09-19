"""صادق التاجر renders OTHER listings on every page. Every test here exists because a real listing
shape would otherwise be read wrong.

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_never_reads_a_neighbours_price.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.sadiqeltajer.run as S  # noqa: E402
from scrapers.sadiqeltajer.run import (  # noqa: E402
    ad_code, desc, own_section, parse_age, parse_area, parse_bathrooms, parse_bedrooms,
    parse_deal, parse_direction, parse_location, parse_price, parse_street_width, parse_type_ar,
    annual_income,
)

S.to_catalog = lambda city_ar, region_hint=None: (1, 1)
S.find_district_in_text = lambda text, city_id: text

# A real page's shape: this listing, then the «اعلانات مشابهة» block of OTHER listings.
PAGE = (
    "<html><body>"
    "--&gt; 3 استراحات بحي الغدير شرق بريدة --&gt; بيع استراحات واحواش كود الاعلان : 5106 "
    "(حد) 3 استراحات بحي الغدير شرق بريدة 235,000 ريال 480 م² اللوكيشن تفاصيل الإعلان "
    "للبيع 3 استراحات بحي الغدير شرق بريدة المساحة : 480م العمر : 10سنوات "
    "الواجهة : شارع شرقى 25م المكونات : غرفتين . دورة مياه الدخل السنوي 23 الف "
    "الموقع حسب الصك من وزارة العدل القصيم - بريدة - الغدير "
    "اعلانات مشابهة 5415 478 م² 285,000 ريال 7020 17800 م² 2,000,000 ريال"
    "</body></html>")


# ── the hazard this scraper exists to avoid ──────────────────────────────────────────────────────
def test_the_similar_listings_block_is_cut_off():
    own = own_section(PAGE)
    assert "اعلانات مشابهة" not in own
    assert "2,000,000" not in own, "that price belongs to a DIFFERENT property"
    assert "285,000" not in own


def test_price_is_this_listings_own_not_a_neighbours():
    assert parse_price(own_section(PAGE)) == (235000, None)


def test_annual_rental_income_is_never_the_price():
    # «الدخل السنوي 23 الف» is what the property EARNS, not what it costs.
    t = own_section(PAGE)
    assert parse_price(t)[0] == 235000
    assert annual_income(t) is not None, "it is captured — as INCOME, in additional_info"


# ── price per metre ──────────────────────────────────────────────────────────────────────────────
def test_explicit_per_metre_marker_is_not_a_total():
    t = "كود الاعلان : 7312 | (سوم) اربع قطع 430 ريال ( للمتر ) 479 م²"
    assert parse_price(t) == (None, 430)


def test_an_impossible_total_is_read_as_per_metre():
    # 220 riyals for 4,412 m² would be 0.05 SAR/m² — no Saudi property has ever sold for that.
    assert parse_price("كود الاعلان : 6030 | (سوم) اربع قطع 220 ريال 4412 م²") == (None, 220)


def test_a_plausible_total_is_never_reinterpreted():
    assert parse_price("كود الاعلان : 6827 عمارة 1,050,000 ريال 800 م²") == (1050000, None)


def test_by_offer_is_an_absence_not_a_number():
    assert parse_price("كود الاعلان : 5057 على السوم 3 استراحات 558 م²") == (None, None)


# ── the description's own rows ───────────────────────────────────────────────────────────────────
def test_a_value_stops_at_the_next_label_even_without_a_colon():
    # «العمر : جديد الدخل 42الف» — a stop that required a colon let «الدخل» run on and stored 42 as
    # the AGE of a property whose own text says «جديد» (new). That is invented data.
    t = "المساحة : 412م العمر : جديد الدخل 42الف المكونات : غرفة . دورة مياه"
    assert parse_age(t) == 0
    assert desc(t, "المكونات") == "غرفة . دورة مياه"


def test_components_parse_despite_an_inner_colon():
    t = "المكونات : مكونات كل استراحه : غرفتين . دورة مياة . دكه الدخل السنوى 36000 ريال"
    assert desc(t, "المكونات") == "مكونات كل استراحه : غرفتين . دورة مياة . دكه"
    assert parse_bathrooms(t) == 1
    assert parse_bedrooms(t) == 2, "«غرفتين» is the Arabic dual — it IS two rooms"


def test_singly_named_rooms_are_counted_as_written():
    assert parse_bedrooms("المكونات : غرفة ماستر . غرفة . صالة . دورة مياه") == 2


def test_street_width_comes_from_the_frontage_row():
    assert parse_street_width(own_section(PAGE)) == 25
    assert parse_direction(own_section(PAGE)) == "شرقى"


# ── location + identity ──────────────────────────────────────────────────────────────────────────
def test_location_is_region_city_district():
    assert parse_location(own_section(PAGE)) == ("القصيم", "بريدة", "الغدير")


def test_ad_code_and_deal_and_type():
    t = own_section(PAGE)
    assert ad_code(t) == "5106"
    assert parse_deal(t) == "Buy"
    assert parse_type_ar(t) == "استراحة"


def test_compound_category_with_parentheses_is_mapped():
    t = "--> عمارة --> بيع تجاري عمائر و شقق ( تجارية و سكني ) كود الاعلان : 6977"
    assert parse_type_ar(t) == "عمارة"


def test_a_subdivision_plan_is_not_a_property():
    t = "--> مخطط --> بيع مخططات كود الاعلان : 1234"
    assert parse_type_ar(t) is None, "«مخططات» is a layout of many plots, not one property"


def test_unknown_category_is_skipped_never_guessed():
    assert parse_type_ar("--> x --> بيع صنف غير معروف كود الاعلان : 9") is None


def test_area_and_code_read_arabic_indic_digits():
    assert ad_code("كود الاعلان : ٦٠٣٠") == "6030"


def test_the_per_metre_marker_is_load_bearing_on_its_own():
    # 5,000 > 400, so the "impossible total" rule does NOT fire here — only the «للمتر» marker
    # distinguishes a 5,000 SAR/m² plot from a 5,000 SAR one. Without the marker check this stores
    # a 400 m² plot as costing five thousand riyals in total.
    assert parse_price("كود الاعلان : 1 (سوم) ارض 5,000 ريال ( للمتر ) 400 م²") == (None, 5000)


def test_by_offer_wins_even_when_the_header_carries_another_number():
    # «على السوم» means the price is not published. A figure elsewhere in the same header — a plot
    # number, a plan number — must not be promoted into the price slot.
    assert parse_price("كود الاعلان : 2 | رقم اللوحة : 2412 على السوم ارض 750 ريال 900 م²") \
        == (None, None)
