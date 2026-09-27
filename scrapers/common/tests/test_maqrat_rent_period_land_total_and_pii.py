"""MAQRAT: the traps measured at onboarding (2026-09-26), on the REAL scraper functions.

  · Every rent card says «سنويًا»; the AD'S OWN TEXT decides the period of ITS price (owner 09-26).
  · No period tied to the price: a price no unit rents for per YEAR (≤ 10,000) is monthly.
  · For LAND sales the page prints the per-m² rate AND the total; the total is stored.
  · The licence block names the ad officer and his mobile — never stored anywhere.
  · The page renders OTHER listings' thumbnails; only this id's photos are kept.
"""
import json

import pytest

import scrapers.maqrat.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (15, 4) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي النور" if t else None)


def _rent(price, desc="", title="غرفة للإيجار"):
    kv = {"نوع العقار": "شقة", "سعر الوحدة": str(price), "المدينة": "الرياض", "المنطقة": "منطقة الرياض"}
    (row, _), why = R.map_listing("23", {"deal": "للإيجار"}, {"kv": kv, "title": title, "description": desc,
                                                               "services": [], "photos": []})
    assert why == ""
    return row["rent_period"], row["price_annual"]


def test_a_price_the_ad_calls_monthly_is_monthly():
    assert _rent(1800, "الإيجار 1800 ريال سعودي شهريًا") == ("monthly", 21600)


def test_a_monthly_figure_whose_twelve_times_is_the_price_makes_it_yearly():
    assert _rent(45600, "3,800 ريال شهريًا") == ("annual", 45600)
    assert _rent(9600, "800 ريال شهريًا") == ("annual", 9600)          # the ad's text beats the magnitude cut


def test_a_small_price_the_ad_calls_yearly_stays_yearly():
    assert _rent(9000, "الإيجار ٩٬٠٠٠ ريال سنويًا") == ("annual", 9000)  # Arabic-Indic digits read the same


def test_an_untied_price_is_judged_by_magnitude_not_the_card():
    assert _rent(4500) == ("monthly", 54000)       # the card says «سنويًا»; no unit rents for 4,500 a year
    assert _rent(30000) == ("annual", 30000)


LAND = {"نوع العقار": "أرض", "سعر المتر": "1,550", "إجمالي سعر بيع الأرض": "930,000",
        "اسم مسؤول الإعلان": "سلطان عبد الله", "رقم جوال مسؤول الإعلان": "0592431010"}


def _land():
    (row, _), why = R.map_listing("7", {"deal": "للبيع"}, {"kv": LAND, "title": "أرض للبيع",
                                                         "description": "", "services": [], "photos": []})
    assert why == ""
    return row


def test_land_stores_the_published_total_not_the_rate():
    row = _land()
    assert row["price_total"] == 930000 and row["price_per_meter"] == 1550


def test_the_ad_officer_is_never_stored():
    blob = json.dumps(_land(), ensure_ascii=False, default=str)
    assert "سلطان عبد الله" not in blob and "0592431010" not in blob


def test_only_this_listings_photos_are_kept():
    page = ('<img src="https://api.maqrat.com/uploads/properties/Property_7_ab12_main.webp">'
            '<img src="https://api.maqrat.com/uploads/properties/Property_7_ab12_thumb.webp">'
            '<img src="https://api.maqrat.com/uploads/properties/Property_52_cd34_thumb.webp">')
    assert R.parse_detail(page, "7")["photos"] == ["https://api.maqrat.com/uploads/properties/Property_7_ab12_main.webp"]
