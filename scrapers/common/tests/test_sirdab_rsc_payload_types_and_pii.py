"""Sirdab: ads come out of the RSC flight payload; storage units are never guessed into a type; the
constant «/سنة» card label never overrules a monthly-looking price; the owner's phone is never stored."""
import json

import pytest

import scrapers.sirdab.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: t)


def _ad(**kw):
    prop = {"property_type": "warehouse", "area_in_m2": 500, "cities": {"name_ar": "الرياض"},
            "district_name": "الروضة", "facade": "east", "street_width": 100, "property_age": 1,
            "has_water": True, "has_sewage": False, "lat": 24.7, "lng": 46.8, "building_number": "10",
            "user_id": "u-1", "images": [{"url": "https://x/2.jpg", "isPrimary": False},
                                         {"url": "https://x/1.jpg", "isPrimary": True}]}
    prop.update(kw.pop("property", {}))
    a = {"id": "ad-1", "slug": "s-1", "listing_type": "rent", "price_in_cents": 16000000, "status": "active",
         "title_ar": "مستودع للإيجار في الرياض حي الروضة", "description_ar": "مستودع مناسب", "owner_phone": "0551234567",
         "property": prop}
    a.update(kw)
    return a


def test_the_ads_array_is_read_out_of_the_flight_payload():
    ads = [_ad(), _ad(id="ad-2")]
    chunk = json.dumps('0:["$","div",{"totalCount":564,"ads":' + json.dumps(ads, ensure_ascii=False) + '}]',
                       ensure_ascii=False)[1:-1]
    page = f'<script>self.__next_f.push([1,"{chunk}"])</script>'
    got, total = R.page_ads(page)
    assert total == 564 and [a["id"] for a in got] == ["ad-1", "ad-2"]


def test_a_yearly_rent_maps_with_its_facts_and_primary_photo_first():
    (row, cat), why = R.map_ad(_ad())
    assert why == "" and cat == "commercial" and row["property_type"] == "Warehouse"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 160000)
    assert row["photo_urls"][0] == "https://x/1.jpg" and row["listing_url"].endswith("/s-1")
    assert row["water_supply"] is True and "sanitation" not in row      # a False flag stays silent


def test_the_constant_year_label_never_overrules_a_monthly_looking_price():
    (row, _), _ = R.map_ad(_ad(price_in_cents=200000))                   # 2,000 «/سنة» on a 500 m² warehouse
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 24000)


def test_a_sub_riyal_placeholder_is_no_price_and_a_sale_is_a_total():
    (row, _), _ = R.map_ad(_ad(price_in_cents=10))
    assert row["price_annual"] is None
    (row, _), _ = R.map_ad(_ad(listing_type="sale", price_in_cents=250000000))
    assert (row["transaction_type"], row["price_total"]) == ("Buy", 2500000)


@pytest.mark.parametrize("t", ["storage", "storage_yard"])
def test_storage_units_and_yards_are_never_guessed_into_a_type(t):
    assert R.map_ad(_ad(property={"property_type": t}))[1] == f"type_unmapped_{t}"


def test_the_owner_phone_and_building_number_are_never_stored():
    (row, _), _ = R.map_ad(_ad())
    blob = json.dumps(row, ensure_ascii=False)
    assert "0551234567" not in blob and "owner_phone" not in blob and "building_number" not in blob
    assert "user_id" not in blob


@pytest.mark.parametrize("facade", ["east", "northeast", "southwest"])
def test_every_facade_the_source_writes_is_read(facade):
    # the diagonals come WITHOUT an underscore («northeast»); a missed key silently drops the facade
    (row, _), _ = R.map_ad(_ad(property={"facade": facade}))
    assert row["direction"]

