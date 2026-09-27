"""Maqam (property.maqamco.sa, Nuzul tenant 5348) on the REAL scraper functions, pinned to items
captured VERBATIM from maqamco.nzl-backend.com/api/public/properties on 2026-09-26 (trimmed to
the keys the code reads, images[] cut to two):

  · only availability_status == "available" is published (sold/reserved/rented/unavailable skip);
  · is_wafi_ad == 1 (the off-plan sale licence) is skipped even when available;
  · a sale with no selling_price stores price_total NULL, never 0 (id 51319);
  · a rent publishing only rent_price_annually is stored verbatim as annual;
  · area is the verbatim float (204.44), never truncated;
  · whatsapp_number / rega_advertiser_number / a phone typed in prose never reach the row.

Offline: the two catalog helpers are the only stubs.
"""
from __future__ import annotations

import json

import pytest

import scrapers.goldendeal.run as ENGINE
from scrapers.maqam import run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(ENGINE, "to_catalog", lambda c, region_hint=None: (3, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(ENGINE, "find_district_in_text", lambda t, cid: t if (t or "").startswith("حي ") else None)


# 51646 — available rent, annual only, fractional area, the office WhatsApp on the item.
RENT_51646 = json.loads(r'''{"id": 51646, "name_ar": "C03", "type": "building_apartment", "purpose": "rent", "category": "residential", "availability_status": "available", "is_wafi_ad": 0, "wafi_license_number": null, "unit_number": "C03", "description_ar": "<p>شقة جانبية زاوية + مطلة على الشارع + مطبخ امريكي + صالة + مدخل خاص + حوش خاص + غرفة خادمة</p>", "district": {"id": 10100003150, "name_en": "Al Narjis Dist.", "name_ar": "حي النرجس"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": 85000, "daily_price": null, "area": 204.44, "built_up_area": 129.15, "bedrooms": 2, "bathrooms": 4, "living_rooms": 1, "majlis_rooms": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "year_built": "0", "rega_ad_number": null, "rega_advertiser_number": null, "whatsapp_number": "+966550202500", "advertiser_type": "broker", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/51646/cover/30d1fbc4-ce3b-4d8d-b386-cac051c93aed.webp", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/51646/cover/30d1fbc4-ce3b-4d8d-b386-cac051c93aed.webp"}]}''')
# 42576 — available sale floor carrying the Wafi (off-plan) flag.
WAFI_42576 = json.loads(r'''{"id": 42576, "name_ar": null, "type": "floor", "purpose": "sell", "category": "residential", "availability_status": "available", "is_wafi_ad": 1, "wafi_license_number": null, "unit_number": "Second floor 03", "description_ar": null, "district": {"id": 10100003189, "name_en": "Al Marjan Dist.", "name_ar": "حي المرجان"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": 490000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 110, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "living_rooms": 0, "majlis_rooms": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "year_built": "0", "rega_ad_number": null, "rega_advertiser_number": null, "whatsapp_number": null, "advertiser_type": "broker", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/42576/3dadf99e-fc25-4116-8f95-4e58f6cc97e7.png", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/42576/3dadf99e-fc25-4116-8f95-4e58f6cc97e7.png"}, {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/42576/2bbcce40-62b0-4ea9-8b16-9bb4efae1d46.png"}]}''')
# 51319 — available sale villa that publishes no selling_price (and no area).
NOPRICE_51319 = json.loads(r'''{"id": 51319, "name_ar": "فلة الروضة 101", "type": "villa", "purpose": "sell", "category": "residential", "availability_status": "available", "is_wafi_ad": 0, "wafi_license_number": null, "unit_number": "8868002", "description_ar": null, "district": {"id": 10100003088, "name_en": "Al Rawdah Dist.", "name_ar": "حي الروضة"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": null, "built_up_area": null, "bedrooms": 6, "bathrooms": 5, "living_rooms": 3, "majlis_rooms": 0, "has_electricity": 0, "has_water": 0, "has_sewage": 0, "year_built": "2016", "rega_ad_number": null, "rega_advertiser_number": null, "whatsapp_number": null, "advertiser_type": "broker", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/51319/cover/c9ee42fc-4176-4104-abd8-44bafaa5aef8.jpeg", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/51319/cover/c9ee42fc-4176-4104-abd8-44bafaa5aef8.jpeg"}]}''')
# 42656 — sold unit, carries rega_advertiser_number.
SOLD_42656 = json.loads(r'''{"id": 42656, "name_ar": null, "type": "building_apartment", "purpose": "sell", "category": "residential", "availability_status": "sold", "is_wafi_ad": 0, "wafi_license_number": null, "unit_number": "B08", "description_ar": null, "district": {"id": 10100003153, "name_en": "Al Rimal Dist.", "name_ar": "حي الرمال"}, "city": {"id": 3, "name_en": "Riyadh", "name_ar": "الرياض"}, "selling_price": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 79.18, "built_up_area": null, "bedrooms": 1, "bathrooms": 2, "living_rooms": 0, "majlis_rooms": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "year_built": "0", "rega_ad_number": "7200757816", "rega_advertiser_number": "1200021005", "whatsapp_number": null, "advertiser_type": "broker", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/42656/f80fb5d3-fb0a-4f09-9951-4addfa894b67.png", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/42656/f80fb5d3-fb0a-4f09-9951-4addfa894b67.png"}, {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5348/properties/42656/77e42558-0a3a-41e2-9591-92a5b2e8e40c.png"}]}''')


def test_only_available_is_kept():
    for status in ("sold", "reserved", "rented", "unavailable"):
        row, _, why = R.map_listing({**SOLD_42656, "availability_status": status})
        assert row is None and why == f"status_{status}"
    row, _, why = R.map_listing({**SOLD_42656, "availability_status": "available"})
    assert row is not None and why == ""


def test_wafi_offplan_is_excluded():
    row, _, why = R.map_listing(WAFI_42576)
    assert row is None and why == "offplan_wafi"
    row, _, why = R.map_listing({**WAFI_42576, "is_wafi_ad": 0, "wafi_license_number": "123456"})
    assert row is None and why == "offplan_wafi"
    row, _, why = R.map_listing({**WAFI_42576, "is_wafi_ad": 0})
    assert row is not None and row["price_total"] == 490000


def test_missing_price_is_null_not_zero():
    row, _, why = R.map_listing(NOPRICE_51319)
    assert why == "" and row["transaction_type"] == "Buy"
    assert row["price_total"] is None and row["price_annual"] is None and row["price_per_meter"] is None
    assert row["area_m2"] is None                      # unpublished area stays unknown too


def test_rent_annual_verbatim_and_area_float():
    row, cat, why = R.map_listing(RENT_51646)
    assert why == "" and cat == "residential"
    assert row["transaction_type"] == "Rent" and row["property_type"] == "Apartment"
    assert (row["price_annual"], row["rent_period"], row["price_total"]) == (85000, "annual", None)
    assert row["area_m2"] == 204.44
    assert row["city_ar"] == "الرياض" and row["district_ar"] == "حي النرجس"
    assert row["listing_url"] == "https://property.maqamco.sa/properties/51646"
    assert row["ad_number"] == "MQM51646" and row["source"] == R.SOURCE == "شركة مقام للتطوير العقاري"
    assert row["photo_urls"] and all("/tenants/5348/properties/51646/" in u for u in row["photo_urls"])


def test_bedroom_zero_is_not_a_count():
    row, _, _ = R.map_listing({**RENT_51646, "bedrooms": 0, "bathrooms": 0})
    assert row["bedrooms"] is None and row["bathrooms"] is None


def test_pii_never_present():
    item = {**RENT_51646, "rega_advertiser_number": "1200021005",
            "description_ar": RENT_51646["description_ar"] + "<p>للتواصل 0550202500</p>"}
    row, _, _ = R.map_listing(item)
    blob = json.dumps(row, ensure_ascii=False)
    for needle in ("550202500", "1200021005", "whatsapp_number", "rega_advertiser_number"):
        assert needle not in blob, needle
