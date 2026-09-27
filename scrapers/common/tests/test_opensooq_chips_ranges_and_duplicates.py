"""OpenSooq: the card chips carry period/age/rooms; an age RANGE is not an exact age."""
import json

import pytest

import scrapers.opensooq.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (18, 2) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _x(cps, **kw):
    x = {"id": 1, "cat1_code": "RealEstateForRent", "cat2_code": "ApartmentsForRent", "title": "شقة",
         "price_amount": "66,000 ريال", "city_label": "الرياض", "nhood_label": "النزهة", "cps": cps,
         "member_display_name": "مؤسسة حاتم", "phone_number": "05970006XX"}
    x.update(kw)
    return x


def test_the_listings_own_monthly_chip_is_kept_even_for_a_large_price():
    (row, _), _ = R.map_listing(_x(["٢ غرفتا نوم", "شهري", "المساحة: 20 م٢"]))
    assert (row["rent_period"], row["price_annual"], row["bedrooms"]) == ("monthly", 792000, 2)


def test_the_area_units_own_digit_is_not_part_of_the_area():
    # «م٢» ends in an Arabic-Indic 2 — «708 م٢» once became 7082
    assert R._chip_num(["مساحة الأرض: 708 م٢"], "مساحة الأرض:") == 708
    assert R._chip_num(["المساحة: 1,250.5 م٢"], "المساحة:") == 1250.5
    assert R.map_listing(_x(["المساحة: 20 م٢"]))[0][0]["area_m2"] == 20


def test_an_age_range_is_not_an_exact_age():
    sale = dict(cat1_code="RealEstateForSale", cat2_code="ApartmentsForSale", price_amount="650,000 ريال")
    assert R.map_listing(_x(["عمر البناء: 0 - 11 شهر"], **sale))[0][0]["property_age"] == 0
    assert R.map_listing(_x(["عمر البناء: 1 - 5 سنوات"], **sale))[0][0]["property_age"] is None


def test_under_construction_and_a_title_deal_conflict_skip():
    sale = dict(cat1_code="RealEstateForSale", cat2_code="ApartmentsForSale")
    assert R.map_listing(_x(["عمر البناء: قيد الإنشاء"], **sale))[0] is None
    assert R.map_listing(_x([], title="للإيجار فيلا", **sale))[1] == "deal_conflict_Buy_vs_Rent"


def test_the_member_and_phone_are_never_stored():
    blob = json.dumps(R.map_listing(_x(["شهري"]))[0][0], ensure_ascii=False, default=str)
    assert "مؤسسة حاتم" not in blob and "05970006XX" not in blob
