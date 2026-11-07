"""Property Finder (staged 2026-11-04): PRICE = SOURCE, PERIOD = SOURCE, PDPL, off-plan hidden, polite crawler.

The ad below is the real 2026-11-04 shape of searchResult.listings[i].property (Riyadh, ad 52394526) with the
person fields replaced by obvious fakes — the test proves they never reach a stored row.
"""
from __future__ import annotations

import json

import pytest

from scrapers.propertyfinder import crawl as C
from scrapers.propertyfinder import run as R

FAKE_PHONE = "0570000000"
FAKE_MAIL = "someone@example.com"


def _ad(**over):
    p = {
        "id": "52394526", "category_id": 1, "property_type": "شقة", "offering_type": "للبيع",
        "price": {"value": 2100000, "currency": "SAR", "period": "sell", "is_hidden": False},
        "title": "شقة للبيع في حي الملك فهد", "description": f"شقة 3 غرف مع مطبخ ومصعد للتواصل {FAKE_PHONE}",
        "location": {"full_name": "الملك فهد, الرياض, الرياض", "type": "DISTRICT",
                     "coordinates": {"lat": 24.74589729309082, "lon": 46.66870880126953}},
        "location_tree": [{"id": "4", "name": "الرياض", "type": "REGION", "slug_en": "ar-riyadh"},
                          {"id": "8216", "name": "الرياض", "type": "CITY", "slug_en": "riyadh"},
                          {"id": "8380", "name": "الملك فهد", "type": "DISTRICT", "slug_en": "riyadh-king-fahd"}],
        "images": [{"small": "https://static.shared.propertyfinder.sa/a.jpg", "medium": "https://static.shared.propertyfinder.sa/a.jpg"}],
        "agent": {"id": 1, "name": "وكيل مزيف", "email": FAKE_MAIL},
        "broker": {"id": 2, "name": "وسيط مزيف", "phone": FAKE_PHONE, "email": FAKE_MAIL},
        "client": {"id": 2, "name": "وسيط مزيف", "phone": FAKE_PHONE, "email": FAKE_MAIL},
        "contact_options": [{"type": "phone", "value": FAKE_PHONE}, {"type": "email", "value": FAKE_MAIL}],
        "bedrooms": "3", "bedrooms_value": 3, "bathrooms": "7+", "bathrooms_value": 8,
        "size": {"value": 142, "unit": "sqm"}, "rera": "7200911553", "furnished": "PARTLY",
        "completion_status": "completed", "amenity_names": ["كهرباء", "مياه", "هاتف"], "payment_method": [],
        "rnpm": {"enabled": False}, "is_available": True, "is_great_value": True, "is_high_demand": True,
        "details_path": "/ar/plp/buy/apartment-for-sale-ar-riyadh-king-fahd-52394526.html",
        "listed_date": "2026-11-03T15:33:31Z", "price_per_area": {"price": 14788, "unit": "sqm"},
    }
    p.update(over)
    return p


@pytest.fixture(autouse=True)
def _no_catalogue(monkeypatch):
    # the shared resolver reads the location catalogue from the database; the mapping is what is tested here
    monkeypatch.setattr(R, "resolve", lambda city, district=None, region_hint=None:
                        {"city_ar": city, "city_id": 3, "region_id": 1})
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: "الملك فهد" if d == "الملك فهد" else None)


def _row(p, deal="Buy", cat="residential"):
    got, why = R.map_listing(p, deal, cat)
    assert got, why
    return got[0]


def test_sale_price_is_the_source_number_and_nothing_derived():
    r = _row(_ad())
    assert r["price_total"] == 2100000 and "price_annual" not in r and "price_per_meter" not in r
    assert r["price_evidence"]["raw"] == 2100000 and r["price_evidence"]["origin"] == "api"
    assert (r["area_m2"], r["bedrooms"], r["bathrooms"]) == (142, 3, 8)       # «7+» is the source's own 8
    assert r["license_number"] == "7200911553" and r["district_ar"] == "الملك فهد"
    assert r["additional_info"]["rega_ad_license_number"] == "7200911553"   # the card's «رقم رخصة الإعلان» row
    assert r["additional_info"]["latitude"] == pytest.approx(24.74589729) and r["furnished"] is None   # PARTLY


def test_rent_period_maps_straight_across():
    yearly = _row(_ad(offering_type="للايجار", price={"value": 85000, "period": "yearly"}), deal="Rent")
    assert (yearly["rent_period"], yearly["price_annual"]) == ("annual", 85000)
    monthly = _row(_ad(offering_type="للايجار", price={"value": 4500, "period": "monthly"}), deal="Rent")
    # the fleet's storage convention: the app shows price_annual / 12 = the source's 4,500
    assert (monthly["rent_period"], monthly["price_annual"]) == ("monthly", 54000)
    daily = _row(_ad(offering_type="للايجار", price={"value": 600, "period": "daily"}), deal="Rent")
    assert daily.get("rent_period") is None and daily.get("price_annual") is None   # no bucket, never ×365
    assert daily["price_evidence"]["raw"] == 600 and daily["additional_info"]["price_period"] == "daily"


def test_cheap_yearly_residential_rent_is_stored_monthly_owner_2026_11_04():
    # «yearly» 3,900 on a home = a per-month price: stored monthly ×12, PF's own figure + word kept as evidence
    r = _row(_ad(offering_type="للايجار", price={"value": 3900, "period": "yearly"}), deal="Rent")
    assert (r["rent_period"], r["price_annual"]) == ("monthly", 46800)
    ev = r["price_evidence"]
    assert (ev["raw"], ev["source_period"], ev["judged_monthly"]) == (3900, "yearly", True)
    # the edges of the fleet band (300 ≤ v < 8,000) and the commercial side stay as published
    for v in (299, 8000):
        r = _row(_ad(offering_type="للايجار", price={"value": v, "period": "yearly"}), deal="Rent")
        assert (r["rent_period"], r["price_annual"]) == ("annual", v) and "judged_monthly" not in r["price_evidence"]
    office = _row(_ad(offering_type="للايجار", price={"value": 800, "period": "yearly"}), deal="Rent", cat="commercial")
    assert (office["rent_period"], office["price_annual"]) == ("annual", 800)


def test_hidden_price_is_price_on_request_and_a_contradicting_period_is_skipped():
    r = _row(_ad(price={"value": 0, "period": "sell", "is_hidden": True}))
    assert r["price_total"] is R.db.AUTHORITATIVE_NULL and r["price_evidence"]["authoritative_absent"] is True
    got, why = R.map_listing(_ad(price={"value": 5000, "period": "yearly"}), "Buy", "residential")
    assert got is None and why == "price_period_yearly_on_buy_side"


def test_no_phone_email_or_person_is_stored_anywhere():
    r = _row(_ad())
    blob = json.dumps(r, ensure_ascii=False, default=str)
    assert FAKE_PHONE not in blob and FAKE_MAIL not in blob and "مزيف" not in blob
    item = r["source_capture"]["item"]
    assert not {"agent", "broker", "client", "contact_options"} & set(item)


def test_pf_badges_live_only_in_the_private_capture():
    r = _row(_ad())
    assert r["source_capture"]["badges"]["is_great_value"] is True
    cols = {k for k in r if k not in ("source_capture",)}
    assert not any("great" in k or "demand" in k for k in cols)
    assert "is_great_value" not in json.dumps(r["additional_info"])


def test_type_by_side_utilities_and_instalments():
    assert _row(_ad(property_type="أرض"))["property_type"] == "Residential Land"
    assert _row(_ad(property_type="أرض", offering_type="تجارية للبيع"), cat="commercial")["property_type"] == "Commercial Land"
    assert _row(_ad(property_type="طابق كامل"))["property_type"] == "Floor"
    r = _row(_ad())
    assert r["electricity"] is True and r["water_supply"] is True and "sanitation" not in r   # silence ≠ no
    rent = _row(_ad(offering_type="للايجار", price={"value": 85000, "period": "yearly"}, rnpm={"enabled": True}), deal="Rent")
    assert rent["rent_now_pay_later"] is True
    got, why = R.map_listing(_ad(property_type="قلعة"), "Buy", "residential")
    assert got is None and why.startswith("type_unmapped_")


def test_off_plan_is_recognised_and_its_record_is_pii_clean():
    p = _ad(completion_status="off_plan_primary")
    assert R.is_off_plan(p) and not R.is_off_plan(_ad())
    o = R.offplan_row(p, "res_buy")
    assert o["ad_number"] == "PF52394526" and FAKE_PHONE not in json.dumps(o, ensure_ascii=False)


def test_crawler_refuses_urls_robots_or_the_owner_rule_forbid():
    for bad in (C.BASE + "/ar/plp/buy/x-1.html", C.BASE + "/ar/search?l=1", C.BASE + "/ar/x.html?page=2&price=1"):
        with pytest.raises(ValueError):
            C.fetch(bad)


def test_a_wall_stops_the_run():
    class _R:
        def __init__(self, code, text):
            self.status_code, self.text = code, text

    class _S:
        def __init__(self, r):
            self.r = r

        def get(self, *_a, **_k):
            return self.r

    for resp in (_R(403, "denied"), _R(429, ""), _R(200, "<html>Please complete the CAPTCHA</html>")):
        with pytest.raises(C.Blocked):
            C.fetch(C.BASE + "/ar/x.html?page=2", session=_S(resp), sleep=lambda _s: None)


def test_completeness_gate():
    side = {"min_total": 1000, "total_count": 1010, "pages_read": 40, "page_count": 40, "props": {str(i): {} for i in range(985)}}
    assert C.complete(side)
    assert not C.complete({**side, "pages_read": 39})
    assert not C.complete({**side, "props": {str(i): {} for i in range(900)}})
