"""Offline barrier for scrapers/jawher/run.py — the Nuzul-platform reading shared with m3tmd/senan.

Fixtures are VERBATIM /api/public/v2/properties/<id> records from www.jawher2030.com, captured
2026-09-24 and trimmed to the keys the code reads (image lists cut to two entries). Every test
executes the REAL functions (map_listing / nuzul_fields / rent_price_fields / fetch_ids /
fetch_detail / make_verify_gone / main); only to_catalog and find_district_in_text are stubbed.
A handful of tests take a verbatim record and change ONE named key to reach a branch this tenant's
live data does not exercise; each says so in its name.

What it pins: PRICE = SOURCE (a null price is an authoritative NULL, never a skip or a guess, and
never derived from area or prose); RENT PERIOD = SOURCE (annual verbatim, monthly ×12, any other
bucket or silence → NULL, never defaulted); zero-defaulted counters are silence (NULL), never 0 or
False; the AD licence is rega_ad_number and the FAL licence never reaches license_number; PII is
dropped from every field; the sitemap-sized «9» is not the catalogue; a 404 JSON is the only death
and a blocked transport is never one; the skip tally reaches end_run(notes=…).
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
from scrapers.jawher import run as R  # noqa: E402

_CATALOG = {"جدة": (18, 2), "مكة المكرمة": (6, 2), "الخرج": (1061, 1), "ابها": (15, 6)}


@pytest.fixture(autouse=True)
def _offline_catalog(monkeypatch):
    """The ONLY stubs: the two DB-backed location helpers, scoped per test so this file and its
    two tenant siblings can share one pytest process without clobbering each other's catalog."""
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: _CATALOG.get((city_ar or "").strip(), (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: (text or "").strip() or None)

# ── jawher 42818 — priced land, fractional area, HTML description carrying a mobile ──────────────
LAND = json.loads(r'''{"id": 42818, "resource_type": "property", "type": "land", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "1091140", "availability_status": "available", "name_ar": "أرض سكنية للبيع في حي اللؤلؤ في أبحر الشمالية", "description_ar": "<p style=\"text-align: center;\"><span style=\"font-family: UICTFontTextStyleEmphasizedBody; font-size: 20.52px;\"><strong>رض تجمع بين الرفاهية والموقع النخبوي والقيمة الاستثمارية العالية…</strong></span></p><p style=\"text-align: center;\"><span style=\"font-family: UICTFontTextStyleEmphasizedBody; font-size: 20.52px;\"><strong>مساحة&nbsp; : 447.35 م</strong></span></p><p style=\"text-align: center;\"><span style=\"font-family: UICTFontTextStyleEmphasizedBody; font-size: 20.52px;\"><strong>واجهة غربية على شارع ١٥ متر</strong></span></p><p><strong>للتواصل 0537488667</strong></p>", "district": {"id": 10200018098, "name_ar": "حي اللؤلؤ", "name_en": "Al Lulu Dist."}, "city": {"id": 18, "name_ar": "جدة", "name_en": "Jeddah"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": 1700000, "price": 1700000, "price_label": "1,700,000.00", "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 447.35, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": 15, "facade": "west", "rega_ad_number": "7100235312", "rega_advertiser_number": "1100098980", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/42818/c9a3d2c5-0a34-4fd0-8b07-2d1a5c8a0e11.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/42818/c9a3d2c5-0a34-4fd0-8b07-2d1a5c8a0e11_720.webp"}}, "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/42818/1b5f2b7e-6c1e-4c7c-9a2d-5e7f0c3b9a21.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/42818/1b5f2b7e-6c1e-4c7c-9a2d-5e7f0c3b9a21_720.webp"}}], "latitude": "21.774268", "longitude": "39.1245", "projects": [], "tags": [{"id": 41, "slug": "ard", "name_ar": "#أرض", "name_en": null, "color_hex": "#FF5D33"}], "whatsapp_number": "+966537488667", "plan_number": "394/ب/1403", "plot_number": "131/ب", "width": 16, "length": 28}''')

# ── jawher 25192 — annual rent, «ابتداءً من» label, two street widths, images without previews ──
RENT = json.loads(r'''{"id": 25192, "resource_type": "property", "type": "land", "purpose": "rent", "product": "office", "category": "commercial", "unit_number": "3417226", "availability_status": "available", "name_ar": null, "description_ar": null, "district": {"id": 10200018108, "name_ar": "حي الاجاويد", "name_en": "Al Ajaweed Dist."}, "city": {"id": 18, "name_ar": "جدة", "name_en": "Jeddah"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": true, "selling_price": null, "price": 120000, "price_label": "ابتداءً من 120,000.00", "rent_price_annually": 120000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 738, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": 25, "street_width_east": 25, "street_width_south": null, "street_width_west": null, "facade": "north_east", "rega_ad_number": "7100078254", "rega_advertiser_number": "1100098980", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/25192/0b3b0f48-688f-45e1-b66d-be01ec292618.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/25192/0b3b0f48-688f-45e1-b66d-be01ec292618_720.webp"}}, "images": [{"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/25192/dca8ee3b-0ce1-4079-8c64-c0a165ae8fb0.png", "previews": {}}, {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/25192/0718a45a-9fb0-473d-b16b-3f2d8c913f3e.png", "previews": {}}], "latitude": "21.417352056259", "longitude": "39.300942964934", "projects": [], "tags": [], "whatsapp_number": null, "plan_number": null, "plot_number": "781", "width": null, "length": null}''')

# ── jawher 38723 — an AVAILABLE building the office published with NO price ──────────────────────
NOPRICE = json.loads(r'''{"id": 38723, "resource_type": "property", "type": "building", "purpose": "sell", "product": "office", "category": "residential", "unit_number": "760821", "availability_status": "available", "name_ar": null, "description_ar": null, "district": {"id": 10200018105, "name_ar": "حي ابحر الجنوبية", "name_en": "Abhur Al Janubiyah Dist."}, "city": {"id": 18, "name_ar": "جدة", "name_en": "Jeddah"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": null, "price": null, "price_label": null, "rent_price_annually": null, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 1165, "built_up_area": null, "bedrooms": 0, "bathrooms": 0, "unit_floor_number": 0, "number_of_floors": 0, "living_rooms": 0, "majlis_rooms": 0, "elevators": 0, "parking_spots": 0, "kitchens": 0, "maid_rooms": 0, "driver_rooms": 0, "storage_rooms": 0, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": 125, "street_width_west": 16, "facade": "south_west", "rega_ad_number": "7100195195", "rega_advertiser_number": "1100098980", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/38723/5186c4d1-87b5-4bfd-a3ad-76ef3030f354.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/38723/5186c4d1-87b5-4bfd-a3ad-76ef3030f354_720.webp"}}, "images": [], "latitude": "21.752522", "longitude": "39.1449936", "projects": [], "tags": [], "whatsapp_number": "+966537488667", "plan_number": "216/ب / المعدل", "plot_number": "154", "width": null, "length": null}''')

# ── jawher 37796 — a SOLD rent unit the catalogue still publishes ────────────────────────────────
SOLD = json.loads(r'''{"id": 37796, "resource_type": "property", "type": "building_apartment", "purpose": "rent", "product": "office", "category": "residential", "unit_number": "37796", "availability_status": "sold", "name_ar": null, "description_ar": "روف للإيجار في موقع مميز في حي الموسى ڤيو \nيتميز بوجود\n8 مكيفات اسبليت جاهزة", "district": {"id": 10200018078, "name_ar": "حي طيبة", "name_en": "Taibah Dist."}, "city": {"id": 18, "name_ar": "جدة", "name_en": "Jeddah"}, "is_wafi_ad": false, "is_for_residential": true, "is_for_commercial": false, "selling_price": null, "price": 45000, "price_label": "ابتداءً من 45,000.00", "rent_price_annually": 45000, "rent_price_monthly": null, "rent_price_quarterly": null, "rent_price_semi_annually": null, "daily_price": null, "area": 144, "built_up_area": null, "bedrooms": 6, "bathrooms": 4, "unit_floor_number": 5, "number_of_floors": 5, "living_rooms": 1, "majlis_rooms": 2, "elevators": 1, "parking_spots": 1, "kitchens": 1, "maid_rooms": 1, "driver_rooms": 1, "storage_rooms": 0, "has_electricity": true, "has_water": true, "has_sewage": true, "is_ejari_enabled": false, "is_rize_enabled": false, "street_width": null, "street_width_east": null, "street_width_south": null, "street_width_west": null, "facade": "north", "rega_ad_number": "7100188209", "rega_advertiser_number": "1100098980", "cover_image": {"url": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/37796/28c18c39-8aad-40c9-822d-5b6ab726729e.png", "previews": {"720": "https://nuzul-saas-production.s3.us-east-2.amazonaws.com/tenants/2937/properties/37796/28c18c39-8aad-40c9-822d-5b6ab726729e_720.webp"}}, "images": [], "latitude": "21.8275298", "longitude": "39.1460152", "projects": [], "tags": [], "whatsapp_number": "+966537488667", "plan_number": null, "plot_number": null, "width": null, "length": null}''')


def _variant(base, **changes):
    d = json.loads(json.dumps(base))
    d.update(changes)
    return d


def _row(d):
    row, cat, why = R.map_listing(d)
    assert row is not None, why
    return row


# ── PRICE = SOURCE ───────────────────────────────────────────────────────────────────────────────
def test_sale_price_is_selling_price_verbatim_and_evidenced():
    row = _row(LAND)
    assert row["transaction_type"] == "Buy"
    assert row["price_total"] == 1_700_000
    assert "price_annual" not in row and "rent_period" not in row
    ev = row["price_evidence"]
    assert (ev["field"], ev["raw"], ev["stored"], ev["origin"]) == ("selling_price", 1_700_000, 1_700_000, "api")
    assert ev["authoritative_absent"] is False


def test_a_published_null_price_is_an_authoritative_null_not_a_skip_or_a_guess():
    row = _row(NOPRICE)
    assert row["price_total"] is db.AUTHORITATIVE_NULL, "the source printed no price: NULL is written, the row is kept"
    assert row["price_evidence"]["authoritative_absent"] is True and row["price_evidence"]["found"] is False


def test_the_display_price_label_is_never_the_stored_price():
    """`price`/`price_label` mirror the real field; RENT's label is «ابتداءً من 120,000.00»."""
    row = _row(RENT)
    assert row["additional_info"]["price_label"] == "ابتداءً من 120,000.00"
    assert row["price_annual"] == 120_000


def test_area_is_the_integer_part_and_the_exact_fraction_survives():
    row = _row(LAND)
    assert row["area_m2"] == 447
    assert row["additional_info"]["area_exact"] == 447.35


def test_price_is_never_derived_from_area():
    row = _row(_variant(LAND, selling_price=None, price=None, price_label=None))
    assert row["price_total"] is db.AUTHORITATIVE_NULL
    assert "price_per_meter" not in row


# ── RENT PERIOD = SOURCE ─────────────────────────────────────────────────────────────────────────
def test_annual_rent_is_stored_verbatim_with_its_own_period():
    row = _row(RENT)
    assert row["transaction_type"] == "Rent"
    assert (row["rent_period"], row["price_annual"]) == ("annual", 120_000)
    assert row["price_evidence"]["field"] == "rent_price_annually"


def test_monthly_rent_is_annualised_from_the_monthly_field_VARIANT():
    row = _row(_variant(RENT, rent_price_annually=None, rent_price_monthly=10_000))
    assert (row["rent_period"], row["price_annual"]) == ("monthly", 120_000)
    assert row["price_evidence"]["field"] == "rent_price_monthly" and row["price_evidence"]["raw"] == 10_000


def test_both_annual_and_monthly_stated_keeps_the_annual_figure_VARIANT():
    row = _row(_variant(RENT, rent_price_monthly=9_000))
    assert (row["rent_period"], row["price_annual"]) == ("annual", 120_000)


def test_a_quarterly_or_semi_annual_or_daily_only_rent_has_no_bucket_VARIANT():
    for k in ("rent_price_quarterly", "rent_price_semi_annually", "daily_price"):
        row = _row(_variant(RENT, rent_price_annually=None, **{k: 30_000}))
        assert row["rent_period"] is None and row["price_annual"] is db.AUTHORITATIVE_NULL, k
        assert row["additional_info"]["rent_prices_raw"] == {k: 30_000}


def test_a_silent_rent_period_is_never_defaulted_VARIANT():
    row = _row(_variant(RENT, rent_price_annually=None))
    assert row["rent_period"] is None and row["price_annual"] is db.AUTHORITATIVE_NULL


def test_rnpl_is_read_only_from_the_platforms_own_providers_VARIANT():
    assert "rent_now_pay_later" not in _row(RENT)
    assert _row(_variant(RENT, is_ejari_enabled=True))["rent_now_pay_later"] is True


# ── SKIP, NEVER GUESS ────────────────────────────────────────────────────────────────────────────
def test_a_sold_unit_still_in_the_catalogue_is_skipped_by_its_status():
    assert R.map_listing(SOLD) == (None, "residential", "status_sold")


def test_every_non_available_status_is_skipped_and_tallied_by_value_VARIANT():
    for status in ("reserved", "unavailable", "rented", "soon"):
        assert R.map_listing(_variant(LAND, availability_status=status))[2] == f"status_{status}"


def test_a_wafi_off_plan_ad_is_skipped_VARIANT():
    assert R.map_listing(_variant(LAND, is_wafi_ad=True))[2] == "off_plan_wafi"


def test_the_short_stay_product_is_skipped_VARIANT():
    assert R.map_listing(_variant(RENT, product="siyaha"))[2] == "product_siyaha"


def test_an_unmappable_type_is_skipped_not_guessed_VARIANT():
    for t in ("resort", "kiosk", "compound", "spaceship"):
        assert R.map_listing(_variant(LAND, type=t))[2] == "type_unmapped", t


def test_a_missing_city_is_skipped_never_defaulted_VARIANT():
    assert R.map_listing(_variant(LAND, city=None))[2] == "no_city"
    assert R.map_listing(_variant(LAND, city={"id": 9, "name_ar": "بلدة لا يعرفها الكتالوج", "name_en": "X"}))[2] == "city_not_in_catalog"


def test_a_missing_id_is_skipped_VARIANT():
    d = _variant(LAND)
    d.pop("id")
    assert R.map_listing(d)[2] == "no_id"
    assert R.map_listing(_variant(LAND, purpose="swap"))[2] == "purpose_swap"


# ── TYPE + CATEGORY ──────────────────────────────────────────────────────────────────────────────
def test_land_filed_commercial_by_the_office_is_commercial_land_and_use_flags_do_not_decide():
    assert R.map_listing(LAND)[1] == "residential" and _row(LAND)["property_type"] == "Residential Land"
    row, cat, _ = R.map_listing(RENT)             # category «commercial», both use flags on
    assert (row["property_type"], cat) == ("Commercial Land", "commercial")
    # commercial-only USE with the office's category still residential → the base type
    assert _row(_variant(LAND, is_for_residential=False, is_for_commercial=True))["property_type"] == "Residential Land"
    assert _row(_variant(NOPRICE, category="commercial"))["property_type"] == "Commercial Building"
    assert _row(_variant(LAND, type="building_apartment"))["property_type"] == "Apartment"
    assert _row(_variant(LAND, type="townhouse"))["property_type"] == "Villa"


# ── COUNTERS, AMENITIES, FACADE, STREETS ─────────────────────────────────────────────────────────
def test_zero_defaulted_counters_are_silence_not_zero_and_not_false():
    row = _row(NOPRICE)                            # every counter is 0 on this record
    for col in ("elevator", "parking", "kitchen", "maid_room", "driver_room", "furnished"):
        assert col not in row, col
    assert row["bedrooms"] is None and row["halls"] is None and row["reception_rooms_majlis"] is None
    assert row["floor_number"] is None


def test_bedrooms_are_written_only_on_a_dwelling_VARIANT():
    assert _row(_variant(LAND, bedrooms=3, bathrooms=2))["bedrooms"] is None, "land has no bedroom filter answer"
    v = _row(_variant(LAND, type="villa", bedrooms=3, bathrooms=2, elevators=1, unit_floor_number=2, living_rooms=2, majlis_rooms=1))
    assert (v["bedrooms"], v["bathrooms"], v["elevator"], v["floor_number"], v["halls"], v["reception_rooms_majlis"]) == (3, 2, True, 2, 2, 1)


def test_false_defaulted_service_flags_are_silence_and_true_is_true_VARIANT():
    row = _row(LAND)
    assert (row["electricity"], row["water_supply"], row["sanitation"]) == (True, True, True)
    off = _row(_variant(LAND, has_electricity=False, has_water=False, has_sewage=False))
    assert all(k not in off for k in ("electricity", "water_supply", "sanitation"))


def test_prose_negation_is_false_and_a_structured_counter_outranks_the_prose_VARIANT():
    neg = _row(_variant(LAND, description_ar="أرض بدون مصعد، غير مفروشة"))
    assert neg["elevator"] is False and neg["furnished"] is False
    both = _row(_variant(LAND, type="villa", elevators=1, description_ar="فيلا بدون مصعد"))
    assert both["elevator"] is True, "the source's own counter is applied last"


def test_facade_becomes_the_canonical_direction_and_a_corner_stays_null_VARIANT():
    assert _row(LAND)["direction"] == "غرب"
    assert _row(RENT)["direction"] == "شمال شرق"
    assert _row(NOPRICE)["direction"] == "جنوب غرب"
    assert _row(_variant(LAND, facade="north_south_west"))["direction"] is None
    assert _row(_variant(LAND, facade="north_south_west"))["additional_info"]["facade_raw"] == "north_south_west"
    assert _row(_variant(LAND, facade=None))["direction"] is None


def test_exactly_one_street_width_is_a_width_and_two_are_none():
    assert _row(LAND)["street_width_m"] == 15
    two = _row(RENT)
    assert two["street_width_m"] is None
    assert two["additional_info"]["street_widths"] == {"street_width": 25, "street_width_east": 25}


# ── LICENCE, PDPL, PHOTOS, IDENTITY ──────────────────────────────────────────────────────────────
def test_license_number_is_the_ad_licence_never_the_fal_licence():
    row = _row(LAND)
    assert row["license_number"] == "7100235312"
    assert row["additional_info"]["fal_licence_number"] == "1100098980"
    none = _row(_variant(LAND, rega_ad_number=None))
    assert none["license_number"] is None and none["additional_info"]["fal_licence_number"] == "1100098980"


def test_pii_is_stripped_from_every_field():
    row = _row(LAND)
    blob = json.dumps(row, ensure_ascii=False, default=str)
    assert "0537488667" not in blob and "966537488667" not in blob
    assert "whatsapp_number" not in json.dumps(row["source_capture"]) and "whatsapp" not in json.dumps(row["additional_info"])
    assert "<p" not in row["description"] and "مساحة : 447.35 م" in row["description"]


def test_photos_prefer_the_720_preview_and_fall_back_to_the_original():
    assert _row(LAND)["photo_urls"] == [LAND["cover_image"]["previews"]["720"], LAND["images"][0]["previews"]["720"]]
    rent = _row(RENT)["photo_urls"]
    assert rent[0].endswith("_720.webp") and rent[1] == RENT["images"][0]["url"] and len(rent) == 3


def test_identity_is_the_url_id_not_the_offices_unit_number():
    row = _row(LAND)
    assert row["ad_number"] == "JWH42818"
    assert row["listing_url"] == "https://www.jawher2030.com/properties/42818"
    assert row["additional_info"]["unit_number"] == "1091140"
    assert row["source"] == "جواهر للوساطة والتسويق العقاري"


def test_location_is_the_structured_city_and_district():
    row = _row(LAND)
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("جدة", 18, 2)
    assert row["district_ar"] == "حي اللؤلؤ" and row["neighborhood"] == "حي اللؤلؤ"
    assert row["title"] == "أرض سكنية للبيع في حي اللؤلؤ في أبحر الشمالية"
    assert _row(NOPRICE)["title"] == "عمارة للبيع في حي ابحر الجنوبية"


# ── TRANSPORT ────────────────────────────────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, status, body):
        self.status_code, self.text = status, body
        self.url = ""

    def json(self):
        return json.loads(self.text)


class _Session:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, **_):
        self.calls.append(url)
        got = self.routes.get(url)
        if isinstance(got, Exception):
            raise got
        return got


def _page(ids, page, last):
    return json.dumps({"data": [{"id": i} for i in ids], "meta": {"current_page": page, "last_page": last, "per_page": 50, "total": 3}})


def test_fetch_ids_walks_every_api_page_and_reports_completeness(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    b = "https://www.jawher2030.com/api/public/v2/properties"
    s = _Session({f"{b}?page=1&per_page=50": _Resp(200, _page([24915, 51496], 1, 2)),
                  f"{b}?page=2&per_page=50": _Resp(200, _page([42818], 2, 2))})
    assert R.fetch_ids(s, R.BASE) == ([24915, 51496, 42818], True)
    s = _Session({f"{b}?page=1&per_page=50": _Resp(200, _page([24915, 51496], 1, 2)),
                  f"{b}?page=2&per_page=50": _Resp(503, "")})
    assert R.fetch_ids(s, R.BASE) == ([24915, 51496], False), "a failed page is an INCOMPLETE enumeration"
    s = _Session({f"{b}?page=1&per_page=50": _Resp(200, _page([24915, 51496], 1, 2))})
    assert R.fetch_ids(s, R.BASE, limit=1) == ([24915], False), "a --limit run is never complete"
    assert R.fetch_ids(_Session({f"{b}?page=1&per_page=50": _Resp(403, "blocked")}), R.BASE) == ([], False)


def test_fetch_detail_reads_only_this_record_and_a_404_json_is_the_only_gone(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    u = "https://www.jawher2030.com/api/public/v2/properties/42818"
    assert R.fetch_detail(_Session({u: _Resp(200, json.dumps({"data": LAND}))}), R.BASE, 42818)[1] == "live"
    assert R.fetch_detail(_Session({u: _Resp(404, '{"message":"No query results for model [App\\\\Models\\\\Property] 42818"}')}), R.BASE, 42818) == (None, "gone")
    assert R.fetch_detail(_Session({u: _Resp(200, json.dumps({"data": {**LAND, "id": 1}}))}), R.BASE, 42818) == (None, "unknown")
    s = _Session({u: _Resp(403, "blocked")})
    assert R.fetch_detail(s, R.BASE, 42818) == (None, "unknown") and len(s.calls) == 3, "blocked ≠ gone, and it is retried"
    assert R.fetch_detail(_Session({u: RuntimeError("boom")}), R.BASE, 42818) == (None, "unknown")


def test_the_removal_oracle_kills_only_on_the_404_json_and_fails_closed_without_a_live_control(monkeypatch):
    from scrapers.common import http_liveness as HL
    answers = {}
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: answers[url])
    monkeypatch.setattr(HL.time, "sleep", lambda *_: None)
    api = "https://www.jawher2030.com/api/public/v2/properties/"
    gone = (404, '{"message":"No query results for model [App\\\\Models\\\\Property] 1"}', False)
    live = (200, json.dumps({"data": LAND}), False)
    control = {"ad_number": "JWH42818", "listing_url": "https://www.jawher2030.com/properties/42818"}
    verify = R.make_verify_gone(R.BASE, R.PREFIX, R.SLUG, control)
    answers.update({api + "1": gone, api + "42818": live})
    assert verify("JWH1")[0] == "gone"
    assert verify("JWH42818")[0] == "live"
    answers[api + "7"] = (403, "blocked", False)
    assert verify("JWH7")[0] == "unknown", "a block is never a death"
    answers[api + "9"] = (200, json.dumps({"data": {**LAND, "id": 8}}), False)
    assert verify("JWH9")[0] == "unknown", "a 200 for another record is no opinion"
    answers[api + "42818"] = (503, "", False)          # the control itself stops answering
    assert verify("JWH1")[0] == "unknown", "no live control → no removal (fails CLOSED)"
    assert R.make_verify_gone(R.BASE, R.PREFIX, R.SLUG, None)("JWH1")[0] == "unknown"
    assert verify("XYZ1")[0] == "unknown"


def test_the_removal_oracle_reads_the_status_flag_a_sold_row_still_served_with_200_is_gone(monkeypatch):
    """Measured 2026-09-24: sold 48506/45942/44329, unavailable 39450/26004, reserved 48840/36684
    all answer 200 with data.id and their status (7/7) — the platform never deletes them. A
    stored row that later sells is skipped by map_listing (so unseen), probed by prune_unseen,
    and MUST come back gone, or db.prune_unseen self-heals it forever."""
    from scrapers.common import http_liveness as HL
    answers = {}
    monkeypatch.setattr(HL.LivenessProbe, "fetch", lambda self, url: answers[url])
    monkeypatch.setattr(HL.time, "sleep", lambda *_: None)
    api = "https://www.jawher2030.com/api/public/v2/properties/"
    control = {"ad_number": "JWH42818"}
    verify = R.make_verify_gone(R.BASE, R.PREFIX, R.SLUG, control)
    answers[api + "42818"] = (200, json.dumps({"data": LAND}), False)
    answers[api + "37796"] = (200, json.dumps({"data": SOLD}), False)
    assert SOLD["availability_status"] == "sold" and SOLD["id"] == 37796
    assert verify("JWH37796") == ("gone", "source confirms removal (HTTP 200)")
    for status in ("reserved", "unavailable", "rented", "soon"):
        answers[api + "42818"] = (200, json.dumps({"data": LAND}), False)
        answers[api + "51496"] = (200, json.dumps({"data": _variant(LAND, id=51496, availability_status=status)}), False)
        assert verify("JWH51496")[0] == "gone", status
    answers[api + "51496"] = (200, json.dumps({"data": _variant(LAND, id=51496)}), False)
    assert verify("JWH51496")[0] == "live", "an available record is live"
    answers[api + "51496"] = (200, json.dumps({"data": _variant(SOLD, id=8)}), False)
    assert verify("JWH51496")[0] == "unknown", "a sold body for ANOTHER id is no opinion about this one"
    answers[api + "42818"] = (200, json.dumps({"data": _variant(LAND, availability_status="sold")}), False)
    answers[api + "37796"] = (200, json.dumps({"data": SOLD}), False)
    assert verify("JWH37796")[0] == "unknown", "a control that stopped answering live fails CLOSED"


# ── main(): the tally reaches end_run, prune is gated on completeness ────────────────────────────
def test_main_writes_both_tables_and_the_skip_tally_reaches_end_run(monkeypatch):
    records = {42818: LAND, 25192: RENT, 37796: SOLD, 99: _variant(LAND, id=99, city=None)}
    writes, calls, pruned = {}, {}, []
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_ids", lambda s, base, limit=0: ([42818, 25192, 37796, 99, 5], True))
    monkeypatch.setattr(R, "fetch_detail", lambda s, base, pid, tries=3: (records[pid], "live") if pid in records else (None, "gone"))
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R.db, "begin_run", lambda slug: calls.update(begin=slug) or 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: writes.update({t: [r["ad_number"] for r in rows]}))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: calls.update(retire=k) or 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen), "verify_gone" in k)) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(end=k) or True)
    assert R.main() == 0
    assert calls["begin"] == "jawher"
    assert writes == {"jawher_residential_listings": ["JWH42818"], "jawher_commercial_listings": ["JWH25192"]}
    assert calls["retire"]["res_ads"] == {"JWH42818"} and calls["retire"]["com_ads"] == {"JWH25192"}
    assert calls["retire"]["source"] == R.SOURCE
    end = calls["end"]
    assert end["check_tables"] == ["jawher_residential_listings", "jawher_commercial_listings"]
    assert end["rows_seen"] == 5 and end["rows_upserted"] == 2
    for token in ("status_soldx1", "no_cityx1", "fetch_gonex1", "pruned=0"):
        assert token in end["notes"], end["notes"]
    assert [p[:2] for p in pruned] == [("jawher_residential_listings", {"JWH42818"}), ("jawher_commercial_listings", {"JWH25192"})]
    assert all(p[2] for p in pruned), "prune runs only with the oracle"


def test_main_never_prunes_after_an_incomplete_enumeration(monkeypatch):
    calls, pruned = {}, []
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_ids", lambda s, base, limit=0: ([42818], False))
    monkeypatch.setattr(R, "fetch_detail", lambda s, base, pid, tries=3: (LAND, "live"))
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    monkeypatch.setattr(R.db, "begin_run", lambda slug: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda *a, **k: pruned.append(a) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)
    assert R.main() == 0
    assert pruned == [] and calls["rows_upserted"] == 1


def test_a_dark_source_is_a_failed_run_after_begin_run(monkeypatch):
    calls = {}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_ids", lambda s, base, limit=0: ([], False))
    monkeypatch.setattr(R.db, "begin_run", lambda slug: 7)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or False)
    assert R.main() == 1
    assert calls["ok"] is False and "returned no properties" in calls["notes"]
