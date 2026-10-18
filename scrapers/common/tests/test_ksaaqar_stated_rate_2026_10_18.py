"""ksaaqar: the card's figure is a RATE when the ad's own description states that figure per metre (2026-10-18).

Ad 12225861: the share card prints «6,400.00 ريال» for a 202 m² plot, the description «السوم 6300 للمتر شور 6400 ريال
للمتر». It was served as a 6,400 SAR total. Of the 14 ksaaqar rows under the city floor (read 2026-10-18) three state
their figure per metre (12225861, 12225868 «سعر اللمتر 2350», 12226415 «السعر ٢٣٥٠ للمتر»); the other 11 show the
card figure as the price with no rate and stay totals (PRICE = SOURCE). Fixture: recorded, markup reduced.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_stated_rate_2026_10_18.py -v
"""
from pathlib import Path

import pytest

import scrapers.ksaaqar.run as K

HTML = (Path(__file__).resolve().parents[2] / "ksaaqar" / "testdata" / "12225861.excerpt.html").read_text(encoding="utf-8")
LINK = ("https://ksaaqar.com/ad/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d9%81%d9%8a-"
        "%d8%ad%d9%8a-%d8%af%d8%b1%d8%a9-%d8%a7%d9%84%d9%8a%d8%a7%d8%b3%d9%85%d9%8a%d9%86-%d8%b2%d8%a7%d9%88%d9%8a/")


def test_12225861_card_figure_is_6400_per_metre():
    price = K.own_price(HTML, LINK)
    assert price == 6400
    assert K.stated_rate(HTML, price) == 6400


@pytest.mark.parametrize("line", [
    "السوم 6300 للمتر شور",                        # the rate is about ANOTHER figure
    "السعر 6400 ريال نهائي",                        # no marker on this figure
    "السعر 64000 ريال للمتر",                      # 6400 inside a bigger number
])
def test_mutation_no_marker_on_this_figure_keeps_the_total(line):
    html = HTML.replace("السوم 6300 للمتر شور 6400 ريال للمتر", line)
    assert K.stated_rate(html, K.own_price(html, LINK)) is None


def test_the_three_recorded_descriptions_state_their_rate():
    assert K.normalize.stated_per_metre("مساحه 700 متر جنوبيه علي شارع 16 سعر اللمتر 2350 قريبه من البحر", 2350)
    assert K.normalize.stated_per_metre("مساحه 700متر شارع 16جنوبي السعر ٢٣٥٠ للمتر", 2350)
