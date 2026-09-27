"""الصفقة الذهبية العقارية (goldendeal.sa) — the Nuzul-API traps, each pinned to an item captured
VERBATIM from goldendeal.nzl-backend.com/api/public/properties on 2026-09-23, trimmed to the keys
the code reads (images[] cut to two entries, description_ar cut to the paragraphs under test).

Offline: the two catalog helpers are the only stubs; db calls are replaced only in the main() tests.
The engine here is shared with scrapers/yameen/run.py, whose own test pins the tenant differences.

Run: python3 -m pytest -q -p no:cacheprovider scrapers/common/tests/test_goldendeal_nuzul_source_fidelity.py
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.goldendeal import run as R  # noqa: E402

_CITIES = {"جدة": (18, 2), "مكة المكرمة": (6, 2)}
_THIS_YEAR = 2026


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: _CITIES.get(city_ar, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda text, city_id: text if (text or "").startswith("حي ") else None)


def _map(item, **kw):
    return R.map_listing(item, R.TENANT, this_year=_THIS_YEAR, **kw)


# ── VERBATIM PAYLOADS ───────────────────────────────────────────────────────────────────────────
# 50495 — land for sale: fractional area, THREE street widths, a two-sided facade, no name_ar.
LAND_50495 = json.loads(r'''{"id": 50495, "name_ar": null, "type": "land", "purpose": "sell", "category": "residential", "availability_status": "available", "unit_number": "8231963", "description_ar": "<p>\"\"\"رقم العرض : GD 8059</p><p>نوع العقار :ارض للبيع</p><p>الموقع : الروضه</p><p>المساحة : 958.15 م</p><p>المواصفات:</p><p>عمارة هدد حي الروضة موقع مميز جداً</p><p>راس بلوك - ٣ شوارع</p><p>شارع 12 * 30</p><p>رقم الترخيص : 7201014661</p><p>المطلوب : 9.000.000</p><p>:</p><p>\"\"\"</p>", "district": {"id": 10200018064, "name_en": "Ar Rawdah Dist.", "name_ar": "حي الروضة"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": 9000000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 958.15, "built_up_area": null, "bedrooms": null, "bathrooms": null, "living_rooms": null, "majlis_rooms": null, "maid_rooms": null, "driver_rooms": null, "kitchens": null, "is_kitchen_installed": null, "is_ac_installed": null, "is_furnished": null, "elevators": null, "parking_spots": null, "balconies": null, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": null, "number_of_floors": null, "year_built": null, "facade": "north_south", "street_width": 12, "street_width_east": 29, "street_width_south": 30, "street_width_west": null, "rega_ad_number": "7201014661", "rega_advertiser_number": "1200008917", "whatsapp_number": "+966543777151", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/50495/cover/07245067-31b0-4740-83fc-578ace6d5b16.jpeg", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/50495/cover/07245067-31b0-4740-83fc-578ace6d5b16.jpeg"}, {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/50495/b6adde69-5675-4272-bfd6-8fad0abe54c2.jpeg"}], "latitude": null, "longitude": null, "plan_number": null, "plot_number": null}''')

# 51738 — land in Makkah with ONE street width and a single-word facade.
LAND_51738 = json.loads(r'''{"id": 51738, "name_ar": null, "type": "land", "purpose": "sell", "category": "residential", "availability_status": "available", "unit_number": "GD 8077", "description_ar": "<p>\"رقم العرض : GD 8077 </p><p>نوع العقار:   ارض </p><p>الموقع:  مكة المكرمة - الرصيفة</p><p>المساحة :  675 م</p>", "district": {"id": 10200006009, "name_en": "Ar Rusayfah Dist.", "name_ar": "حي الرصيفة"}, "city": {"id": 6, "name_en": "Makkah Al Mukarramah", "name_ar": "مكة المكرمة"}, "selling_price": 3000000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 675, "built_up_area": null, "bedrooms": null, "bathrooms": null, "living_rooms": null, "majlis_rooms": null, "maid_rooms": null, "driver_rooms": null, "kitchens": null, "is_kitchen_installed": null, "is_ac_installed": null, "is_furnished": null, "elevators": null, "parking_spots": null, "balconies": null, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": null, "number_of_floors": null, "year_built": null, "facade": "west", "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": 15, "rega_ad_number": "7201064816", "rega_advertiser_number": "1200008917", "whatsapp_number": "+966543777151", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/51738/cover/36f7cb52-e08b-46dc-824f-d162546b6bf0.jpeg", "images": [], "latitude": null, "longitude": null, "plan_number": null, "plot_number": null}''')

# 51592 — the one MONTHLY-ONLY rent in the catalogue; kitchens 1 with is_kitchen_installed 0;
# ground floor 0; year_built "2026".
RENT_51592 = json.loads(r'''{"id": 51592, "name_ar": null, "type": "building_apartment", "purpose": "rent", "category": "residential", "availability_status": "available", "unit_number": "R 5139", "description_ar": "<p>\"</p><p> رقم العرض : R 5139</p><p>نوع العقار:  شقق مؤثثة  للايجار  </p><p>الموقع : البساتين</p>", "district": {"id": 10200018080, "name_en": "Al Basatin Dist.", "name_ar": "حي البساتين"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": null, "rent_price_monthly": 7500, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": null, "built_up_area": null, "bedrooms": 2, "bathrooms": 3, "living_rooms": 1, "majlis_rooms": 1, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 1, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 0, "parking_spots": 0, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": 0, "number_of_floors": 0, "year_built": "2026", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7201060694", "rega_advertiser_number": "1200008917", "whatsapp_number": "+966539605605", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/51592/cover/fbf2c30f-4762-455e-907b-1fc3bb903390.jpeg", "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/51592/cover/fbf2c30f-4762-455e-907b-1fc3bb903390.jpeg"}, {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/51592/c041c6e3-8525-418c-b9d8-8f125e25b476.jpeg"}], "latitude": null, "longitude": null, "plan_number": null, "plot_number": null}''')

# 49287 — land for sale whose counts are the form's ZERO defaults (38 of the 62 land items publish
# exactly this shape). has_sewage 0 is SILENCE, not a stated negative — live-verified 2026-09-24
# (www.goldendeal.sa/properties/49287): the rendered «الخدمات» strip on this listing's own page
# shows only كهرباء + ماء; the صرف صحي row is simply absent from the DOM, exactly like every other
# dead-zero flag on this platform (trap 5). Matches the docstring's own trap-5 measurement.
LAND_49287 = json.loads(r'''{"id": 49287, "name_ar": "ارض تجارية مميزة للبيع في جدة - الريان", "type": "land", "purpose": "sell", "category": "residential", "availability_status": "available", "unit_number": "GD8054", "description_ar": "<p style=\"text-align: right;\">رقم العرض  : GD 8054</p><p style=\"text-align: right;\">نوع العقار:   ارض  تجارية  للبيع </p><p style=\"text-align: right;\">الموقع:   حي الريان</p><p style=\"text-align: right;\">المساحة: 690 م</p>", "district": {"id": 10200018018, "name_en": "Ar Rayaan Dist.", "name_ar": "حي الريان"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": 2700000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 690, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "living_rooms": 0, "majlis_rooms": 0, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 0, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 0, "parking_spots": 0, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 0, "unit_floor_number": 0, "number_of_floors": 0, "year_built": "0", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7200983191", "rega_advertiser_number": "7200983191", "whatsapp_number": "+966543777151", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/49287/cover/248439af-2674-4b52-a05a-e9f77917b6de.jpg", "images": [], "latitude": "21.709537833636", "longitude": "39.206571234728"}''')

# 53927 — a duplex for sale, year_built "2015", parking_spots 1, kitchens 1.
DUPLEX_53927 = json.loads(r'''{"id": 53927, "name_ar": null, "type": "duplex", "purpose": "sell", "category": "residential", "availability_status": "available", "unit_number": "GD 368", "description_ar": "<p>\"\"\"رقم العرض : GD 368 </p><p>نوع العقار : فيلا دبلكس متصلة بحـي النعيم</p>", "district": {"id": 10200018079, "name_en": "An Naim Dist.", "name_ar": "حي النعيم"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": 2500000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 310, "built_up_area": null, "bedrooms": 7, "bathrooms": 5, "living_rooms": 1, "majlis_rooms": 0, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 1, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 0, "parking_spots": 1, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": null, "number_of_floors": 0, "year_built": "2015", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7201143903", "rega_advertiser_number": "1200008917", "whatsapp_number": "+966559705705", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/53927/cover/d9a286e3-9b99-464f-b620-5c17c78544b1.jpeg", "images": [], "latitude": null, "longitude": null, "plan_number": null, "plot_number": null}''')

# 46701 — SOLD building (name_ar set); 52537 — UNAVAILABLE villa.
SOLD_46701 = json.loads(r'''{"id": 46701, "name_ar": "عمارة للبيع في موقع مميز على شارعين حي السلامة", "type": "building", "purpose": "sell", "category": "residential", "availability_status": "sold", "unit_number": "GD8009", "description_ar": "<p style=\"text-align: right;\"></p>", "district": {"id": 10200018035, "name_en": "As Salamah Dist.", "name_ar": "حي السلامة"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": 3000000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": null, "bedrooms": 0, "bathrooms": 0, "year_built": "0", "facade": null, "rega_ad_number": "7200820307", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/46701/cover/a288084e-04d4-4eba-8774-6cf0a5a225ec.jpeg", "images": [], "latitude": "21.612415335536", "longitude": "39.153358853508"}''')
UNAVAILABLE_52537 = {**json.loads(r'''{"id": 52537, "name_ar": null, "type": "villa", "purpose": "sell", "category": "residential", "availability_status": "unavailable", "unit_number": "GD 9004"}'''), "district": LAND_50495["district"], "city": LAND_50495["city"]}

# 50505 — available villa whose description ends in two bare phone-number paragraphs.
VILLA_50505 = json.loads(r'''{"id": 50505, "name_ar": null, "type": "villa", "purpose": "sell", "category": "residential", "availability_status": "available", "unit_number": "GD996", "description_ar": "<p>\"\"\"رقم العرض : GD996</p><p>نوع العقار:   فيلا عظم </p><p>الموقع:  الياقوت </p><p>المساحة:  625 م</p><p>شارع جنوبي 30 م  </p><p>رقم الترخيص:    7201016600</p><p>المطلوب:  2.200.000  </p><p>0559705705</p><p>0543777151 </p>", "district": {"id": 10200018003, "name_en": "Al Yaqoot Dist.", "name_ar": "حي الياقوت"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": 2200000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": null, "daily_price": null, "area": 625, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "living_rooms": 0, "majlis_rooms": 0, "maid_rooms": 0, "driver_rooms": 0, "kitchens": 0, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 0, "parking_spots": 0, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": null, "number_of_floors": 0, "year_built": "0", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7201016600", "rega_advertiser_number": "1200008917", "whatsapp_number": "+966543777151", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/50505/cover/705be36c-037c-4c75-a663-ae0299abca32.jpeg", "images": [], "latitude": null, "longitude": null, "plan_number": null, "plot_number": null}''')

# 49031 — trap 11: purpose=rent (rent_price_annually 55000, available) but name_ar AND the
# description both say «للبيع» — the title names the OTHER deal. Live-verified 2026-09-24.
RENT_49031 = json.loads(r'''{"id": 49031, "name_ar": "شقة فاخرة للبيع في موقع مميز بجدة - السلامة", "type": "building_apartment", "purpose": "rent", "category": "residential", "availability_status": "available", "unit_number": "R5080", "description_ar": "<p style=\"text-align: right;\">رقم العرض : R 5080</p><p style=\"text-align: right;\">نوع العقار : شقة  فاخرة للايجار</p><p style=\"text-align: right;\">الموقع : حي السلامة 2</p>", "district": {"id": 10200018035, "name_en": "As Salamah Dist.", "name_ar": "حي السلامة"}, "city": {"id": 18, "name_en": "Jeddah", "name_ar": "جدة"}, "selling_price": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "rent_price_annually": 55000, "daily_price": null, "area": null, "built_up_area": null, "bedrooms": 3, "bathrooms": 3, "living_rooms": 1, "majlis_rooms": 0, "maid_rooms": 0, "driver_rooms": 1, "kitchens": 1, "is_kitchen_installed": 0, "is_ac_installed": 0, "is_furnished": 0, "elevators": 1, "parking_spots": 1, "balconies": 0, "has_electricity": 1, "has_water": 1, "has_sewage": 1, "unit_floor_number": 0, "number_of_floors": 0, "year_built": "0", "facade": null, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "rega_ad_number": "7200972347", "rega_advertiser_number": "7200972347", "whatsapp_number": "+966539605605", "cover_image_url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/49031/cover/5e15d7b7-3768-4fc0-9ef6-2020bba977b4.jpeg", "images": [], "latitude": "21.610215573488", "longitude": "39.143802467058", "plan_number": null, "plot_number": null}''')

API_404 = '{\n    "message": "No query results for model [App\\\\Models\\\\Property] 99999999"\n}'


# ── PRICE = SOURCE ──────────────────────────────────────────────────────────────────────────────
def test_selling_price_is_stored_verbatim_and_never_per_metre():
    row, cat, why = _map(LAND_50495)
    assert why == "" and cat == "residential"
    assert (row["price_total"], row["price_per_meter"], row["price_annual"]) == (9000000, None, None)
    assert row["area_m2"] == 958 and row["additional_info"]["area_exact"] == "958.15"


def test_monthly_only_rent_is_annualised_through_the_shared_helper_and_tagged_monthly():
    row, _, why = _map(RENT_51592)
    assert why == ""
    assert (row["rent_period"], row["price_annual"], row["price_total"]) == ("monthly", 90000, None)
    assert row["additional_info"]["rent_published"] == {"monthly": 7500}


def test_semi_annual_only_has_no_bucket_and_is_never_parked_as_annual():
    # Same verbatim item with the monthly figure moved to the semi-annual field (documented edit).
    item = {**RENT_51592, "rent_price_monthly": None, "rent_price_semi_annually": 45000}
    row, _, why = _map(item)
    assert why == "" and (row["rent_period"], row["price_annual"]) == (None, None)
    assert row["additional_info"]["rent_published"] == {"semi_annually": 45000}


def test_a_daily_only_price_is_a_nightly_let_and_is_skipped():
    item = {**RENT_51592, "rent_price_monthly": None, "daily_price": 300}       # documented edit
    row, _, why = _map(item)
    assert row is None and why == "daily_only"


def test_a_sale_with_no_figure_keeps_both_price_columns_null():
    row, _, why = _map({**LAND_51738, "selling_price": None})                    # documented edit
    assert why == "" and row["price_total"] is None and row["price_per_meter"] is None


# ── SKIPS, NEVER GUESSES ────────────────────────────────────────────────────────────────────────
def test_sold_and_unavailable_items_are_skipped_by_the_sources_own_status():
    assert _map(SOLD_46701)[::2] == (None, "status_sold")
    assert _map(UNAVAILABLE_52537)[::2] == (None, "status_unavailable")


def test_a_title_naming_the_opposite_deal_is_skipped_not_written_as_stated():
    # trap 11: purpose=rent + rent_price_annually 55000, but name_ar says «للبيع» — a source
    # stating both deals has stated neither. Mutation-checked: removing the _OPPOSITE_DEAL guard
    # in run.py must turn this red.
    assert _map(RENT_49031)[::2] == (None, "deal_conflict")
    # the reverse direction (purpose=sell, name_ar says «للإيجار») is the same trap, mirrored.
    assert _map({**LAND_51738, "name_ar": "أرض للإيجار في مكة"})[::2] == (None, "deal_conflict")
    # a title that merely REPEATS the stated deal is not a conflict.
    assert _map({**RENT_49031, "name_ar": "شقة فاخرة للإيجار في موقع مميز بجدة"})[2] == ""


def test_an_unmapped_type_is_skipped_not_guessed():
    assert _map({**DUPLEX_53927, "type": "palace"})[::2] == (None, "type_unmapped")   # documented edit


def test_a_city_the_catalogue_cannot_place_is_skipped_not_defaulted():
    item = {**LAND_51738, "city": {"id": 2213, "name_en": "Ar'ar", "name_ar": "عرعر"}}
    assert _map(item)[::2] == (None, "city_not_in_catalog")


def test_a_missing_id_is_skipped():
    assert _map({**LAND_50495, "id": None})[::2] == (None, "missing_id")
    assert _map({})[::2] == (None, "missing_id")


# ── ADVANCED-FILTER FACTS ───────────────────────────────────────────────────────────────────────
def test_three_street_widths_leave_the_column_null_and_the_two_sided_facade_no_direction():
    row, _, _ = _map(LAND_50495)
    assert row["street_width_m"] is None
    assert row["additional_info"]["street_widths"] == {"north": 12, "east": 29, "south": 30}
    assert row["direction"] is None and row["additional_info"]["facade_raw"] == "north_south"


def test_a_single_width_and_a_single_facade_reach_their_columns():
    row, _, _ = _map(LAND_51738)
    assert row["street_width_m"] == 15 and row["direction"] == "غرب"
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("مكة المكرمة", 6, 2)


def test_land_carries_no_amenity_key_and_no_age_but_keeps_its_utilities():
    # The zero-default plot: every count is a published 0, and NONE of it may become an amenity
    # fact about a bare plot — the keys must be ABSENT (silence), not False.
    row, _, why = _map(LAND_49287)
    assert why == ""
    for k in ("elevator", "kitchen", "parking", "furnished", "air_conditioner", "maid_room",
              "driver_room", "balcony_terrace"):
        assert k not in row, k
    assert row["halls"] is None and row["floor_number"] is None and row["bedrooms"] is None
    # has_sewage 0 is the same dead-zero-flag silence as every other count on this platform
    # (trap 5): live-verified, the page renders no «صرف صحي» row for this listing at all.
    assert (row["electricity"], row["water_supply"], row["sanitation"]) == (True, True, None)
    assert row["property_age"] is None and row["price_total"] == 2700000
    # The null-count plot lands in the same place.
    row, _, _ = _map(LAND_50495)
    assert "elevator" not in row and "kitchen" not in row and row["sanitation"] is True


def test_a_counted_kitchen_beats_the_zero_flag_and_a_lone_zero_flag_stays_silent():
    row, _, _ = _map(RENT_51592)
    assert row["kitchen"] is True                        # kitchens 1, is_kitchen_installed 0
    # is_furnished is 0 (a dead flag) but the office's own title says «شقق مؤثثة» — the prose
    # statement wins, same rule as a counted amenity beating its own zero flag (trap 5).
    assert row["furnished"] is True
    # elevators/parking_spots are 0 here with NO prose mentioning either — a dead form field,
    # never a stated negative, so the keys are ABSENT, not False.
    for k in ("elevator", "parking"):
        assert k not in row, k
    assert row["floor_number"] == 0                      # ground floor is a value, not silence
    assert (row["bedrooms"], row["bathrooms"], row["halls"], row["reception_rooms_majlis"]) == (2, 3, 1, 1)


def test_year_built_zero_is_unknown_and_a_year_becomes_an_exact_age():
    assert _map(VILLA_50505)[0]["property_age"] is None            # "0" = not provided
    assert _map(DUPLEX_53927)[0]["property_age"] == 11             # 2015 at this_year 2026
    assert _map(RENT_51592)[0]["property_age"] == 0                # 2026


def test_duplex_files_where_the_shared_taxonomy_puts_it():
    row, cat, _ = _map(DUPLEX_53927)
    assert row["property_type"] == "Duplex" and cat == "commercial"
    assert row["parking"] is True and row["kitchen"] is True and row["bedrooms"] == 7


def test_commercial_land_follows_the_sources_own_category():
    row, cat, _ = _map({**LAND_50495, "category": "commercial"})
    assert row["property_type"] == "Commercial Land" and cat == "commercial"


# ── IDENTITY, TITLE, PHOTOS, PII ────────────────────────────────────────────────────────────────
def test_identity_title_fallback_and_photos():
    row, _, _ = _map(LAND_50495)
    assert row["ad_number"] == "GDL50495"
    assert row["listing_url"] == "https://www.goldendeal.sa/properties/50495"
    assert row["source"] == "الصفقة الذهبية العقارية"
    assert row["title"] == "أرض للبيع"                    # name_ar null → the site's own composition
    assert row["additional_info"]["type_ar"] == "أرض" and row["additional_info"]["ref"] == "8231963"
    assert row["photo_urls"] == [
        "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/50495/cover/07245067-31b0-4740-83fc-578ace6d5b16.jpeg",
        "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/7102/properties/50495/b6adde69-5675-4272-bfd6-8fad0abe54c2.jpeg"]
    assert (row["district_ar"], row["neighborhood"]) == ("حي الروضة", "حي الروضة")


def test_a_published_name_is_the_title_verbatim():
    row, _, _ = _map({**SOLD_46701, "availability_status": "available"})       # documented edit
    assert row["title"] == "عمارة للبيع في موقع مميز على شارعين حي السلامة"
    assert row["additional_info"]["latitude"] == pytest.approx(21.612415335536)


def test_phones_are_stripped_and_the_broker_licence_never_stored_but_the_ad_licence_is():
    row, _, _ = _map(VILLA_50505)
    blob = json.dumps(row, ensure_ascii=False)
    for tok in ("0559705705", "0543777151", "+966543777151", "1200008917"):
        assert tok not in blob, tok
    assert "[redacted]" in row["description"] and "رقم الترخيص: 7201016600" in row["description"]
    assert row["license_number"] == "7201016600"
    assert "whatsapp_number" not in row["source_capture"]
    assert "rega_advertiser_number" not in row["source_capture"]
    assert "images" not in row["source_capture"] and row["source_capture"]["schema"] == "nuzul.v1"


# ── LIVENESS: the measured signal under the shared law ──────────────────────────────────────────
def test_signal_reads_the_measured_shapes():
    sig = R._signal_for(50495)
    assert sig(404, API_404, False) == "gone"
    assert sig(200, json.dumps({"data": LAND_50495}), False) == "live"
    assert sig(200, json.dumps({"data": SOLD_46701}), False) is None       # another id: no opinion
    assert R._signal_for(46701)(200, json.dumps({"data": SOLD_46701}), False) == "gone"
    assert sig(200, "<html>not json</html>", False) is None
    assert sig(403, "", False) is None and sig(404, "", False) is None


def _session(answers):
    class _S:
        def get(self, url, **_kw):
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return types.SimpleNamespace(status_code=a[0], text=a[1], url=url,
                                         json=lambda: json.loads(a[1]))
    return _S()


def test_verify_gone_kills_only_a_404_behind_a_passing_canary(monkeypatch):
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda s: None)
    ok = R.verify_gone_for(R.TENANT, canary=lambda: (True, "ok"), session_factory=lambda: _session([(404, API_404)]))
    assert ok("GDL99999999")[0] == "gone"
    blocked = R.verify_gone_for(R.TENANT, canary=lambda: (True, "ok"),
                                session_factory=lambda: _session([(403, "x"), (403, "x")]))
    assert blocked("GDL99999999")[0] == "unknown"
    assert ok("BSB1")[0] == "unknown"                                       # not this tenant's ad


def test_the_canary_fails_closed():
    assert R.make_canary(R.TENANT, None)()[0] is False
    unreachable = R.make_canary(R.TENANT, 50495, session_factory=lambda: _session([ConnectionError("down")]))
    assert unreachable()[0] is False
    wrong_echo = R.make_canary(R.TENANT, 50495, session_factory=lambda: _session([(200, json.dumps({"data": SOLD_46701}))]))
    assert wrong_echo()[0] is False
    good = R.make_canary(R.TENANT, 50495, session_factory=lambda: _session([(200, json.dumps({"data": LAND_50495}))]))
    assert good() == good() and good()[0] is True                           # memoised


def test_fetch_all_walks_to_last_page_and_returns_the_api_total():
    page = lambda rows, n: (200, json.dumps({"data": rows, "meta": {"total": 3, "last_page": 2, "current_page": n}}))
    s = _session([page([LAND_50495, LAND_51738], 1), page([RENT_51592, LAND_50495], 2)])
    items, total = R.fetch_all(s, R.TENANT)
    assert [i["id"] for i in items] == [50495, 51738, 51592] and total == 3


# ── main(): the tally reaches end_run, prune waits for a complete enumeration ───────────────────
def _stub_db(monkeypatch, written, ended, pruned):
    monkeypatch.setattr(R, "session", lambda tenant=None: object())
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 3)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda table, rows: written.setdefault(table, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: pruned.append((tbl, kw.get("verify_gone") is not None)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: ended.update(kw) or True)


ITEMS = [LAND_50495, SOLD_46701, UNAVAILABLE_52537, {**DUPLEX_53927, "type": "palace"}, DUPLEX_53927]


def test_main_tallies_every_skip_into_end_run_and_prunes_a_complete_crawl(monkeypatch):
    written, ended, pruned = {}, {}, []
    _stub_db(monkeypatch, written, ended, pruned)
    monkeypatch.setattr(R, "fetch_all", lambda s, tenant, limit=0: (ITEMS, 5))
    assert R.main([]) == 0
    assert [r["ad_number"] for r in written["goldendeal_residential_listings"]] == ["GDL50495"]
    assert [r["ad_number"] for r in written["goldendeal_commercial_listings"]] == ["GDL53927"]
    for tok in ("status_soldx1", "status_unavailablex1", "type_unmappedx1"):
        assert tok in ended["notes"], ended["notes"]
    assert ended["rows_seen"] == 5 and ended["rows_upserted"] == 2
    assert ended["check_tables"] == ["goldendeal_residential_listings", "goldendeal_commercial_listings"]
    assert pruned == [("goldendeal_residential_listings", True), ("goldendeal_commercial_listings", True)]


def test_main_never_prunes_when_the_enumeration_is_short_of_the_api_total(monkeypatch):
    written, ended, pruned = {}, {}, []
    _stub_db(monkeypatch, written, ended, pruned)
    monkeypatch.setattr(R, "fetch_all", lambda s, tenant, limit=0: (ITEMS, 275))
    assert R.main([]) == 0
    assert pruned == [] and ended["rows_seen"] == 5


def test_a_limit_or_dry_run_touches_no_table(monkeypatch):
    written, ended, pruned = {}, {}, []
    _stub_db(monkeypatch, written, ended, pruned)
    monkeypatch.setattr(R, "fetch_all", lambda s, tenant, limit=0: (ITEMS[:limit or None], 5))
    assert R.main(["--limit", "2"]) == 0 and R.main(["--dry-run"]) == 0
    assert written == {} and ended == {} and pruned == []
