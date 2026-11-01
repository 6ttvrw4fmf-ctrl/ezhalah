"""ksaaqar: the card's price figure is read EXACTLY — a fraction is never cut to whole riyals (2026-10-18).

/ad/‏فيلا-بالهدا-المربع-الرابع-دور-وشقتي/ (12226125) prints «<h3>1.20ريال </h3>» in its own summary card; own_price()
did int(float(...)) and stored 1. The price columns hold whole riyals, so a figure with a real fraction is not
stored as a price at all (the stored «1» clears — AUTHORITATIVE_NULL) and the card text is kept verbatim in
additional_info.price_published_text. A whole figure («3,200.00», Arabic digits «٣٬٢٠٠٫٠٠») is unchanged.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

import scrapers.common.db as db
import scrapers.ksaaqar.run as K

LINK = "https://ksaaqar.com/ad/%e2%80%8f%d9%81%d9%8a%d9%84%d8%a7-%d8%a8%d8%a7%d9%84%d9%87%d8%af%d8%a7/"


def _card(price_h3):
    return ('<h3 class="recent-ads-list-title"><a\n                                                href="' + LINK +
            '">‏فيلا بالهدا المربع الرابع</a></h3>\n                                    '
            f'<div class="recent-ads-list-price"><h3>{price_h3} </h3><span class="negotiable">&nbsp;(قابل للتفاوض)</span></div>')


@pytest.mark.parametrize("h3, figure, whole", [
    ("1.20ريال", Decimal("1.20"), None),            # recorded, 12226125
    ("1.60ريال", Decimal("1.60"), None),
    ("3,200.00ريال", Decimal("3200.00"), 3200),     # recorded on another live ad
    ("٣٬٢٠٠٫٠٠ريال", Decimal("3200.00"), 3200),     # the same figure in Arabic digits and separators
    ("١٫٢٠ريال", Decimal("1.20"), None),
    ("50,000.00SAR", Decimal("50000.00"), 50000),
])
def test_the_figure_is_exact_and_only_a_whole_one_is_a_price(h3, figure, whole):
    assert K.own_price_figure(_card(h3), LINK) == figure
    assert K.own_price(_card(h3), LINK) == whole


@pytest.fixture
def _hermetic(monkeypatch):
    monkeypatch.setattr(K, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(K, "find_district_in_text", lambda text, city_id: None)
    monkeypatch.setattr(K, "known_district_keys", lambda city_id: set())


@pytest.mark.parametrize("deal, field", [("للبيع", "price_total"), ("للإيجار", "price_annual")])
def test_a_fractional_figure_clears_the_stored_price_and_keeps_the_card_text(_hermetic, deal, field):
    post = {"id": 1, "link": LINK, "title": {"rendered": "فلل > فلل للبيع"}, "content": {"rendered": ""}, "class_list": []}
    text = f"الدولة: عقارات الرياض الحالة: جديدة النوع: {deal} نوع العقار : سكني"
    row, _cat, why = K.map_listing(post, text, _card("1.20ريال"))
    assert row is not None, why
    assert row[field] is db.AUTHORITATIVE_NULL
    assert row["additional_info"]["price_published_text"] == "1.20 ريال"
    row, _cat, why = K.map_listing(post, text, _card("3,200.00ريال"))
    assert row.get("price_total") == 3200 or row.get("price_annual") is not None
