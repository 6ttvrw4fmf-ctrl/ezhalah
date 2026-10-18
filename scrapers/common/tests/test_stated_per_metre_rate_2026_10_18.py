"""A price is a RATE only when the ad's own text states THAT figure per metre (owner 2026-10-18, «we can get sued»).

mustqr 4993 (recorded from its public API, 2026-10-18): price = price_som = 1100 on a 375 m² plot, and the ad's own
text says «السوم للمتر 1100». It was stored as a 1,100 SAR total. The marker must sit right before or after the same
figure; no marker keeps the figure as the total exactly as published (PRICE = SOURCE). mustqr's text is raw_text,
which is PII and never fetched: its PostgREST evaluates rate_regex() server-side and returns ids only, so the same
regex is proven here in Python on the recorded price line (verbatim, nothing personal in it).

Run: python -m pytest scrapers/common/tests/test_stated_per_metre_rate_2026_10_18.py -v
"""
import re

import pytest

from scrapers.common import normalize as N
import scrapers.mustqr.run as M
from scrapers.common import db

REC_4993 = {"id": 4993, "status": "متاح", "type": "أرض", "category": "بيع", "usage_type": "سكني", "area_sqm": 375,
            "neighborhood": "الشبيلي", "title": "للبيع ارض سكنيه في حي الشبيلي", "description": None,
            "price": 1100, "price_som": 1100, "price_had": None, "price_type": None}
LINE_4993 = "📌 شارع غربي 13.14م بطول 12.5م ‏⭕️ السوم للمتر 1100 والبيع قريب"


def test_4993_server_verdict_makes_it_1100_per_metre_and_no_total():
    assert re.search(M.rate_regex(1100), LINE_4993)
    assert re.search(M._ANY_RATE_WORD, LINE_4993)                       # the one-call prefilter keeps it
    assert M._price_fields({**REC_4993, "_rate_stated": True}, is_rent=False) == {
        "price_per_meter": 1100, "price_total": db.AUTHORITATIVE_NULL}           # clears the stored 1,100 total
    assert M._price_fields(REC_4993, is_rent=False) == {"price_total": 1100}   # no verdict: the published total


@pytest.mark.parametrize("line", [
    "📌 شارع غربي 13.14م بطول 12.5م ⭕️ السوم 1100 والبيع قريب",          # no marker
    "السوم للمتر 1200 والبيع قريب",                                     # a rate for ANOTHER figure
    "المساحة 1100 متر",                                                  # a bare «متر» after a figure is an area
    "السوم للمتر 11000",                                                 # 1100 inside a bigger number
    "السوم للمتر 21100",
    "سعر 21100 ريال للمتر",                                              # …on either side of the marker
])
def test_mutation_no_marker_on_this_figure_is_no_rate(line):
    assert not re.search(M.rate_regex(1100), line)
    assert not N.stated_per_metre(line, 1100)


@pytest.mark.parametrize("text, n", [
    ("الحد ( 550 ريال للمتر )", 550),             # sadiqeltajer 5562's description
    ("السوم للمتر 1100", 1100),                   # mustqr 4993
    ("سعر المتر: ٧٥٠", 750),                      # Arabic digits
    ("عليها سوم 1,100 ريال/م²", 1100),            # thousands separator, «/م²»
])
def test_both_readers_find_a_stated_rate(text, n):
    assert N.stated_per_metre(text, n)
    assert re.search(M.rate_regex(n), text)


def test_raw_text_is_still_never_fetched():
    assert "raw_text" not in M._PROPERTIES_COLUMNS.split(",")
