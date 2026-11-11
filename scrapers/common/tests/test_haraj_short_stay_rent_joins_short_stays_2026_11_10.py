"""Backlog 1674 + 1744 (owner 2026-11-10): a Haraj rent whose SELLER states a daily or weekly stay is never
annualised; the row stores the seller's word ('daily' / 'weekly') and joins «إقامات قصيرة».

18749721 «شقه فاخره للاجار اليومي» (licensed, «سعر الوحدة» 350) and 25790932 «شاليه للإيجار اليومي … السعر
300 ريال يوم الخميس» (unlicensed) were served as yearly rents (4,200 / 3,600): the price carried no period of its
own, so the «≤ 10,000 looks monthly» rule made it ×12. The rent phrase states the period → stored, price cleared.
"""
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402
from scrapers.haraj import prose as X  # noqa: E402
from scrapers.haraj import run as R  # noqa: E402
from scrapers.haraj.classify import classify  # noqa: E402

TODAY = date(2026, 11, 10)   # the licence below expires 2027-12-31: pinned so the test never ages out


@pytest.mark.parametrize("title,body,want", [
    ("شقه فاخره للاجار اليومي", "", "daily"),                                          # 18749721
    ("شاليه للإيجار اليومي", "للإيجار اليومي او الأسبوعي وسط الأسبوع", "daily"),        # 25790932
    ("شقة مفروشة", "متوفر ايجار يومي واسبوعي", "daily"),
    ("استراحة للتأجير الأسبوعي", "", "weekly"),
    ("شقة للإيجار", "الايجار 2500 شهري تنظيف يومي", None),       # a daily CLEANING says nothing about the rent
    ("شقة للإيجار السنوي", "", None),
    ("فيلا للبيع", "صيانة اسبوعية", None),
    ("شقة للإيجار", "يمنع الإيجار اليومي", None),                 # a rule the ad forbids is not an offer
    ("شقة للإيجار", "ممنوع التأجير اليومي، متوفر للإيجار الأسبوعي", "weekly"),
    ("فيلا للإيجار اليومي", "", "daily"),                         # «فيلا» ends in «لا»: not a negation
    ("شقة للإيجار الشهري", "الإيجار اليومي ممنوع", None),        # the prohibition can follow the phrase
    ("شقة للإيجار الشهري", "مرفوض الإيجار اليومي", None),
    ("شقة للإيجار اليومي", "ممنوع التدخين", "daily"),             # a rule on the next line is not about the rent
    ("شقة للإيجار اليومي ممنوع التدخين", "", "daily"),            # nor one that goes on to name something else
])
def test_short_stay_is_read_only_from_a_rent_phrase(title, body, want):
    assert X.short_stay_rent(title, body) == want


@pytest.fixture
def catalog(monkeypatch):
    monkeypatch.setattr(R, "resolve", lambda city_ar, district_ar=None, region_hint=None: (
        {"city_id": 3, "region_id": 1} if city_ar == "الرياض" else {"city_id": None, "region_id": None}))
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: None)


def _post(title, body):
    ld = {"@type": "RealEstateListing", "name": title, "description": body, "url": "https://haraj.com.sa/1/x/",
          "address": {"addressLocality": "الرياض"}, "image": []}
    v, why = classify(title, body)
    return R.map_post("11192280051", ld, "", v, why)


def test_unlicensed_daily_chalet_is_not_a_yearly_rent(catalog):
    row, _, skip, _ = _post("شاليه للإيجار اليومي",
                            "للإيجار شاليه جديد ، للإيجار اليومي او الأسبوعي وسط الأسبوع : السعر 300 ريال يوم الخميس")
    assert skip == ""
    # Old code: rent_period 'monthly', price_annual 3600. Now: the seller's word, and an older ×12 is cleared.
    assert row["rent_period"] == "daily" and row["price_annual"] is db.AUTHORITATIVE_NULL
    assert row["additional_info"]["short_stay"] == "daily" and "300" in row["additional_info"]["price_phrase"]


def test_a_stated_monthly_rent_still_pools(catalog):
    row, _, skip, _ = _post("شقة للإيجار", "الايجار 2500 شهري")
    assert skip == "" and (row["rent_period"], row["price_annual"]) == ("monthly", 30000)


def test_short_stay_with_several_prices_still_clears_an_old_monthly(catalog):
    # 20945296: three prices (day / month / year) → no single price is read, and the old «monthly 9,600» stayed.
    row, _, skip, _ = _post("بيت تراثي للإيجار اليومي و الشهري سنوي",
                            "الأسعار: اليوم الواحد: 800 ريال الشهر: 5,000 ريال العرض السنوي: 45,000 ريال")
    assert skip == ""
    assert row["rent_period"] == "daily" and row["price_annual"] is db.AUTHORITATIVE_NULL


def test_a_sale_with_a_rent_phrase_is_never_a_short_stay(catalog):
    row, _, skip, _ = _post("استراحة للبيع", "كانت تستخدم للايجار اليومي")
    assert skip != "" or row["rent_period"] is None


def test_licensed_post_daily_rent_keeps_the_word_and_never_reads_the_licence_block(catalog):
    # A REGA-licensed post (licence block → map_post's licensed path): the seller's text says daily; the licence
    # block is never read for the period (only the text before «معلومات العقار حسب الرخصة»).
    body = ("شقة مفروشة للإيجار اليومي\nمعلومات العقار حسب الرخصة\nغرض الإعلان: إيجار\nسعر الوحدة: 350\n"
            "نوع العقار: شقة\n\n تاريخ انتهاء رخصة الإعلان : 2027-12-31\n-----\nوصف موقع العقار حسب الصك\n"
            "المدينة: الرياض\nالحي: البيان\n")
    ld = {"@type": "RealEstateListing", "name": "شقة للإيجار اليومي", "description": body,
          "url": "https://haraj.com.sa/1/x/", "address": {"addressLocality": "الرياض"}, "image": []}
    v, why = classify(ld["name"], body)
    row, _, skip, _ = R.map_post("18749721", ld, "رقم الترخيص 7201131815", v, why, today=TODAY)
    assert skip == "" and row["license_number"] == "7201131815"
    assert row["rent_period"] == "daily" and row["price_annual"] is db.AUTHORITATIVE_NULL
    assert row["additional_info"]["short_stay"] == "daily" and row["additional_info"]["unit_price_printed"] == "350"
    # A plain «للإيجار اليومي» sits ONLY in the licence block; the seller's own text says monthly → not a short stay.
    lic = body.replace("شقة مفروشة للإيجار اليومي", "شقة مفروشة للإيجار الشهري").replace(
        "نوع العقار: شقة\n", "نوع العقار: شقة\nالالتزامات الآخرى على العقار: متاح للإيجار اليومي\n")
    assert "اليومي" in lic.split("معلومات العقار حسب الرخصة")[1] and "اليومي" not in lic.split("معلومات العقار حسب الرخصة")[0]
    row2, _, skip2, _ = R.map_post("18749722", {**ld, "name": "شقة للإيجار", "description": lic}, "رقم الترخيص 7201131815", v, why, today=TODAY)
    assert skip2 == "" and row2["rent_period"] != "daily" and "short_stay" not in row2["additional_info"]
