"""abwbna: a selling_price the ad's own description states per metre is a rate (2026-10-18).

Ad 39641 (recorded from the public API): selling_price 1100, area 1020, description_ar «… المساحة الاجمالية 1020 متر
… سعر المتر 1100». It was served as a 1,100 SAR total. The other 59 abwbna rows under the city floor were read the
same day: the page shows the figure as «سعر البيع» and their description («أرض للبيع») states no rate, so they stay
totals exactly as published.

Run: python -m pytest scrapers/common/tests/test_abwbna_stated_rate_2026_10_18.py -v
"""
import pytest

from scrapers.abwbna import run as A
from scrapers.common import db

DESC_39641 = ("للبيع ارضين جنب بعض في محاسن الحكومة بالمبرز \n قطعة رقم  276 / 1\nوقطعة رقم 276 / 2\nالمساحة الاجمالية 1020 "
              "متر \n المنطقه الثامنه مخطط رقم 385  \nشارع 20 غرب \n طول الشارع 12 بعمق 34 م سعر المتر 1100")


def _ad(desc, price=1100, purpose="sell"):
    return {"id": 39641, "category": "residential", "purpose": purpose, "type": "land", "area": 1020,
            "selling_price": price, "description_ar": desc, "city": {"name_ar": "الاحساء", "name_en": "Al Ahsa"},
            "district": None, "images": [], "cover_image_url": None}


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(A, "to_catalog", lambda city_ar, region_hint=None: (1, 1))


def test_39641_is_1100_per_metre_and_clears_the_total():
    row, _cat = A.map_listing(_ad(DESC_39641))
    assert row["price_per_meter"] == 1100
    assert row["price_total"] is db.AUTHORITATIVE_NULL


@pytest.mark.parametrize("desc", ["أرض للبيع", None, DESC_39641.replace("سعر المتر 1100", "سعر المتر 1200")])
def test_mutation_no_marker_on_this_figure_keeps_the_published_total(desc):
    row, _cat = A.map_listing(_ad(desc))
    assert row["price_total"] == 1100 and row["price_per_meter"] is None
