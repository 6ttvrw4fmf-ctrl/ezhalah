"""Offline barrier for scrapers/m3tmd/run.py — Nuzul tenant «مقر المعتمد» (www.m3tmd.com).

Fixtures are VERBATIM /api/public/v2/properties/<id> records captured 2026-09-24, trimmed to the
keys the code reads. Every test executes the REAL m3tmd map_listing()/main() (which import the
platform reading from scrapers/jawher/run.py); only to_catalog and find_district_in_text are
stubbed. The traps this tenant actually carries: a per-metre price stated in PROSE beside a real
selling_price; 21 of 46 sale rows with no price at all; a land the office filed «commercial» while
its use flags say otherwise; a wafi off-plan flag; 8 records without a city; the FAL licence on
every record and no AD licence on any.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402
from scrapers.jawher import run as J  # noqa: E402
from scrapers.m3tmd import run as R  # noqa: E402

_CATALOG = {"الخرج": (1061, 1)}


@pytest.fixture(autouse=True)
def _offline_catalog(monkeypatch):
    """The ONLY stubs: the two DB-backed location helpers (on the platform module the tenant
    imports from), scoped per test so the three tenant files share one pytest process."""
    monkeypatch.setattr(J, "to_catalog", lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None)))
    monkeypatch.setattr(J, "find_district_in_text", lambda text, city_id: (text or "").strip() or None)

# ── m3tmd 37109 — commercial land: «سعر المتر 2000 ريال» in the PROSE, selling_price 2,560,000 ──
PER_METRE_PROSE = json.loads(r'''{"id": 37109, "resource_type": "property", "type": "land", "purpose": "sell", "product": "office", "category": "commercial", "unit_number": "37109", "availability_status": "available", "name_ar": null, "description_ar": "سعر المتر 2000 ريال\nاخر سومه 1.500.000ريال", "district": {"id": 10101061015, "name_ar": "حي مشرف", "name_en": "Mishrif Dist."}, "city": {"id": 1061, "name_ar": "الخرج", "name_en": "Al Kharj"}, "is_wafi_ad": false, "is_for_residential": false, "is_for_commercial": true, "selling_price": 2560000, "price": 2560000, "price_label": "2,560,000.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 1280, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": false, "has_water": false, "has_sewage": false, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": 40, "street_width_west": null, "facade": "south", "rega_ad_number": null, "rega_advertiser_number": "1200019707", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37109/1a3d00e6-1627-4d05-8df5-2943fb2ce86c.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37109/1a3d00e6-1627-4d05-8df5-2943fb2ce86c_720.webp"}}, "images": [], "latitude": "24.110045697496", "longitude": "47.285655812875", "projects": [], "tags": [], "whatsapp_number": "0534884448", "plan_number": "1031/1", "plot_number": "566", "width": 40, "length": 33}''')

# ── m3tmd 37993 — the wafi (off-plan) plot, no price ────────────────────────────────────────────
WAFI = json.loads(r'''{"id": 37993, "resource_type": "property", "type": "land", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "37993", "availability_status": "available", "name_ar": null, "description_ar": null, "district": {"id": 11302270934, "name_ar": "حي الهدا", "name_en": "Al-Hada District"}, "city": {"id": 1061, "name_ar": "الخرج", "name_en": "Al Kharj"}, "is_wafi_ad": true, "is_for_residential": true, "is_for_commercial": false, "selling_price": null, "price": null, "price_label": null, "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 551, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": false, "has_water": false, "has_sewage": false, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": 25, "street_width_west": null, "facade": "south", "rega_ad_number": null, "rega_advertiser_number": "1200019707", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37993/920f0943-369f-4224-b07c-389fc42d5c8e.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37993/920f0943-369f-4224-b07c-389fc42d5c8e_720.webp"}}, "images": [], "latitude": "24.093205309704", "longitude": "47.298205149782", "projects": [], "tags": [], "whatsapp_number": "0534884448", "plan_number": "1031/6", "plot_number": "310", "width": 28, "length": 20}''')

# ── m3tmd 37988 — an unpriced villa with structured counters and a prose room list ──────────────
VILLA = json.loads(r'''{"id": 37988, "resource_type": "property", "type": "villa", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "37988", "availability_status": "available", "name_ar": null, "description_ar": "فيلا بحي الورود📍\n\nالتفاصيل:\n💥الدور الارضي:\nمجلس رجال - مجلس نساء - مقلط - صاله - مشب خارجي - مطبخ - مستودع - ٣دورات مياه - حوش\n💥الدور الاول:\n٤غرف نوم ماستر - مطبخ تحضيري\n\n💥الدور الثاني:\n٢غرفة نوم - غرفة غسيل - دورة مياه - سطح", "district": {"id": 10101061008, "name_ar": "حي الورود", "name_en": "Al Wurud Dist."}, "city": {"id": 1061, "name_ar": "الخرج", "name_en": "Al Kharj"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": null, "price": null, "price_label": null, "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 400, "built_up_area": null, "bedrooms": 7, "bathrooms": 8, "unit_floor_number": 0, "number_of_floors": 3, "living_rooms": 1, "majlis_rooms": 2, "elevators": 1, "parking_spots": 1, "kitchens": 2, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 1, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": "south", "rega_ad_number": null, "rega_advertiser_number": "1200019707", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37988/68c6b370-cb53-4f96-acd4-dfe0ed3fa97d.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37988/68c6b370-cb53-4f96-acd4-dfe0ed3fa97d_720.webp"}}, "images": [], "latitude": null, "longitude": null, "projects": [], "tags": [], "whatsapp_number": "0534884448", "plan_number": "1209", "plot_number": null, "width": null, "length": null}''')

# ── m3tmd 37120 — a plot the office published with NO city (8/46 are like this) ─────────────────
NO_CITY = json.loads(r'''{"id": 37120, "resource_type": "property", "type": "land", "purpose": "sell", "product": "office", "category": "commercial", "unit_number": "37120", "availability_status": "available", "name_ar": null, "description_ar": null, "district": null, "city": null, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": true, "selling_price": null, "price": null, "price_label": null, "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 959, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": false, "has_water": false, "has_sewage": false, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": "south_west", "rega_ad_number": null, "rega_advertiser_number": "1200019707", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37120/b908882e-3938-40a0-a475-85ad6ce744cd.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37120/b908882e-3938-40a0-a475-85ad6ce744cd_720.webp"}}, "images": [], "latitude": "24.091849165393", "longitude": "47.28717238512", "projects": [], "tags": [], "whatsapp_number": "0534884448", "plan_number": "1031-6", "plot_number": "843"}''')


def _row(d):
    row, cat, why = R.map_listing(d)
    assert row is not None, why
    return row

# ── m3tmd 37096 — commercial land whose stored price is ZERO: selling_price 0 / price 0 / price_label
#    "0.00" (captured 2026-09-24; the page prints no price and no «ريال») ─────────────────────────
ZERO_PRICE = json.loads(r'''{"id": 37096, "resource_type": "property", "type": "land", "purpose": "sell", "product": "office", "category": "commercial", "unit_number": "37096", "availability_status": "available", "name_ar": null, "description_ar": null, "district": {"id": 10101061015, "name_ar": "حي مشرف", "name_en": "Mishrif Dist."}, "city": {"id": 1061, "name_ar": "الخرج", "name_en": "Al Kharj"}, "is_wafi_ad": false, "is_for_residential": false, "is_for_commercial": true, "selling_price": 0, "price": 0, "price_label": "0.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 650, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": false, "has_water": false, "has_sewage": false, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": 40, "street_width_south": null, "street_width_west": null, "facade": "east", "rega_ad_number": null, "rega_advertiser_number": "1200019707", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37096/d161da8b-a125-4a2f-a4a5-634b85f7c1bd.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/4676/properties/37096/d161da8b-a125-4a2f-a4a5-634b85f7c1bd_720.webp"}}, "images": [], "latitude": "24.102127461661", "longitude": "47.298843843395", "projects": [], "tags": [], "whatsapp_number": "0534884448", "plan_number": "1031/4", "plot_number": "1587", "width": 20, "length": 33}''')


def test_a_per_metre_price_in_the_prose_is_never_the_price():
    row = _row(PER_METRE_PROSE)
    assert row["price_total"] == 2_560_000, "selling_price, exactly as published"
    assert "price_per_meter" not in row
    assert row["price_total"] != 2000 * 1280 or True   # 2,560,000 happens to equal 2000×1280 —
    # — so prove the SOURCE is what was read, not the arithmetic: drop the field and the total is NULL.
    silent = json.loads(json.dumps(PER_METRE_PROSE))
    silent.update(selling_price=None, price=None, price_label=None)
    assert _row(silent)["price_total"] is db.AUTHORITATIVE_NULL
    assert "سعر المتر 2000 ريال" in row["description"]


def test_an_unpriced_villa_is_kept_with_an_authoritative_null_and_its_counters():
    row = _row(VILLA)
    assert row["price_total"] is db.AUTHORITATIVE_NULL
    assert (row["bedrooms"], row["bathrooms"], row["halls"], row["reception_rooms_majlis"]) == (7, 8, 1, 2)
    assert row["elevator"] is True and row["parking"] is True and row["kitchen"] is True
    assert "maid_room" not in row and "driver_room" not in row, "0 is the platform default, not a no"
    assert row["floor_number"] is None and row["additional_info"]["number_of_floors"] == 3
    assert row["direction"] == "جنوب" and row["street_width_m"] is None
    assert row["title"] == "فيلا للبيع في حي الورود"


def test_the_offices_own_category_qualifies_land_not_the_use_flags():
    row, cat, _ = R.map_listing(PER_METRE_PROSE)
    assert (row["property_type"], cat) == ("Commercial Land", "commercial")
    assert row["additional_info"]["usages"] == ["commercial"]
    res = json.loads(json.dumps(PER_METRE_PROSE))
    res["category"] = "residential"                   # use flags unchanged: commercial-only
    row, cat, _ = R.map_listing(res)
    assert (row["property_type"], cat) == ("Residential Land", "residential")


def test_a_stored_zero_price_is_the_platforms_not_set_sentinel_kept_auditable_never_a_0_riyal_price():
    row, cat, why = R.map_listing(ZERO_PRICE)
    assert why == "" and cat == "commercial" and row["property_type"] == "Commercial Land"
    assert row["price_total"] is db.AUTHORITATIVE_NULL, "the page prints no price: authoritative NULL, not 0"
    ev = row["price_evidence"]
    assert ev["raw"] == 0 and ev["field"] == "selling_price" and ev["authoritative_absent"] is True
    assert row["additional_info"]["price_label"] == "0.00", "the raw figure stays auditable"
    assert row["street_width_m"] == 40 and row["direction"] == "شرق" and row["area_m2"] == 650


def test_wafi_off_plan_is_skipped_and_a_missing_city_is_never_defaulted():
    assert R.map_listing(WAFI) == (None, "residential", "off_plan_wafi")
    assert R.map_listing(NO_CITY) == (None, "commercial", "no_city")


def test_no_ad_licence_means_null_and_the_fal_licence_never_leaks_into_it():
    row = _row(PER_METRE_PROSE)
    assert row["license_number"] is None
    assert row["additional_info"]["fal_licence_number"] == "1200019707"


def test_identity_and_pdpl():
    row = _row(PER_METRE_PROSE)
    assert row["ad_number"] == "MQR37109"
    assert row["listing_url"] == "https://www.m3tmd.com/properties/37109"
    assert row["source"] == "مقر المعتمد" and row["transaction_type"] == "Buy"
    assert "0534884448" not in json.dumps(row, ensure_ascii=False, default=str)
    assert row["photo_urls"] == [PER_METRE_PROSE["cover_image"]["previews"]["720"]]
    assert (row["city_ar"], row["city_id"], row["district_ar"]) == ("الخرج", 1061, "حي مشرف")


def test_main_tallies_every_skip_into_end_run(monkeypatch):
    records = {37109: PER_METRE_PROSE, 37993: WAFI, 37988: VILLA, 37120: NO_CITY}
    writes, calls = {}, {}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_ids", lambda s, base, limit=0: (list(records), True))
    monkeypatch.setattr(R, "fetch_detail", lambda s, base, pid, tries=3: (records[pid], "live"))
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R.db, "begin_run", lambda slug: calls.update(begin=slug) or 3)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: writes.update({t: [r["ad_number"] for r in rows]}))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: calls.update(retire=k) or 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(end=k) or True)
    assert R.main() == 0
    assert calls["begin"] == "m3tmd"
    assert writes == {"m3tmd_residential_listings": ["MQR37988"], "m3tmd_commercial_listings": ["MQR37109"]}
    assert calls["retire"]["res_table"] == "m3tmd_residential_listings" and calls["retire"]["source"] == "مقر المعتمد"
    end = calls["end"]
    assert end["check_tables"] == ["m3tmd_residential_listings", "m3tmd_commercial_listings"]
    assert end["rows_seen"] == 4 and end["rows_upserted"] == 2
    assert "off_plan_wafix1" in end["notes"] and "no_cityx1" in end["notes"]
