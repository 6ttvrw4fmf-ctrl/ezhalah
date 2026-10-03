"""dealapp: the page's visible location line fills a district the title does not carry (2026-10-03).

Owner: «all the ones in dealapp have a district». A listing whose title has no district segment
("دور للبيع - بئر بن هرماس") still prints «بئر بن هرماس, حي الربوة» on the page. The line is a
GAP-FILLER only: the title's own district wins, and both printed orders must agree.

Run: python -m pytest scrapers/common/tests/test_dealapp_location_line_district.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import _location_line_district_ar  # noqa: E402


def _page(*blocks):
    body = "".join(f"<div>{b}</div>" for b in blocks)
    return f"<html><head><title>x</title></head><body>{body}</body></html>"


def test_both_orders_of_the_line_give_the_district():
    html = _page("دور للبيع", "بئر بن هرماس, حي الربوة", "1,000 م²", "حي الربوة, بئر بن هرماس")
    assert _location_line_district_ar(html, "بئر بن هرماس") == "حي الربوة"


def test_one_order_alone_is_not_enough():
    assert _location_line_district_ar(_page("الغاط, حي المنتزة"), "الغاط") is None
    assert _location_line_district_ar(_page("حي المنتزة, الغاط"), "الغاط") is None


def test_disagreeing_orders_give_nothing():
    html = _page("الغاط, حي المنتزة", "حي المروج, الغاط")
    assert _location_line_district_ar(html, "الغاط") is None


def test_no_city_no_guess_and_no_english():
    html = _page("الغاط, حي المنتزة", "حي المنتزة, الغاط")
    assert _location_line_district_ar(html, None) is None
    assert _location_line_district_ar(_page("Riyadh, Al Malqa", "Al Malqa, Riyadh"), "Riyadh") is None


def test_script_text_is_not_a_location_line():
    html = ("<html><head></head><body><script>var a='الغاط, حي المنتزة'; var b='حي المنتزة, الغاط';</script>"
            "</body></html>")
    assert _location_line_district_ar(html, "الغاط") is None


def test_city_side_with_a_sub_area_after_a_dash():
    # real ad 550358: «الغزالة - الروضه, حي الروضة» / «حي الروضة, الغزالة - الروضه»
    html = _page("ارض سكنية للبيع", "الغزالة - الروضه, حي الروضة", "450 م²", "حي الروضة, الغزالة - الروضه")
    assert _location_line_district_ar(html, "الغزالة") == "حي الروضة"


def test_the_sources_own_unspecified_district_is_never_stored():
    # real ad 520164: the page itself says «حي غير محدد»
    html = _page("الكامل, حي غير محدد", "حي غير محدد, الكامل")
    assert _location_line_district_ar(html, "الكامل") is None


def test_real_lines_from_the_reread():
    assert _location_line_district_ar(_page("بقعاء, حي بقعاء القديمة", "حي بقعاء القديمة, بقعاء"), "بقعاء") == "حي بقعاء القديمة"
    assert _location_line_district_ar(_page("ثول, حي بلدة ثول", "حي بلدة ثول, ثول"), "ثول") == "حي بلدة ثول"
