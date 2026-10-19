"""Earth App (earthapp.com.sa): the traps measured at onboarding (2026-09-26), on the REAL map_offer.

  · `price` is the site's per-m² field (total_price = price × space). Land → price_per_meter, total None.
  · a whole-property price typed into that field (5,000,000 on a 788 m² عمارة) → price_total.
  · a land «rate» above 50,000 SAR/m² is an agent's total or not — skipped, never guessed.
  · the site's own total_price is never stored; the agent's avatar is never a photo; no PII anywhere.
"""
import datetime as dt
import json

import pytest

import scrapers.earthapp.run as R

TODAY = dt.date(2026, 9, 26)


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, r=None: {"جدة": (18, 2), "مكة المكرمة": (6, 2)}.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي الشبيكة" if "الشبيكة" in t else None)


def _o(**kw):
    o = {"id": 2662828, "status": "active", "active": "yes", "expired_date": "2026-10-11",
         "offer_type": "بيع", "propertyType": "ارض", "using": "سكني",
         "price": "1403.0", "total_price": "1262700.0", "space": "900",
         "city": "مكة المكرمة", "area": "منطقة مكة المكرمة", "district": "الشبيكة الجديد",
         "offer_details": "ارض للبيع مساحة 900 للتواصل مع الوسيطة AGENT NAME جوال 0551234567 رخصة فال : 1200018166",
         "user_name": "AGENT NAME", "user_mobile": "583437788", "user_license_number": "1200018166",
         "user_image": "https://earthapp.com.sa/storage/user/avatar.png", "user_id": 62100,
         "responsibleEmployeeName": "EMPLOYEE NAME", "responsibleEmployeePhone": "0583437788",
         "ad_license_number": "7201028521", "ad_source": "الهيئة العامة للعقار",
         "view": [{"title": "جنوبية"}], "street_width": "32", "property_age": "-"}
    o.update(kw)
    return o


def test_land_price_is_per_metre_and_the_total_stays_unknown():
    (row, cat), why = R.map_offer(_o(), TODAY)
    assert why == "" and cat == "residential" and row["property_type"] == "Residential Land"
    assert row["price_per_meter"] == 1403.0 and row["price_total"] is None
    assert row["price_evidence"]["unit"] == "per_meter"


def test_a_whole_property_price_in_the_per_metre_field_is_the_total():
    (row, _), why = R.map_offer(_o(propertyType="عمارة", price="5000000.0", space="788.3",
                                   total_price="3941500000.0"), TODAY)
    assert why == "" and row["property_type"] == "Building"
    assert row["price_total"] == 5_000_000 and row["price_per_meter"] is None


def test_a_non_land_per_metre_rate_stays_per_metre():
    (row, _), _ = R.map_offer(_o(propertyType="دور", price="3097.2", space="387.54"), TODAY)
    assert row["price_per_meter"] == 3097.2 and row["price_total"] is None


def test_an_implausible_land_rate_is_skipped_not_guessed():
    got, why = R.map_offer(_o(price="4248000.0", space="945.26"), TODAY)
    assert got is None and why == "land price ambiguous"
    assert R.map_offer(_o(price="50000"), TODAY)[1] == ""          # the threshold itself is still a rate


def test_the_sites_total_the_avatar_and_pii_are_never_stored():
    (row, _), _ = R.map_offer(_o(), TODAY)
    assert row["photo_urls"] is None
    blob = json.dumps(row, ensure_ascii=False)
    for banned in ("avatar.png", "AGENT NAME", "EMPLOYEE NAME", "583437788", "1200018166", "62100",
                   "0551234567", "1262700"):
        assert banned not in blob, banned
    assert row["license_number"] == "7201028521"                    # the AD licence is kept (dedupe)
    # a DIFFERENT person named beside a phone (live ad 2662798) is scrubbed too
    (row, _), _ = R.map_offer(_o(offer_details="أرض للبيع الوسيط: OTHER PERSON 📞 0551234567"), TODAY)
    assert "OTHER PERSON" not in json.dumps(row, ensure_ascii=False)


def test_rent_period_is_unstated_and_expired_is_skipped():
    (row, _), _ = R.map_offer(_o(offer_type="إيجار"), TODAY)
    assert row["transaction_type"] == "Rent" and row["rent_period"] is None and row["price_annual"] is None
    assert R.map_offer(_o(expired_date="2026-09-25"), TODAY) == (None, "licence_expired")


def test_a_district_must_be_the_whole_field_not_one_word_of_it():
    (row, _), _ = R.map_offer(_o(), TODAY)
    assert row["district_ar"] is None and row["neighborhood"] == "الشبيكة الجديد"


def test_a_non_land_rent_is_refused_never_read_as_a_per_metre_rate():
    # A 40,000/yr rest house must not print as «سعر المتر 40,000»: the field cannot say which it is.
    from scrapers.earthapp.run import classify_price
    assert classify_price("Rest House", 40_000.0, "Rent") == (None, "non-land rent price ambiguous")
    assert classify_price("Building", 900_000.0, "Rent") == (None, "non-land rent price ambiguous")
    # Land rent keeps the site's designed per-m² meaning; sales are untouched.
    assert classify_price("Residential Land", 472.4, "Rent") == ("per_meter", "")
    assert classify_price("Building", 5_000_000.0, "Buy") == ("total", "")
