"""Offline barrier for scrapers/senan/run.py — Nuzul tenant «سنان العقارية» (www.senanrealestate.sa),
a DEVELOPER whose catalogue is projects made of individually priced units.

Fixtures are VERBATIM /api/public/v2/properties/<id> UNIT records captured 2026-09-24, trimmed to
the keys the code reads. Every test executes the REAL senan map_listing()/main() (platform reading
imported from scrapers/jawher/run.py); only to_catalog and find_district_in_text are stubbed.
What it pins: the listing grain is ONE UNIT with its own price and its own page; the project it
belongs to is recorded, never made the listing; a unit whose `area` is null prints its built_up_
area as the م² figure; townhouse folds to Villa; a sold unit still in the catalogue is skipped; a
unit whose page prints no location is skipped, never given its tag's or its project's city; the
site's Arabic city spellings («ابها», «احد رفيده») are offered to the catalog as published.
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

from scrapers.jawher import run as J  # noqa: E402
from scrapers.senan import run as R  # noqa: E402

_CATALOG = {"ابها": (15, 6), "احد رفيده": (65, 6), "خميس مشيط": (62, 6)}
OFFERED: list = []


def _to_catalog(city_ar, region_hint=None):
    OFFERED.append(city_ar)
    return _CATALOG.get((city_ar or "").strip(), (None, None))


@pytest.fixture(autouse=True)
def _offline_catalog(monkeypatch):
    """The ONLY stubs: the two DB-backed location helpers (on the platform module the tenant
    imports from), scoped per test so the three tenant files share one pytest process. The
    catalog stand-in RECORDS what it was offered, so a test can prove nothing was guessed."""
    OFFERED.clear()
    monkeypatch.setattr(J, "to_catalog", _to_catalog)
    monkeypatch.setattr(J, "find_district_in_text", lambda text, city_id: (text or "").strip() or None)

# ── senan 44630 — unit #2248404 of project 301379 «🔸فلل فاخرة بالمحالة 🔸», area null, built-up 438 ──
UNIT_IN_PROJECT = json.loads(r'''{"id": 44630, "resource_type": "property", "type": "villa", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "2248404", "availability_status": "available", "name_ar": null, "description_ar": null, "district": {"id": 11302271054, "name_ar": "حي الروابي", "name_en": "Al Rawabi Dist."}, "city": {"id": 15, "name_ar": "ابها", "name_en": "Abha"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": 1280000, "price": 1280000, "price_label": "1,280,000.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": null, "built_up_area": 438, "bedrooms": 5, "bathrooms": 8, "unit_floor_number": 0, "number_of_floors": 3, "living_rooms": 2, "majlis_rooms": 2, "elevators": 1, "parking_spots": 1, "kitchens": 1, "maid_rooms": 1, "driver_rooms": 1, "storage_rooms": 1, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": null, "rega_ad_number": null, "rega_advertiser_number": "1200017563", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/44630/5b79bd7a-30f0-4252-bcce-62962b36fdef.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/44630/5b79bd7a-30f0-4252-bcce-62962b36fdef_720.webp"}}, "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/44630/2dd20e72-99a8-4544-b7ed-a1175bf1d4db.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/44630/2dd20e72-99a8-4544-b7ed-a1175bf1d4db_720.webp"}}], "latitude": null, "longitude": null, "projects": [{"id": 301379, "name_ar": "🔸فلل فاخرة بالمحالة 🔸", "name_en": "🔸فلل فاخرة بالمحالة 🔸"}], "tags": [{"id": 224, "slug": "abha", "name_ar": "ابها", "name_en": null, "color_hex": "#29C077"}], "whatsapp_number": null, "plan_number": null, "plot_number": null, "width": null, "length": null}''')

# ── senan 41522 — a STANDALONE townhouse (one of the 5 units in no project) ─────────────────────
STANDALONE = json.loads(r'''{"id": 41522, "resource_type": "property", "type": "townhouse", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "7016834", "availability_status": "available", "name_ar": null, "description_ar": "*مكونات الروف العلوي*\n•مدخل خاص \n•مجلس رجال \n•مجلس نساء \n•مقلط طعام \n•مطبخ \n•صاله معيشه \n•٤ دوراة مياه \n•٣ غرف نوم من ضمنها ١ رئيسيه", "district": {"id": 10600065014, "name_ar": "المدينة العسكرية", "name_en": "Military City"}, "city": {"id": 65, "name_ar": "احد رفيده", "name_en": "Ahad Rifaydah"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": 650000, "price": 650000, "price_label": "650,000.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 340, "built_up_area": null, "bedrooms": 3, "bathrooms": 4, "unit_floor_number": 0, "number_of_floors": 2, "living_rooms": 1, "majlis_rooms": 2, "elevators": 1, "parking_spots": 0, "kitchens": 1, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": 15, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": null, "rega_ad_number": null, "rega_advertiser_number": "1200017563", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/5560/ac77b8fc-aa19-437a-bcb1-cff3b886d82c.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/5560/ac77b8fc-aa19-437a-bcb1-cff3b886d82c_720.webp"}}, "images": [], "latitude": null, "longitude": null, "projects": [], "tags": [], "whatsapp_number": "0590109412", "plan_number": null, "plot_number": null, "width": null, "length": null}''')

# ── senan 41291 — a unit whose page prints NO location (17/82 are like this) ────────────────────
NO_LOCATION = json.loads(r'''{"id": 41291, "resource_type": "property", "type": "building_apartment", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "1893106", "availability_status": "available", "name_ar": null, "description_ar": "🔴 حصري \nمشروع ديم المساكن \n شقق تمليك بالمحاله - مخطط السياري\nبالقرب من جميع الخدمات \nموقف خاص لكل شقه\nمجلس رجال \nمقلط طعام \nصاله\n مطبخ \nغرفة غسيل \n3 غرف نوم \nسطح خاص لكل شقه \n3 دورات مياه \nمتبقي شقه علويه 580,000", "district": null, "city": null, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": 580000, "price": 580000, "price_label": "580,000.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 190, "built_up_area": null, "bedrooms": 3, "bathrooms": 4, "unit_floor_number": 2, "number_of_floors": 0, "living_rooms": 1, "majlis_rooms": 1, "elevators": 0, "parking_spots": 0, "kitchens": 1, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 1, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": 10, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": null, "rega_ad_number": null, "rega_advertiser_number": "1200017563", "cover_image": null, "images": [], "latitude": null, "longitude": null, "projects": [{"id": 301139, "name_ar": "🔸شقق علوية في المحالة🔸", "name_en": "."}], "tags": [{"id": 224, "slug": "abha", "name_ar": "ابها", "name_en": null, "color_hex": "#29C077"}], "whatsapp_number": null, "plan_number": null, "plot_number": null, "width": null, "length": null}''')

# ── senan 41223 — a SOLD unit the catalogue still publishes with its price ──────────────────────
SOLD = json.loads(r'''{"id": 41223, "resource_type": "property", "type": "townhouse", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "9412852", "availability_status": "sold", "name_ar": null, "description_ar": "يتميز المشروع بقربه من جميع الخدمات", "district": {"id": 10600065014, "name_ar": "المدينة العسكرية", "name_en": "Military City"}, "city": {"id": 65, "name_ar": "احد رفيده", "name_en": "Ahad Rifaydah"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": 700000, "price": 700000, "price_label": "700,000.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 340, "built_up_area": null, "bedrooms": 8, "bathrooms": 7, "unit_floor_number": 2, "number_of_floors": 2, "living_rooms": 2, "majlis_rooms": 2, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 1, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": true, "has_water": false, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": 20, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": "east", "rega_ad_number": null, "rega_advertiser_number": null, "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/5560/aedd837e-3d5a-4fd5-9f9c-c13d47fb08c3.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/5560/properties/5560/aedd837e-3d5a-4fd5-9f9c-c13d47fb08c3_720.webp"}}, "images": [], "latitude": null, "longitude": null, "projects": [{"id": 301113, "name_ar": "روفات علوية في احد رفيدة", "name_en": "201"}], "tags": [], "whatsapp_number": null, "plan_number": null, "plot_number": null, "width": null, "length": null}''')


def _row(d):
    row, cat, why = R.map_listing(d)
    assert row is not None, why
    return row


def test_the_grain_is_one_unit_with_its_own_price_and_page_and_the_project_is_only_recorded():
    row = _row(UNIT_IN_PROJECT)
    assert row["ad_number"] == "SNN44630"
    assert row["listing_url"] == "https://www.senanrealestate.sa/properties/44630"
    assert row["price_total"] == 1_280_000 and row["transaction_type"] == "Buy"
    assert row["additional_info"]["project"] == {"id": 301379, "name_ar": "🔸فلل فاخرة بالمحالة 🔸"}
    assert row["additional_info"]["unit_number"] == "2248404"
    assert row["source"] == "سنان العقارية"
    assert row["title"] == "فيلا للبيع في حي الروابي"


def test_a_null_area_prints_the_built_up_area_and_says_so():
    row = _row(UNIT_IN_PROJECT)
    assert row["area_m2"] == 438 and row["additional_info"]["area_field"] == "built_up_area"
    assert "built_up_area" not in row["additional_info"]
    st = _row(STANDALONE)
    assert st["area_m2"] == 340 and st["additional_info"]["area_field"] == "area"


def test_unit_counters_reach_real_columns_and_silence_stays_null():
    row = _row(UNIT_IN_PROJECT)
    assert (row["bedrooms"], row["bathrooms"], row["halls"], row["reception_rooms_majlis"]) == (5, 8, 2, 2)
    assert row["elevator"] is True and row["maid_room"] is True and row["driver_room"] is True
    assert (row["electricity"], row["water_supply"], row["sanitation"]) == (True, True, True)
    assert row["direction"] is None and row["street_width_m"] is None and row["floor_number"] is None
    assert row["license_number"] is None and row["additional_info"]["fal_licence_number"] == "1200017563"


def test_townhouse_folds_to_villa_and_a_standalone_unit_has_no_project():
    row = _row(STANDALONE)
    assert row["property_type"] == "Villa"
    assert "project" not in row["additional_info"]
    assert row["street_width_m"] == 15 and row["elevator"] is True and "parking" not in row
    assert row["private_entrance"] is True, "«مدخل خاص» in the unit's own prose"
    assert "0590109412" not in json.dumps(row, ensure_ascii=False, default=str)


def test_the_sites_own_city_spellings_are_offered_to_the_catalog_as_published():
    row = _row(STANDALONE)
    assert OFFERED == ["احد رفيده"], "the raw label, not a normalised guess"
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("احد رفيده", 65, 6)
    assert row["district_ar"] == "المدينة العسكرية" and row["neighborhood"] == "المدينة العسكرية"


def test_a_unit_whose_page_prints_no_location_is_skipped_never_given_its_tag_or_project_city():
    assert R.map_listing(NO_LOCATION) == (None, "residential", "no_city")
    assert OFFERED == [], "nothing was offered to the catalog — no tag, no project, no default"


def test_a_sold_unit_is_skipped_by_status_not_hidden_by_price():
    assert R.map_listing(SOLD) == (None, "residential", "status_sold")


def test_a_sold_unit_still_served_with_200_is_gone_to_the_removal_oracle(monkeypatch):
    """Measured 2026-09-24 on this host: sold 41223/41222/44628 and unavailable 44610/44591/44579
    all answer 200 with data.id and their status (6/6). The oracle must read that flag."""
    from scrapers.common import http_liveness as HL
    api = "https://www.senanrealestate.sa/api/public/v2/properties/"
    answers = {api + "44630": (200, json.dumps({"data": UNIT_IN_PROJECT}), False),
               api + "41223": (200, json.dumps({"data": SOLD}), False)}
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: answers[url])
    monkeypatch.setattr(HL.time, "sleep", lambda *_: None)
    verify = J.make_verify_gone(R.BASE, R.PREFIX, R.SLUG, {"ad_number": "SNN44630"})
    assert verify("SNN41223")[0] == "gone"
    assert verify("SNN44630")[0] == "live"


def test_main_tallies_every_skip_into_end_run(monkeypatch):
    records = {44630: UNIT_IN_PROJECT, 41522: STANDALONE, 41291: NO_LOCATION, 41223: SOLD}
    writes, calls = {}, {}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_ids", lambda s, base, limit=0: (list(records), True))
    monkeypatch.setattr(R, "fetch_detail", lambda s, base, pid, tries=3: (records[pid], "live"))
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R.db, "begin_run", lambda slug: calls.update(begin=slug) or 5)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: writes.update({t: [r["ad_number"] for r in rows]}))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: calls.update(retire=k) or 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(end=k) or True)
    assert R.main() == 0
    assert calls["begin"] == "senan"
    assert writes == {"senan_residential_listings": ["SNN44630", "SNN41522"], "senan_commercial_listings": []}
    assert calls["retire"]["com_table"] == "senan_commercial_listings" and calls["retire"]["source"] == "سنان العقارية"
    end = calls["end"]
    assert end["check_tables"] == ["senan_residential_listings", "senan_commercial_listings"]
    assert end["rows_seen"] == 4 and end["rows_upserted"] == 2
    assert "no_cityx1" in end["notes"] and "status_soldx1" in end["notes"]
