"""alta: the site's own feature checklist (property_features) answers the amenity columns.

ops_af_score 2026-10-25: alta found 0 of 3. «مصعد», «غرفة خادمة», «مدخل سيارة» were kept in additional_info
and never reached a column (elevator, maid_room, car_entrance were NULL on every active ad). A ticked term is
yes; an unticked one is silence, never «no» (ADVANCED_FILTER_SOURCE_TRUTH §2). 🔬 2026-10-25.

Run: python -m pytest scrapers/common/tests/test_alta_feature_list_reaches_the_columns_2026_10_25.py -q
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

from scrapers.alta.run import map_listing  # noqa: E402

AMENITIES = ("elevator", "kitchen", "air_conditioner", "parking", "maid_room", "driver_room", "laundry_room",
             "balcony_terrace", "private_entrance", "car_entrance", "optical_fibers", "furnished")


def _row(features):
    names = {k: {} for k in ("property_category", "property_action_category", "property_city",
                             "property_area", "property_status", "property_features")}
    names["property_category"] = {1: "شقق"}
    names["property_action_category"] = {1: "للبيع"}
    names["property_features"] = {i: n for i, n in enumerate(features, start=1)}
    p = {"link": "https://alta.com.sa/estate_property/x/", "slug": "x", "id": 1,
         "property_category": [1], "property_action_category": [1],
         "property_features": list(range(1, len(features) + 1)),
         "title": {"rendered": "شقة للبيع"}, "content": {"rendered": ""}}
    row, _ = map_listing(p, names)
    assert row
    return {k: row[k] for k in AMENITIES if k in row}


def test_ticked_terms_are_yes():
    assert _row(["كهرباء", "ماء", "مدخل سيارة", "مصعد", "غرفة خادمة"]) == {
        "car_entrance": True, "elevator": True, "maid_room": True}


def test_utilities_answer_nothing():
    assert _row(["كهرباء", "صرف صحي", "ماء", "شبكات مياة", "اعلان مرخص", "مرافق عامة", "تصريف سيول"]) == {}


def test_no_list_is_silence():
    assert _row([]) == {}
