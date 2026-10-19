"""Dallali: the page shows the UNIT; the REGA licence describes the BUILDING (measured 2026-09-26)."""
import json

import pytest

import scrapers.dallali.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي الربيع" if t else None)


def _x(**kw):
    x = {"id": "fa37", "is_active": True, "listing_type": "rent", "title": "مجمع مكاتب", "description": "",
         "price": 178508, "image_urls": ["https://x/1.jpg"], "ad_license_number": "7201113932",
         "unit": {"unit_type": "office", "area": 81.14, "bedrooms": 0, "bathrooms": 0},
         "rega_display_data": {"advertisementType": "إيجار", "propertyType": "مجمع", "propertyArea": 3658.11,
                               "propertyPrice": 178508, "phoneNumber": "0504217318",
                               "responsibleEmployeeName": "عبدالرحمن البتيري", "deedNumber": "20256414922",
                               "location": {"city": "الرياض", "district": "الربيع"}}}
    x.update(kw)
    return x


def test_type_and_area_are_the_units_not_the_licences():
    (row, cat), why = R.map_listing(_x())
    assert why == "" and row["property_type"] == "Office" and row["area_m2"] == 81.14 and cat == "commercial"


def test_a_yearly_looking_rent_stays_yearly_and_a_small_one_is_monthly():
    assert R.map_listing(_x())[0][0]["price_annual"] == 178508
    small = R.map_listing(_x(price=4500))[0][0]
    assert (small["rent_period"], small["price_annual"]) == ("monthly", 54000)


def test_a_deal_conflict_with_the_licence_is_skipped():
    x = _x()
    x["rega_display_data"]["advertisementType"] = "بيع"
    assert R.map_listing(x) == (None, "deal_conflict_Rent_vs_Buy")


def test_the_officer_phone_and_deed_are_never_stored():
    blob = json.dumps(R.map_listing(_x())[0][0], ensure_ascii=False, default=str)
    for secret in ("0504217318", "عبدالرحمن البتيري", "20256414922"):
        assert secret not in blob
