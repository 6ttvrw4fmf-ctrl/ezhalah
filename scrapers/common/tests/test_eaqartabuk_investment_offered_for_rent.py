"""eaqartabuk «استثمار» (operation=investment) states neither sale nor rent; the ad's own words decide.

Backlog 1358 (2026-11-06): 24206284 «هنجر للايجار حي المصيف» (200,000, status «استثمار») was filed Buy because
the mapper read every non-rent operation as a sale. 4 live investment ads: 2 titles say rent, 0 say sale.
An investment ad whose own title/excerpt says rent (and not sale) is a Rent; anything else keeps the old reading.

Run: python -m pytest scrapers/common/tests/test_eaqartabuk_investment_offered_for_rent.py -v
"""
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.eaqartabuk.run import investment_offered_for_rent, map_listing  # noqa: E402


def _item(title, excerpt=""):
    return {"id": 24206284, "title": title, "link": "https://eaqartabuk.com/?p=24206284", "date": "2026-11-04",
            "meta": {"price": "200000"}, "featured_image": None, "excerpt": excerpt}


def _mp(op, status):
    return {"usage": "commercial", "operation": op, "status": status, "city": "تبوك", "district": "المصيف",
            "type": "معرض / هنجر"}


def test_investment_ad_that_says_rent_is_a_rental():
    row, _ = map_listing(_item("هنجر للايجار حي المصيف"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Rent", "the ad's own «للايجار» was filed as a sale"
    row, _ = map_listing(_item("هنجر للإيجار في حي الريان تبوك"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Rent"


def test_investment_ad_without_rent_words_keeps_the_old_reading():
    row, _ = map_listing(_item("معارض في حي المصيف في تبوك"), _mp("investment", "استثمار"), None, [])
    assert row["transaction_type"] == "Buy"
    assert not investment_offered_for_rent("investment", "استثمار", "أرض للبيع أو الإيجار", "")


def test_a_sale_ad_never_becomes_a_rental():
    row, _ = map_listing(_item("هنجر للايجار سابقا"), _mp("sale", "بيع"), None, [])
    assert row["transaction_type"] == "Buy"
