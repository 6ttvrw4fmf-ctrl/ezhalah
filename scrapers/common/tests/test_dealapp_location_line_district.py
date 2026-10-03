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
