"""سكني (sakani.sa) SALE side — backlog 864 (owner 2026-10-25): market_units for sale become Buy rows,
off-plan projects never do, and the purpose guard holds in both directions through the ad number.

PROVENANCE. RICH_20970 / RICH_20940 are the «marketplaces» rich rows printed by CI probe job
121422794705 (2026-10-26, search/v2/location?filter[marketplace_purpose]=sale), trimmed to the keys the
code reads; company_name there is a PERSON on 20940 and is replaced by a synthetic value here.
DETAIL_24798_SALE is the sale record captured 2026-09-23 (see the rent barrier's PROVENANCE).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.sakani import run as R  # noqa: E402
from scrapers.common.tests.test_sakani_price_period_and_pii_traps import (  # noqa: E402
    DETAIL_24798_SALE, DETAIL_24858, _detail_body)

_CAT = {"نجران": (61, 10), "سكيبه": (7078, 7), "جدة": (57, 7), "الرياض": (1, 1)}


@pytest.fixture(autouse=True)
def _offline_location(monkeypatch):
    # per test, never module-wide: the rent barrier patches the same names with its own catalogue
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: _CAT.get((city_ar or "").strip(), (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: (text or "").strip() or None)

_PHOTO = ("https://ruh-s3.bluvalt.com/sakani-media-assets/sakani-market-units-service/uiUhkCxkT3TSFsDXLoF18dVd")
RICH_20970 = {   # warehouse for sale, Najran
    "resource_id": 20970, "resource_type": "market_units", "publish": True, "availability": True,
    "auction_status": "", "hide_price_from_user": False, "marketplace_price": 1100000,
    "unit_types": ["warehouse"], "land_type": "", "district": "الغويلا",
    "city": {"city_id": 61, "region_id": 10, "name_ar": "نجران"}, "city_id": 61,
    "company_name": "شركة الإدارات العقارية",
    "description": "مستودع مخزن هنجر للبيع بمواصفات مميزة\nمساحة تخزين  2225 م2",
    "min_area": 2225, "max_area": 2225, "min_bed_room": 0, "max_bed_room": 0,
    "location": {"lat": 17.577529554412664, "lon": 44.36274468048823},
    "interior_photos": [{"file_url": _PHOTO + "?response-content-disposition=inline%3B%20filename%3D%22x.jpg%22",
                         "filename": "x.jpg"}],
    "media_images": [], "tags": {}, "market_unit_status": "published",
}
RICH_20940 = {   # villa for sale, سكيبه — company_name is a person's name on the source
    **RICH_20970, "resource_id": 20940, "marketplace_price": 510000, "unit_types": ["villa"],
    "district": "سكيبه", "city": {"city_id": 7078, "region_id": 7, "name_ar": "سكيبه"},
    "company_name": "فلان بن فلان", "min_area": 300, "max_area": 300,
    "min_bed_room": 5, "max_bed_room": 5, "min_bathroom": 4, "max_bathroom": 4,
    "description": "فيلا للبيع للتواصل 0500000009",
}
DETAIL_20970 = {"status": "published", "publish": True, "unit_price": "1100000.0", "unit_area": "2225.0",
                "rega_ad_license": {"ad_license_number": "7200000001", "advertisement_type": "sale"}}
PROJECT = {"resource_id": 555, "resource_type": "projects", "publish": True, "availability": True,
           "marketplace_price": 0, "unit_types": [], "city": {"name_ar": "الرياض"}}


def test_a_sale_unit_is_a_buy_row_with_the_cards_total_price_and_its_own_ad_number():
    row, cat, why = R.map_listing({}, RICH_20970, DETAIL_20970, None, "sale")
    assert why == "" and cat == "commercial"
    assert row["ad_number"] == "SKS20970" and row["transaction_type"] == "Buy"
    assert row["price_total"] == 1100000 and "price_annual" not in row and "rent_period" not in row
    assert row["price_evidence"]["kind"] == "total" and row["price_evidence"]["field"] == "marketplaces.marketplace_price"
    assert (row["city_ar"], row["city_id"], row["neighborhood"]) == ("نجران", 61, "الغويلا")
    assert row["area_m2"] == 2225 and row["license_number"] == "7200000001"
    assert row["photo_urls"] == [_PHOTO]                  # the upload-filename query is stripped
    assert row["listing_url"] == "https://sakani.sa/app/market-unit/20970"


def test_an_index_only_sale_villa_reads_single_unit_ranges_and_keeps_no_person():
    row, cat, why = R.map_listing({}, RICH_20940, None, None, "sale")
    assert why == "" and cat == "residential" and row["property_type"] == "Villa"
    assert (row["bedrooms"], row["bathrooms"], row["area_m2"], row["price_total"]) == (5, 4, 300, 510000)
    blob = json.dumps(row, ensure_ascii=False)
    assert "فلان" not in blob and "0500000009" not in blob


def test_a_range_is_not_one_units_fact():
    row, _, _ = R.map_listing({}, {**RICH_20940, "min_bed_room": 3, "max_bed_room": 6,
                                   "min_area": 200, "max_area": 400}, None, None, "sale")
    assert row["bedrooms"] is None and row["area_m2"] is None


def test_off_plan_projects_and_hidden_or_conflicting_prices_are_never_guessed():
    assert R.map_listing({}, PROJECT, None, None, "sale")[2] == "project_offplan"
    row, _, _ = R.map_listing({}, {**RICH_20970, "hide_price_from_user": True}, DETAIL_20970, None, "sale")
    assert row["price_total"] is None and row["additional_info"]["price_note"] == "hidden_by_source"
    row, _, _ = R.map_listing({}, RICH_20970, {**DETAIL_20970, "unit_price": "990000.0"}, None, "sale")
    assert row["price_total"] is None and "!=" in row["additional_info"]["price_note"]
    assert R.map_listing({}, {**RICH_20970, "publish": False}, None, None, "sale")[2] == "status_unpublished"


def test_the_purpose_guard_holds_both_ways():
    # a rent record walked from the sale catalogue skips; a sale record from the rent walk skips (unchanged)
    assert R.map_listing({}, RICH_20970, {**DETAIL_20970, "rega_ad_license": {"advertisement_type": "rent"}},
                         None, "sale")[2] == "purpose_rent"
    sale_body, rent_body = _detail_body(DETAIL_24798_SALE), _detail_body(DETAIL_24858)
    assert R._signal(200, sale_body, False, "sale") == "live"
    assert R._signal(200, rent_body, False, "sale") == "gone"
    assert R._signal(200, sale_body, False) == "gone"          # the rent oracle is unchanged


def test_verify_gone_reads_the_purpose_from_the_ad_number(monkeypatch):
    got = {}

    class _Probe:
        def __init__(self, platform, signal, session, url_for):
            got["url"] = url_for("x")
            got["sig"] = signal(200, _detail_body(DETAIL_24798_SALE), False)

        def verify_gone(self, ad):
            return got["sig"], "probe"
    monkeypatch.setattr(R, "LivenessProbe", _Probe)
    assert R._verify_gone("SKS24798")[0] == "live" and got["url"].endswith("/market_units/24798")
    assert R._verify_gone("SKI24798")[0] == "gone"
    assert R._verify_gone("SKX1")[0] == "unknown"


def test_a_sale_land_whose_own_text_names_commercial_use_is_commercial_land():
    land = {**RICH_20970, "resource_id": 22147, "unit_types": ["land"], "land_type": "residential",
            "description": "ارض تجاري سكني"}
    row, cat, _ = R.map_listing({}, land, None, None, "sale")
    assert (row["property_type"], cat) == ("Commercial Land", "commercial")
    row, cat, _ = R.map_listing({}, {**land, "description": "ارض سكنية"}, None, None, "sale")
    assert (row["property_type"], cat) == ("Residential Land", "residential")
