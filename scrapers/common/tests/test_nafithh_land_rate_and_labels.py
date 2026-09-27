"""Nafithh: a land «سعر الوحدة» is the METRE rate (ad 217: 7,900 × 1,902.5 = its stated 15,029,750)."""
import pytest

import scrapers.nafithh.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (18, 2) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _page(deal, type_ar, price, extra=""):
    pairs = {"غرض الإعلان": deal, "نوع العقار": type_ar, "سعر الوحدة": price, "مساحة العقار": "1902.5 م²",
             "المدينة": "جدة", "اسم الموظف المسؤول": "ضيف الله الزهراني", "رقم هاتف الموظف المسؤول": "0551228113"}
    body = "".join(f'<div class="lableShow">{k}</div> <div class="showData" itemprop="x">{v}</div>'
                   for k, v in pairs.items())
    return f"<title>معرض نافذة - {extra or 'عقار'}</title>{body}"


def test_land_stores_the_rate_never_a_total():
    (row, _), why = R.map_listing("217", R.parse_detail(_page("بيع", "ارض", "7900")))
    assert why == "" and row["price_per_meter"] == 7900 and "price_total" not in row


def test_a_building_price_is_the_total():
    (row, _), _ = R.map_listing("208", R.parse_detail(_page("بيع", "عمارة", "6300000")))
    assert row["price_total"] == 6300000


def test_the_titles_own_period_makes_a_large_rent_monthly():
    d = R.parse_detail(_page("إيجار", "غرفة", "16000", "غرف واجنحة مفروشة للايجار الشهري"))
    (row, _), _ = R.map_listing("178", d)
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 192000)


def test_the_officer_is_never_stored():
    (row, _), _ = R.map_listing("217", R.parse_detail(_page("بيع", "ارض", "7900")))
    assert "0551228113" not in str(row) and "ضيف الله" not in str(row)
