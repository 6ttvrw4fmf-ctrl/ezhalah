"""سنام العقارية (snam.sa) barrier: the UNIT is the row, a reserved/sold unit is a skip, the city
comes only from what the address states, and a prepared lift shaft is not a lift.

Every assertion runs the SHIPPING functions — run.map_listing, run.city_from_location,
run.project_photos, run._signal_for, run.session, run.main — never a re-implementation. Only
to_catalog and find_district_in_text are stubbed (the barrier is offline).

PROVENANCE: every project and unit record below is copied VERBATIM from
`GET https://snam.sa/api/public/projects?page=1&limit=100` (Accept-Language: ar) on 2026-09-24,
trimmed to the keys the code reads (features/attributeValues keep only name/attributeName/value;
location keeps address/city/neighborhood). Nothing is constructed except where a test says
SYNTHETIC.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.snam import run as R  # noqa: E402

# Shaped like the REAL catalog (anon-key read, 2026-09-24): «أم الحمام» is a city of المنطقة
# الشرقية, «لبن» a region-1 city, «منطقة الرياض» a region label, and «النزهة» a cross-region twin
# that resolves ONLY under a region hint — every one of them is also a Riyadh district name.
_CATALOG = {"الرياض": (3, 1), "جدة": (5, 2), "أم الحمام": (134, 5), "لبن": (814, 1), "منطقة الرياض": (None, 1)}
_HINTED = {"النزهة": (4848, 1)}


def _to_catalog(city_ar, region_hint=None):
    key = (city_ar or "").strip()
    if region_hint is not None and key in _HINTED:
        return _HINTED[key]
    return _CATALOG.get(key, (None, None))


R.to_catalog = _to_catalog
R.find_district_in_text = lambda text, city_id: ("حي " + text.strip()) if text and not text.isascii() else None

TODAY = dt.date(2026, 9, 24)

P34 = {"id": 34, "name": "سنام 58 - حي الربيع (ادوار)", "status": "available", "isArchived": False, "location": {"address": "الربيع, بلدية الشمال, محافظة الرياض, منطقة الرياض, 13316, السعودية", "city": None, "neighborhood": "الربيع"}}
U70 = {"id": 70, "status": "available", "yearBuilt": "2025-05-05T00:00:00.000Z", "streetWidth": "20.00", "buildingArea": "169.00", "priceSar": "1390000.00", "propertyType": {"name": "فيلا "}, "unitNumber": "8_السطح", "isArchived": False, "name": "فيلا 42", "description": "عقار عصري يتميز بتصميم معماري فريد وإطلالات خلابة توفر لك الراحة والرفاهية", "features": [{"name": "موقف سيارة"}, {"name": "مصعد"}], "attributeValues": [{"attributeName": "صالة", "value": "1.00"}, {"attributeName": "غرفة نوم", "value": "2.00"}, {"attributeName": "مطبخ", "value": "1.00"}, {"attributeName": "دورة مياه", "value": "3.00"}, {"attributeName": "سطح", "value": "1.00"}]}
U69 = {"id": 69, "status": "available", "yearBuilt": "2025-05-05T00:00:00.000Z", "streetWidth": "20.00", "buildingArea": "248.00", "priceSar": "1990000.00", "propertyType": {"name": "فيلا "}, "unitNumber": "8_الأرضي", "isArchived": False, "name": "فيلا 41", "description": "خيار مثالي لمن يبحث عن الحداثة والخصوصية في بيئة سكنية متكاملة الخدمات.\n", "features": [{"name": "موقف سيارة"}], "attributeValues": [{"attributeName": "مجلس ", "value": "1.00"}, {"attributeName": "غرفة نوم", "value": "3.00"}, {"attributeName": "غرفة خادمة ", "value": "1.00"}, {"attributeName": "صالة", "value": "1.00"}, {"attributeName": "مطبخ", "value": "1.00"}, {"attributeName": "غرفة سائق ", "value": "1.00"}, {"attributeName": "دورة مياه", "value": "5.00"}, {"attributeName": "غرفة غسيل", "value": "2.00"}]}
P15 = {"id": 15, "name": "سنام 55 - النرجس (أدوار)", "status": "available", "isArchived": False, "location": {"address": "النرجس، منطقة الرياض، السعودية", "city": None, "neighborhood": "النرجس"}}
U24 = {"id": 24, "status": "sold", "yearBuilt": "2025-05-05T00:00:00.000Z", "streetWidth": "20.00", "buildingArea": "173.00", "priceSar": "0.00", "propertyType": {"name": "مبنى"}, "unitNumber": "فيلا 9", "isArchived": False, "name": "الملحق", "description": "ملحق عملي ومساحته واسعة، يوفر راحة إضافية تناسب جميع الاحتياجات المنزلية", "features": [{"name": "مؤثث"}, {"name": "توفر ماء"}, {"name": "توفر كهرباء"}, {"name": "توفر صرف صحي"}], "attributeValues": [{"attributeName": "مجلس ", "value": "1.00"}, {"attributeName": "صالة", "value": "1.00"}, {"attributeName": "مطبخ", "value": "1.00"}, {"attributeName": "غرفة نوم", "value": "3.00"}, {"attributeName": "دورة مياه", "value": "3.00"}]}
U20 = {"id": 20, "status": "reserved", "yearBuilt": "2025-05-05T00:00:00.000Z", "streetWidth": "20.00", "buildingArea": "179.00", "priceSar": "0.00", "propertyType": {"name": "مبنى"}, "unitNumber": "فيلا6", "isArchived": False, "name": "الطابق الأول", "description": "عقار أنيق يجمع بين التصميم العصري والموقع المميز لتجربة سكن راقية.", "features": [{"name": "مؤثث"}, {"name": "توفر ماء"}, {"name": "توفر كهرباء"}, {"name": "توفر صرف صحي"}], "attributeValues": [{"attributeName": "مجلس ", "value": "1.00"}, {"attributeName": "صالة", "value": "1.00"}, {"attributeName": "مطبخ", "value": "1.00"}, {"attributeName": "غرفة نوم", "value": "3.00"}, {"attributeName": "دورة مياه", "value": "3.00"}]}
P14 = {"id": 14, "name": "سنام 55 - النرجس (فلل)", "status": "available", "isArchived": False, "location": {"address": "النرجس، منطقة الرياض، السعودية", "city": None, "neighborhood": "النرجس"}}
U51 = {"id": 51, "status": "available", "yearBuilt": "2025-08-05T00:00:00.000Z", "streetWidth": "20.00", "buildingArea": "250.00", "priceSar": "3290000.00", "propertyType": {"name": "فيلا "}, "unitNumber": "13-أول", "isArchived": False, "name": "فيلا 23", "description": ".عقار أنيق بموقع مميز وتصميم عصري يلبي كافة احتياجات السكن", "features": [{"name": "موقف سيارة"}, {"name": "تأسيس مصعد"}, {"name": "مدخل خاص"}], "attributeValues": [{"attributeName": "ملحق ", "value": "1.00"}, {"attributeName": "مجلس ", "value": "1.00"}, {"attributeName": "صالة طعام ", "value": "1.00"}, {"attributeName": "مطبخ", "value": "1.00"}, {"attributeName": "صالة", "value": "3.00"}, {"attributeName": "دورة مياه", "value": "8.00"}, {"attributeName": "غرفة خادمة ", "value": "1.00"}, {"attributeName": "جناح نوم رئيسي ", "value": "1.00"}, {"attributeName": "غرفة نوم", "value": "4.00"}, {"attributeName": "ترس", "value": "1.00"}, {"attributeName": "سطح", "value": "1.00"}]}
P45 = {"id": 45, "name": "سنام 51-شقق", "status": "available", "isArchived": False, "location": {"address": "Al Gharara Valley, Ad Dirah, Riyadh, Riyadh governorate, Riyadh Region, 11131, Saudi Arabia", "city": "Riyadh", "neighborhood": "Ad Dirah"}}
U77 = {"id": 77, "status": "reserved", "streetWidth": "20.00", "buildingArea": None, "priceSar": None, "unitNumber": "B", "isArchived": False, "name": "السطح", "description": "تصاميم معمارية تعتمد على استغلال المساحات بذكاء، لتقديم وحدات عملية تجمع بين البساطة والجمال.", "features": [], "attributeValues": [{"attributeName": "غرفة نوم", "value": "3.00"}, {"attributeName": "دورة مياه", "value": "3.00"}, {"attributeName": "مطبخ", "value": "1.00"}, {"attributeName": "صالة", "value": "1.00"}, {"attributeName": "مجلس ", "value": "1.00"}, {"attributeName": "سطح", "value": "1.00"}, {"attributeName": "شرفة", "value": "1.00"}, {"attributeName": "غرفة غسيل", "value": "1.00"}]}
PHOTOS = ["https://snam.sa/uploads/projects/34-thumbnail-1767304387580-qmr82kz.png"]


def _row(project, unit, photos=PHOTOS):
    row, cat, why = R.map_listing(project, unit, photos, today=TODAY)
    assert row is not None, why
    return row, cat


# ── 1. THE UNIT IS THE ROW ──────────────────────────────────────────────────────────────────────
def test_a_unit_is_one_listing_with_the_projects_city_and_its_own_price():
    row, cat = _row(P34, U70)
    assert row["ad_number"] == "SNM34U70" and row["listing_url"] == "https://snam.sa/ar/properties/70"
    assert row["transaction_type"] == "Buy" and row["property_type"] == "Villa" and cat == "residential"
    assert row["price_total"] == 1390000 and "price_annual" not in row and "rent_period" not in row
    assert row["price_evidence"]["raw"] == "1390000.00" and row["price_evidence"]["stored"] == 1390000
    assert row["city_ar"] == "الرياض" and row["city_id"] == 3 and row["region_id"] == 1   # via «محافظة الرياض»
    assert row["district_ar"] == "حي الربيع" and row["neighborhood"] == "الربيع"
    assert row["area_m2"] == 169 and row["street_width_m"] == 20
    assert row["property_age"] == 1                                    # yearBuilt 2025, run in 2026
    assert row["bedrooms"] == 2 and row["bathrooms"] == 3 and row["halls"] == 1
    assert row["kitchen"] is True and row["elevator"] is True and row["parking"] is True
    assert "maid_room" not in row and "driver_room" not in row          # silent → absent, never False
    assert row["additional_info"]["other_attributes"] == {"سطح": "1.00"}
    assert row["photo_urls"] == PHOTOS
    assert row["title"] == "فيلا 42 – سنام 58 - حي الربيع (ادوار)"


def test_named_counts_reach_their_columns_and_a_missing_lift_stays_absent():
    row, _ = _row(P34, U69)
    assert row["ad_number"] == "SNM34U69" and row["price_total"] == 1990000
    assert row["bedrooms"] == 3 and row["bathrooms"] == 5 and row["halls"] == 1
    assert row["reception_rooms_majlis"] == 1
    assert row["maid_room"] is True and row["driver_room"] is True and row["laundry_room"] is True
    assert row["parking"] is True and "elevator" not in row


# ── 2. A PREPARED SHAFT IS NOT A LIFT ───────────────────────────────────────────────────────────
def test_prepared_lift_shaft_leaves_elevator_null_while_named_features_still_count():
    row, _ = _row(P14 | {"location": P34["location"]}, U51)
    assert "elevator" not in row                                       # «تأسيس مصعد»
    assert row["parking"] is True and row["private_entrance"] is True
    assert row["master_bedrooms"] == 1 and row["bedrooms"] == 4 and row["halls"] == 3
    assert row["balcony_terrace"] is True                              # «ترس» 1.00
    assert "تأسيس مصعد" in row["additional_info"]["features"]


def test_a_stated_zero_count_is_a_source_false_and_silence_is_absent():
    """SYNTHETIC: U70's kitchen count published as 0, and its kitchen attribute removed."""
    zero = json.loads(json.dumps(U70))
    zero["attributeValues"][2]["value"] = "0.00"
    row, _ = _row(P34, zero)
    assert row["kitchen"] is False
    silent = json.loads(json.dumps(U70))
    silent["attributeValues"] = [a for a in silent["attributeValues"] if a["attributeName"] != "مطبخ"]
    row, _ = _row(P34, silent)
    assert "kitchen" not in row


# ── 3. THE CITY COMES FROM THE ADDRESS, NEVER A DEFAULT ─────────────────────────────────────────
def test_city_resolution_reads_only_what_the_address_states():
    assert R.city_from_location(P34["location"]) == "الرياض"           # «محافظة الرياض» → the seat city
    assert R.city_from_location(P45["location"]) == "الرياض"           # English «Riyadh» → the closed table
    assert R.city_from_location(P15["location"]) is None               # a REGION + district only → nothing
    assert R.city_from_location({"address": "", "city": None}) is None
    assert R.map_listing(P15, U70, PHOTOS, today=TODAY)[2] == "city_not_in_catalog"
    row, _ = _row(P45, U70)
    assert row["city_ar"] == "الرياض" and row["district_ar"] is None and row["neighborhood"] == "Ad Dirah"


def test_a_district_that_is_also_a_catalog_city_never_becomes_the_city():
    """Live addresses of projects 36 and 11 (2026-09-24) with `city` null — the shape 25/29 projects
    use. The district is the FIRST component; walked fine→coarse it would be tried as a city."""
    p36 = {"address": "أم الحمام, بلدية المعذر, الرياض, محافظة الرياض, منطقة الرياض, 12512, السعودية",
           "city": None, "neighborhood": "أم الحمام"}
    assert R.city_from_location(p36) == "الرياض"                       # coarse end first, never «أم الحمام»
    row, _ = _row({**P34, "location": p36}, U70)
    assert row["city_ar"] == "الرياض" and row["city_id"] == 3 and row["region_id"] == 1
    # The region the address names refuses a foreign city even when the neighborhood label differs.
    assert R.city_from_location({"address": "أم الحمام, منطقة الرياض, السعودية", "city": None,
                                 "neighborhood": "حي أم الحمام"}) is None
    # The source's own neighborhood label is never a candidate — a region-1 city name included.
    assert R.city_from_location({"address": "لبن، منطقة الرياض، السعودية", "city": None, "neighborhood": "لبن"}) is None
    assert R.city_from_location({"address": "لبن, بلدية الشمال, محافظة الرياض, منطقة الرياض, السعودية",
                                 "city": None, "neighborhood": "حي لبن"}) == "الرياض"
    # No region hint is passed: a cross-region twin («النزهة») is not upgraded into a city.
    p11 = {"address": "عبدالله أبي دريب السبيعي، النزهة، منطقة الرياض، السعودية", "city": None, "neighborhood": "النزهة"}
    assert R.city_from_location(p11) is None
    assert R.city_from_location({**p11, "neighborhood": "حي النزهة"}) is None
    assert R.map_listing({**P15, "location": p11}, U70, PHOTOS, today=TODAY)[2] == "city_not_in_catalog"


# ── 4. SKIP, NEVER GUESS ────────────────────────────────────────────────────────────────────────
def test_reserved_sold_archived_and_untyped_units_are_skipped_by_name():
    assert R.map_listing(P15, U24, PHOTOS, today=TODAY)[2] == "status_sold"
    assert R.map_listing(P15, U20, PHOTOS, today=TODAY)[2] == "status_reserved"
    assert R.map_listing(P45, U77, PHOTOS, today=TODAY)[2] == "status_reserved"
    assert R.map_listing(P45, {**U77, "status": "available"}, PHOTOS, today=TODAY)[2] == "type_unmapped"
    assert R.map_listing(P34, {**U70, "isArchived": True}, PHOTOS, today=TODAY)[2] == "archived"
    assert R.map_listing({**P34, "isArchived": True}, U70, PHOTOS, today=TODAY)[2] == "archived"   # the PROJECT archived
    assert R.map_listing(P34, {**U70, "id": None}, PHOTOS, today=TODAY)[2] == "no_id"


def test_a_building_typed_unit_maps_and_its_utilities_reach_real_columns():
    row, cat = _row(P34, {**U24, "status": "available"})
    assert row["property_type"] == "Building" and cat == "residential"
    assert row["price_total"] is None and row["price_evidence"]["raw"] == "0.00"   # «0.00» = no published price
    assert row["furnished"] is True and row["water_supply"] is True and row["electricity"] is True
    assert row["sanitation"] is True


def test_a_phone_number_in_the_description_is_redacted():
    """SYNTHETIC: a contact line inside U70's real description."""
    row, _ = _row(P34, {**U70, "description": U70["description"] + " للتواصل 0551234567"})
    assert "0551234567" not in row["description"]


# ── 5. THE REMOVAL ORACLE ───────────────────────────────────────────────────────────────────────
def test_the_signal_reads_the_unit_out_of_its_projects_record():
    sig = R._signal_for(70)
    rec = json.dumps({"success": True, "data": {"id": 34, "properties": [U70, U69]}}, ensure_ascii=False)
    assert sig(200, rec, False) == "live"
    gone_rec = json.dumps({"success": True, "data": {"id": 34, "properties": [U69]}}, ensure_ascii=False)
    assert sig(200, gone_rec, False) == "gone"
    sold_rec = json.dumps({"success": True, "data": {"id": 34, "properties": [{**U70, "status": "sold"}]}}, ensure_ascii=False)
    assert sig(200, sold_rec, False) == "gone"
    assert sig(404, '{"success":false,"message":"تعذر العثور على المشروع المحدد. يرجى التحقق من معرف المشروع والمحاولة مرة أخرى."}', False) == "gone"
    assert sig(404, "<html>gateway</html>", False) is None
    assert sig(200, '{"success":true,"data":{}}', False) is None      # a record with no id says nothing
    assert sig(200, "not json", False) is None
    assert sig(403, rec, False) is None
    assert R._verify_gone("SNM34")[0] == "unknown"


def test_session_asks_for_arabic():
    assert R.session().headers.get("Accept-Language", "").startswith("ar")


# ── 6. THE RUN LEDGER ───────────────────────────────────────────────────────────────────────────
def test_the_skip_tally_reaches_end_run(monkeypatch):
    calls: dict = {}
    written: dict = {}
    pruned: list = []
    projects = [{**P34, "properties": [U70, U20]}, {**P15, "properties": [U24, U51]}, {**P45, "properties": []}]
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "PAUSE", 0)
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_projects", lambda s: (projects, len(projects)))
    monkeypatch.setattr(R, "fetch_project", lambda s, pid: {"thumbnail": PHOTOS[0], "images": None})
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: written.__setitem__(t, list(rows)))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append((t, set(seen))) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: calls.update(k) or True)

    assert R.main() == 0
    assert calls["ok"] is True and calls["rows_seen"] == 4 and calls["rows_upserted"] == 1
    for part in ("status_reservedx1", "status_soldx1", "city_not_in_catalogx1", "project_no_unitsx1"):
        assert part in calls["notes"], calls["notes"]
    assert calls["check_tables"] == ["snam_residential_listings", "snam_commercial_listings"]
    assert [r["ad_number"] for r in written["snam_residential_listings"]] == ["SNM34U70"]
    assert ("snam_residential_listings", {"SNM34U70"}) in pruned


def test_an_incomplete_enumeration_never_prunes(monkeypatch):
    pruned: list = []
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "PAUSE", 0)
    monkeypatch.setattr(R, "session", lambda: None)
    monkeypatch.setattr(R, "fetch_projects", lambda s: ([{**P34, "properties": [U70]}], 29))   # site says 29
    monkeypatch.setattr(R, "fetch_project", lambda s, pid: None)
    monkeypatch.setattr(R.db, "begin_run", lambda src: 1)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda t, rows: None)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda t, seen, **k: pruned.append(t) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **k: True)
    assert R.main() == 0 and pruned == []
