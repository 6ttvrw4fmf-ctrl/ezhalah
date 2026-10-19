"""hazim's traps: a Base44 entity whose `price` is a STRING («165000», «0», «اتصل للاستفسار»), a
`priceUnit` that states annual on a figure-less rent, a closed-list status («مباع» / «مؤجر» /
«محجوز»), agent name+phone on every object, `parking: true` on every object, a -1 floor sentinel,
a float area, and a per-id JSON 404 oracle.

Fixtures are VERBATIM entities/Property objects captured 2026-09-24 (refs 1123, 1127, 1125, 1122;
trimmed to the keys the code reads; long descriptions cut to their first sentence). Assertions run
the SHIPPING functions (run.map_listing, run.parse_price, run._make_signal, run.main). Offline: only
to_catalog/find_district_in_text and db are stubbed.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.hazim import run as R  # noqa: E402

V1123 = {"parking": True, "featured": True, "rooms": 6.0, "agent_name": "منهل الموسى", "city": "الخبر", "year": 2023.0,
         "agent_phone": "0536888777", "title": "فيلا زاوية - حي الجسر", "type": "فيلا", "agent_avatar": None,
         "nearby": ["بالقرب من طريق الملك فهد الرابط بين الدمام والخبر", "قريب من كورنيش الدمام"],
         "ref": "1123", "floors": 3.0, "furnished": "غير مفروش", "price": "165000", "tag": "للبيع", "floor": None, "area": 349.5,
         "priceUnit": "ر.س", "image": "https://media.base44.com/images/public/6a0b08a09681ebc6062f547e/0fc269b02_cover1123.png",
         "map_url": "https://maps.app.goo.gl/u95whuTHTm9tCN9V8?g_st=iw", "bathrooms": 6.0, "district": "حي الجسر",
         "location": "الخبر حي الجسر  ", "category": "سكني", "assigned_agent_id": "6a1b0c2f078a066dc4b73677", "status": "متاح",
         "id": "6a24951be68e1d79e10e7787", "created_date": "2026-06-06T21:46:03.202000", "updated_date": "2026-06-28T10:22:51.841000",
         "created_by_id": "6a0b08a09681ebc6062f547f", "is_sample": False,
         "description": "للبيع فيلا زاوية جديدة - العمر سنتين، شارع 20م جنوب وشارع 20م غرب، المساحة 349.5م²، كراج سيارة وحوش كبير.",
         "images": ["https://media.base44.com/images/public/6a0b08a09681ebc6062f547e/b693a303f_IMG_2431Medium.jpg",
                    "https://media.base44.com/images/public/6a0b08a09681ebc6062f547e/0fc269b02_cover1123.png"],
         "features": ["فيلا زاوية", "مصعد ألماني", "مطبخ مفتوح ومطبخ داخلي", "حوش كبير", "كراج سيارة", "مكيفات مركّبة", "سخان مركزي", "كاميرات مراقبة", "6 غرف ماستر", "سطح", "ضمان شامل"]}
O1127 = {"parking": True, "featured": True, "rooms": 0, "agent_name": "سعيد الهميمي", "city": "الدمام", "year": None,
         "agent_phone": "0531899444", "title": " مجمع مكاتب  ومحلات للايجار في الدمام ", "type": "مكتب", "agent_avatar": None,
         "nearby": ["ميناء الملك عبدالعزيز", "منطقة المستودعات"], "ref": "1127", "floors": 1, "furnished": "غير مفروش", "price": "0",
         "tag": "للإيجار", "floor": -1.0, "area": 140.0, "priceUnit": "ر.س",
         "image": "https://media.base44.com/images/public/6a0b08a09681ebc6062f547e/94fb338cf_ddd.jpg", "bathrooms": 2.0,
         "district": "الميناء", "location": "الدمام  - بالقرب  من ميناء الملك عبد العزيز  ", "category": "تجاري",
         "assigned_agent_id": None, "status": "متاح", "id": "6a3120a052ba054b38117f8c", "created_date": "2026-06-16T10:08:32.042000",
         "updated_date": "2026-06-20T11:22:42.470000", "created_by_id": "6a0b08a09681ebc6062f547f", "is_sample": False,
         "description": "يتميز موقع المجمع التجاري بالقرب من ميناء الملك عبدالعزيز بعدة مميزات استراتيجية تجعله وجهة بارزة للأعمال",
         "images": ["https://media.base44.com/images/public/6a0b08a09681ebc6062f547e/0540be31b_IMG_3125Large.jpg"],
         "features": ["موقع استراتيجي متميز:", "القرب من الميناء", "مكاتب تجارية متنوعة", "محلات تجارية بمساحات واسعة"]}
V1125 = {"parking": True, "featured": True, "rooms": 3.0, "agent_name": "منهل الموسى", "city": "الخبر", "year": None,
         "agent_phone": "0536777555", "title": "JZALA 1 — مجمع سكني فلل", "type": "فيلا", "agent_avatar": None,
         "nearby": ["مدارس دولية وخاصة"], "ref": "1125", "floors": 2.0, "furnished": "مفروش", "price": "اتصل للاستفسار",
         "tag": "للإيجار", "floor": None, "area": 230.0, "priceUnit": "ر.س / سنوياً",
         "image": "https://media.base44.com/images/public/6a0b08a09681ebc6062f547e/3c6e502d9_01-__.png", "bathrooms": 3.0,
         "district": None, "location": None, "category": "سكني", "assigned_agent_id": None, "status": "متاح",
         "id": "6a258872983a925dcf94b467", "created_date": "2026-06-07T15:04:18.495000", "updated_date": "2026-06-07T15:04:18.495000",
         "created_by_id": "6a0b08a09681ebc6062f547f", "is_sample": False,
         "description": "مجمع سكني فلل فاخرة متكامل الخدمات في مدينة الخبر", "images": [],
         "features": ["فلل مؤثثة بأحدث الأجهزة الكهربائية", "أمن وحراسة على مدار الساعة", "مواقف سيارات خاصة لكل فيلا", "مسبح خارجي وداخلي"]}
S1122 = {"parking": True, "featured": True, "rooms": 6.0, "agent_name": "منهل الموسى", "city": "الخبر", "year": 2023.0,
         "agent_phone": "0536888777", "title": "فيلا زاوية - الراكة", "type": "فيلا", "ref": "1122", "floors": 3.0, "furnished": "مفروش",
         "price": "1900000", "tag": "للبيع", "floor": None, "area": 349.5, "priceUnit": "ر.س", "image": None, "bathrooms": 6.0,
         "district": None, "location": "الخبر - الراكة، شارع 20م جنوب وشارع 20م غرب", "category": "سكني", "status": "مباع",
         "id": "6a24212d64a7d320c4f56410", "is_sample": False, "description": "", "images": [], "features": ["فيلا زاوية"]}
GONE_404 = '{"message":"Entity Property with ID 000000000000000000000000 not found","detail":null,"traceback":null,"extra_data":null,"request_id":null}'


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: {"الخبر": (31, 5), "الدمام": (13, 5)}.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي الجسر" if (t and "الجسر" in t) else None)


def _p(base, **over):
    p = json.loads(json.dumps(base))
    p.update(over)
    return p


def test_sale_villa_reads_the_string_price_float_area_and_build_year():
    row, cat, why = R.map_listing(V1123)
    assert why == "" and cat == "residential" and row["property_type"] == "Villa"
    assert row["ad_number"] == "HZM6a24951be68e1d79e10e7787"
    assert row["listing_url"] == "https://hazim.sa/properties/6a24951be68e1d79e10e7787"
    assert row["price_total"] == 165000 and "rent_period" not in row
    assert row["area_m2"] == 349 and row["additional_info"]["area_raw"] == 349.5
    assert row["bedrooms"] == 6 and row["bathrooms"] == 6
    assert row["property_age"] == datetime.now(timezone.utc).year - 2023 and row["additional_info"]["completion_year"] == 2023
    assert row["furnished"] is False and row["elevator"] is True and row["kitchen"] is True and row["air_conditioner"] is True
    assert row["parking"] is True                                           # from «كراج سيارة» in the prose, not the flag
    assert row["district_ar"] == "حي الجسر" and row["neighborhood"] == "حي الجسر"
    assert row["photo_urls"][0].endswith("0fc269b02_cover1123.png") and len(row["photo_urls"]) == 2   # cover deduped
    assert row["additional_info"]["ref"] == "1123" and row["additional_info"]["site_category"] == "سكني"


def test_price_zero_and_call_for_price_are_null_never_a_zero_rent():
    row, cat, why = R.map_listing(O1127)
    assert why == "" and cat == "commercial" and row["property_type"] == "Office"
    assert "price_total" not in row and row["price_annual"] is None and "rent_period" not in row
    assert row["additional_info"]["source_price_raw"] == "0" and "price_on_request" not in row["additional_info"]
    assert row["bathrooms"] is None and row["bedrooms"] is None            # an office's counts are not a dwelling's
    assert row["floor_number"] is None and row["additional_info"]["floor_raw"] == -1.0
    assert "parking" not in row                                             # flag is a form default; prose says nothing
    assert row["neighborhood"] == "الميناء" and row["district_ar"] is None and row["title"] == "مجمع مكاتب ومحلات للايجار في الدمام"
    assert R.parse_price("165000") == 165000 and R.parse_price("0") is None and R.parse_price("اتصل للاستفسار") is None
    assert R.parse_price("1,900,000") == 1900000 and R.parse_price(None) is None


def test_a_stated_annual_unit_on_a_figure_less_rent_keeps_the_period_only():
    row, _, why = R.map_listing(V1125)
    assert why == "" and row["transaction_type"] == "Rent"
    assert row["rent_period"] == "annual" and row["price_annual"] is None
    assert row["additional_info"]["price_on_request"] is True and row["additional_info"]["source_price_unit"] == "ر.س / سنوياً"
    assert row["furnished"] is True and row["parking"] is True              # «مواقف سيارات خاصة لكل فيلا»
    assert row["neighborhood"] is None and row["district_ar"] is None       # district AND location null
    bare = R.map_listing(_p(V1125, price="45000", priceUnit="ر.س"))[0]
    assert "rent_period" not in bare and bare["price_annual"] == 45000      # silent → NULL, figure verbatim


def test_closed_statuses_samples_and_unmapped_values_are_skipped():
    assert R.map_listing(S1122)[2] == "sold"
    assert R.map_listing(_p(V1123, status="مؤجر"))[2] == "rented"
    assert R.map_listing(_p(V1123, status="محجوز"))[2] == "reserved"
    assert R.map_listing(_p(V1123, status="قريباً"))[2] == "status_unmapped_قريباً"
    assert R.map_listing(_p(V1123, is_sample=True))[2] == "sample_row"
    assert R.map_listing(_p(V1123, type="منزل ريفي"))[2] == "type_unmapped_منزل ريفي"
    assert R.map_listing(_p(V1123, tag="استثمار"))[2] == "tag_unmapped_استثمار"
    assert R.map_listing(_p(V1123, city="القطيف"))[2] == "city_not_in_catalog"
    assert R.map_listing(_p(V1123, title="مزاد فيلا"))[2] == "auction"
    assert R.map_listing(_p(V1123, id=""))[2] == "no_id"


def test_agent_identity_and_phones_never_reach_the_row():
    for p in (V1123, O1127, V1125):
        row, _, _ = R.map_listing(p)
        blob = json.dumps(row, ensure_ascii=False)
        for secret in ("منهل الموسى", "سعيد الهميمي", "0536888777", "0531899444", "0536777555", "agent_", "assigned_agent_id", "created_by_id"):
            assert secret not in blob, secret
    row, _, _ = R.map_listing(_p(V1123, description="للمعاينة 0536888777", features=["واتساب 0536888777"]))
    assert "0536888777" not in json.dumps(row, ensure_ascii=False)


def test_signal_404_is_gone_and_only_a_matching_available_id_is_live():
    sig = R._make_signal("6a24951be68e1d79e10e7787")
    assert sig(404, GONE_404, False) == "gone"
    assert sig(200, json.dumps(V1123), False) == "live"
    assert sig(200, json.dumps(_p(V1123, status="مباع")), False) == "gone"
    assert sig(200, json.dumps(O1127), False) is None                       # another entity
    assert sig(200, json.dumps(_p(V1123, status="قريباً")), False) is None
    assert sig(403, GONE_404, False) is None and sig(200, "<html>", False) is None and sig(None, "", False) is None


def test_main_tallies_every_skip_into_end_run_notes(monkeypatch):
    calls: dict = {"batches": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_properties", lambda s, limit=0: [O1127, V1125, V1123, S1122])
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"] == [("hazim_residential_listings", ["HZM6a258872983a925dcf94b467", "HZM6a24951be68e1d79e10e7787"]),
                                ("hazim_commercial_listings", ["HZM6a3120a052ba054b38117f8c"])]
    assert calls["end"]["rows_seen"] == 4 and calls["end"]["rows_upserted"] == 3
    assert "soldx1" in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["hazim_residential_listings", "hazim_commercial_listings"]
