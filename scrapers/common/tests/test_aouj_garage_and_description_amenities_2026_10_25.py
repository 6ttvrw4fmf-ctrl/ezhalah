"""أوج العقارية (aouj): the garage count is parking, and a built unit's own description answers the rest.

ops_af_score 2026-10-25: aouj 0 of 3 findable. 74 active ads stored NO amenity at all (parking 0, kitchen 0,
elevator 0) while `garage` carries «1»/«2» on 4 ads and the descriptions name «مطبخ», «مكيفات راكبة»,
«مؤثث بالكامل». `features` is [] on every ad, so the description is the site's only amenity statement:
read as yes, an explicit no, or nothing (ADVANCED_FILTER_SOURCE_TRUTH §2), never for a plot, never for parking (structured `garage`).
The texts are verbatim from live ads 10283211, 10283218, 10283198, 10283200, 10283199 (🔬 2026-10-25).

Run: python -m pytest scrapers/common/tests/test_aouj_garage_and_description_amenities_2026_10_25.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.aouj.run as A  # noqa: E402

AMENITIES = ("elevator", "kitchen", "air_conditioner", "parking", "maid_room", "driver_room", "laundry_room",
             "balcony_terrace", "private_entrance", "car_entrance", "optical_fibers", "furnished")


def row(desc: str | None, *, type_: str = "apartment", garage=None, features=None, title: str = "شقة للبيع") -> dict:
    o = {"id": "10283211", "slugs": {"ar": "شقة-للبيع"}, "title": {"ar": title},
         "description": {"ar": desc} if desc is not None else None,
         "address": {"ar": "الحمراء، محافظة الخبر، المنطقة الشرقية، المملكة العربية السعودية"},
         "type": [type_], "location": ["الخبر"], "status": ["for-sale"], "price": "650000",
         "price_period": {"ar": "", "en": ""}, "area": "150", "bedrooms": "3", "bathrooms": "2",
         "features": features or [], "images": [], "garage": garage}
    r, why = A.map_item(o)
    assert r, why
    return {k: r[k] for k in AMENITIES if k in r}


def test_installed_acs_are_air_conditioning():
    assert row("شقة للبيع او الاجار الحمراء 3 غرف نوم صالة ومكيفات راكبة") == {"air_conditioner": True}


def test_a_fully_furnished_villa_with_a_kitchen():
    got = row("فيلا مودرن بالخبر للبيع او للإيجار بحي البحيرة مساحة 515 م2 مؤثث بالكامل 3 غرف نوم صالون فخم "
              "للاستقبال غرف مستقلة للعاملة والسائق مجهزة بتكييف مركزي وانترنت عالي السرعة واجدث اجهزة المطبخ",
              type_="villa")
    assert got.get("furnished") is True and got.get("kitchen") is True and got.get("air_conditioner") is True


def test_the_garage_count_is_parking():
    assert row(None, garage="1") == {"parking": True}
    assert row(None, garage="2") == {"parking": True}


def test_no_garage_count_is_silence_not_no():
    for g in (None, "", "0"):
        assert "parking" not in row(None, garage=g)


def test_parking_is_never_read_from_prose():
    # garage is the structured field; «مواقف خاصة» in the text does not answer it (10283199).
    got = row("مكيفات ودواليب مطبخ حديثة التركيب • مواقف خاصة 22 م²")
    assert "parking" not in got and got["kitchen"] is True and got["air_conditioner"] is True


def test_an_elevator_that_can_be_added_later_is_not_an_elevator():
    assert "elevator" not in row("تصميم يستوعب المرحلة الأولى من إضافة مصعد لاحقًا", type_="villa")
    assert "elevator" not in row("◻️ مصعد مؤسس داخل الفيلا", type_="villa")
    assert row("✅ مصعد ✅ مطبخ", type_="villa") == {"elevator": True, "kitchen": True}


def test_a_plot_answers_nothing_from_prose():
    assert row("ارض قريبة من الخدمات مطبخ مركزي مكيفات", type_="land") == {}


def test_an_explicit_negation_is_no_and_silence_is_nothing():
    # owner 2026-10-24 (PR 8674): an explicit «غير مؤثثة» tied to the word is a stated no.
    assert row("الشقة غير مؤثثة") == {"furnished": False}
    assert row("شقة للبيع بحي الحمراء") == {}


def test_a_filled_features_list_stops_prose():
    assert row("مطبخ راكب ومكيفات", features=[{"ar": "مسبح"}]) == {}
