"""Backlog 1674 (⚡ 2026-11-10): a Haraj rent whose SELLER states a daily or weekly stay is never annualised.

18749721 «شقه فاخره للاجار اليومي» (licensed, «سعر الوحدة» 350) and 25790932 «شاليه للإيجار اليومي … السعر
300 ريال يوم الخميس» (unlicensed) were served as yearly rents (4,200 / 3,600): the price carried no period of its
own, so the «≤ 10,000 looks monthly» rule made it ×12. The rent phrase states the period → no bucket → cleared.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.haraj import prose as X  # noqa: E402
from scrapers.haraj import run as R  # noqa: E402
from scrapers.haraj.classify import classify  # noqa: E402


@pytest.mark.parametrize("title,body,want", [
    ("شقه فاخره للاجار اليومي", "", "daily"),                                          # 18749721
    ("شاليه للإيجار اليومي", "للإيجار اليومي او الأسبوعي وسط الأسبوع", "daily"),        # 25790932
    ("شقة مفروشة", "متوفر ايجار يومي واسبوعي", "daily"),
    ("استراحة للتأجير الأسبوعي", "", "weekly"),
    ("شقة للإيجار", "الايجار 2500 شهري تنظيف يومي", None),       # a daily CLEANING says nothing about the rent
    ("شقة للإيجار السنوي", "", None),
    ("فيلا للبيع", "صيانة اسبوعية", None),
])
def test_short_stay_is_read_only_from_a_rent_phrase(title, body, want):
    assert X.short_stay_rent(title, body) == want


@pytest.fixture
def catalog(monkeypatch):
    monkeypatch.setattr(R, "resolve", lambda city_ar, district_ar=None, region_hint=None: (
        {"city_id": 3, "region_id": 1} if city_ar == "الرياض" else {"city_id": None, "region_id": None}))
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: None)


def _post(title, body, *, verdict=None):
    ld = {"@type": "RealEstateListing", "name": title, "description": body, "url": "https://haraj.com.sa/1/x/",
          "address": {"addressLocality": "الرياض"}, "image": []}
    v, why = classify(title, body) if verdict is None else (verdict, "mapping unit test")
    return R.map_post("11192280051", ld, "", v, why)


def test_unlicensed_daily_chalet_is_not_a_yearly_rent(catalog):
    row, _, skip, _ = _post("شاليه للإيجار اليومي",
                            "للإيجار شاليه جديد ، للإيجار اليومي او الأسبوعي وسط الأسبوع : السعر 300 ريال يوم الخميس")
    assert skip == ""
    # Old code: rent_period 'monthly', price_annual 3600. Now: settled absent, so an older ×12 is cleared.
    assert row["rent_period"] is db.AUTHORITATIVE_NULL and row["price_annual"] is db.AUTHORITATIVE_NULL


def test_a_stated_monthly_rent_still_pools(catalog):
    row, _, skip, _ = _post("شقة للإيجار", "الايجار 2500 شهري")
    assert skip == "" and (row["rent_period"], row["price_annual"]) == ("monthly", 30000)


@pytest.mark.parametrize("phrase,want", [
    ("لِلْإِيجَارِ الْيَوْمِيّ", "daily"),
    ("إيجار يومية", "daily"),
    ("للإيجار يومياً", "daily"),
    ("للإجـار اليومي", "daily"),
    ("التأجير الأسبوعي", "weekly"),
    ("أجار أسبوعية", "weekly"),
    ("تأجير أسبوعياً", "weekly"),
    ("للإيجار\nالأسبوعي", "weekly"),
])
@pytest.mark.parametrize("in_title", [True, False], ids=["title", "body"])
def test_short_stay_normalises_seller_spelling(phrase, want, in_title):
    title, body = (f"شقة ({phrase})", "") if in_title else ("شقة مفروشة", f"متوفر: {phrase}.")
    assert X.short_stay_rent(title, body) == want


@pytest.mark.parametrize("body", [
    "", "السعر اليومي 350 ريال", "تنظيف يومي وصيانة أسبوعية",
    "للإيجار الشهري مع تنظيف يومي", "للإيجار السنوي وصيانة أسبوعية",
    "للإيجار يوميات", "للإيجار اسبوعيات", "غيرايجار يومي", "ايجار يوميabc",
])
def test_short_stay_requires_a_complete_rent_period_phrase(body):
    assert X.short_stay_rent("شقة", body) is None


@pytest.mark.parametrize("title,body", [
    ("شقة للإيجار الأسبوعي", "السعر 2100 ريال"),
    ("شقة للإيجار", "للتأجير الأسبوعي\nالسعر 2100 ريال"),
    ("شقة للإيجار اليومي", "السعر 2500 شهري"),
    ("شقة للإيجار الأسبوعي", "السعر 40000 سنوي"),
    # A period attached to the price must clear old annualisation too, even without a short-stay rent phrase.
    ("شقة للإيجار", "السعر اليومي 350 ريال"),
])
def test_unlicensed_short_stay_clears_previously_stored_rent(catalog, title, body):
    row, _, skip, facts = _post(title, body)
    assert skip == "" and facts["licensed"] is False
    assert row["transaction_type"] == "Rent"
    assert row["rent_period"] is db.AUTHORITATIVE_NULL
    assert row["price_annual"] is db.AUTHORITATIVE_NULL
    assert row["price_total"] is None
    # Exercise the actual write guard: plain None would disappear and leave the old ×12 in place.
    payload = row.copy()
    db._unknown_must_not_overwrite_known(payload)
    previous = {"rent_period": "monthly", "price_annual": 4200}
    previous.update(payload)
    assert previous["rent_period"] is None and previous["price_annual"] is None


@pytest.mark.parametrize("body,period,annual", [
    ("الايجار 2500 شهري مع تنظيف يومي", "monthly", 30000),
    ("الايجار 40000 سنوي مع صيانة أسبوعية", "annual", 40000),
    ("السعر 350 ريال", "monthly", 4200),
])
def test_unlicensed_non_short_stay_keeps_its_price_rules(catalog, body, period, annual):
    # Classification of service words is separate; exercise the rent mapper for an accepted offer.
    row, _, skip, _ = _post("شقة للإيجار", body, verdict="offer")
    assert skip == ""
    assert (row["rent_period"], row["price_annual"]) == (period, annual)


def test_short_stay_phrase_does_not_clear_a_sale_price(catalog):
    row, _, skip, _ = _post("شقة للبيع", "كانت للإيجار اليومي\nالسعر 500000 ريال")
    assert skip == ""
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 500000
    assert row["price_annual"] is None and row["rent_period"] is None
