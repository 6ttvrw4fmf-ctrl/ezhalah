"""Maktab: only an office whose REGA ad licence is still in date is a listing; a price that only makes
sense monthly is monthly even when tagged «سنوي» (owner 2026-09-26); names and phones never land."""
import datetime
import json

import pytest

import scrapers.maktab.run as R

T = datetime.date(2026, 9, 28)


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (21, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: {"طويق": "حي طويق"}.get(t))


def _office(price="65000.00", period="سنوي", kind="مكتب غير مؤثث", end="2027-08-01", halted=False, ad_type="إيجار"):
    return {
        "id": 92, "status": "1", "active": "1", "deleted_at": None, "title": "مكتب للإيجار في طويق",
        "description": "مكاتب تجارية للتواصل 0556858055", "space": "128.00", "street_width": "0",
        "category_aqar": {"ar_name": kind}, "license_number": "7201089509", "license_end_date": end,
        "ads_prices": [{"price": price, "status": "1", "type_res": {"ar_name": period}}],
        "location": {"city": "الرياض", "neighborhood": "طويق", "region": "منطقة الرياض"},
        "property_utilities": [{"code": "Electricity"}, {"code": "Waters"}],
        "property_age": {"name_ar": "جديد"}, "main_image": "assets/images/offices/images/1.webp", "ads_files": [],
        "viewer_name": "اسم المعلن", "viewer_phone": "0556858055",
        "license_data": {"advertisementType": ad_type, "isHalted": halted, "responsibleEmployeeName": "اسم الموظف",
                         "phoneNumber": "0556858055"},
    }


def test_an_in_licence_yearly_office_keeps_its_yearly_price():
    row, cat, why = R.map_office(_office(), T)
    assert why == "" and cat == "commercial" and row["property_type"] == "Office"
    assert (row["transaction_type"], row["rent_period"], row["price_annual"]) == ("Rent", "annual", 65000)
    assert row["district_ar"] == "حي طويق" and row["furnished"] is False and row["license_expiry"] == "2027-08-01"
    assert row["photo_urls"] == ["https://backend.maktab.sa/assets/images/offices/images/1.webp"]


def test_a_monthly_looking_price_tagged_yearly_is_monthly():
    row, _, _ = R.map_office(_office(price="1000.00", kind="مكتب مؤثث"), T)
    assert (row["rent_period"], row["price_annual"], row["furnished"]) == ("monthly", 12000, True)
    assert row["additional_info"]["price_period_label"] == "سنوي"


def test_an_expired_or_halted_licence_or_a_non_office_is_never_a_listing():
    assert R.map_office(_office(end="2026-09-27"), T)[2] == "ad_end_date_expired"
    assert R.map_office(_office(end=None), T)[2] == "ad_end_date_unknown"
    assert R.map_office(_office(halted=True), T)[2] == "rega_licence_halted"
    assert R.map_office(_office(kind="قاعة اجتماعات"), T)[2] == "kind_قاعة اجتماعات"


def test_names_and_phones_never_land_on_the_row():
    blob = json.dumps(R.map_office(_office(), T)[0], ensure_ascii=False)
    assert "0556858055" not in blob and "اسم الموظف" not in blob and "اسم المعلن" not in blob
