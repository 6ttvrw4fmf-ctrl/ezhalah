"""Eastabha Arabic feature tags — no concept may be mapped onto a column that means something else.

Eastabha publishes 24 distinct Arabic feature tags. Most map cleanly. Two did not, and were mapped
anyway until 2026-08-11:

  حديقة (garden)        -> balcony_terrace, carrying the comment "closest canonical column".
                           It had put a balcony on 7 active listings that never claimed one.
  سطح خاص (private roof) -> villa_on_roof. Roof access is not being a rooftop dwelling; 4 listings
                           were mislabelled.

"Closest available column" is how a search starts lying: a user filtering for a balcony was being
shown gardens. A tag with no true equivalent stays in features_ar until a column exists that means
the same thing.
"""
from __future__ import annotations

import pytest

from scrapers.eastabha.run import FEATURE_COL

# Every tag seen live on 2026-08-11, with its active-row count, so an unreviewed new mapping for a
# known tag fails loudly rather than sliding in.
KNOWN_TAGS = {
    "كهرباء": "electricity",
    "ماء": "water_supply",
    "مطبخ مجهز": "kitchen",
    "غرفة غسيل": "laundry_room",
    "كراج ملحق": "parking",
    "شُرفة ، بلكونة": "balcony_terrace",
    "تكييف مركزي": "air_conditioner",
}
# Tags that are real published facts but have NO true-equivalent column. Each must map to nothing.
MUST_STAY_UNMAPPED = [
    "حديقة",                      # garden != balcony
    "سطح خاص",                    # private roof != villa_on_roof
    "تهوية",                      # ventilation != air conditioning
    "تدفئة",                      # heating != air conditioning
    "حمام ساخن", "واي فاي", "الغاز الطبيعي", "كاشف الدخان", "صالة رياضية", "مسبح",
    "فناء أمامي", "فناء خلفي", "غرفة عرض ، سينما", "ملعب كرة سلة",
    "مقاعد مهيأة لذوي الاحتياجات",
    "مرافق العامة", "تفاصيل خارجية",   # category headers, not values
]


@pytest.mark.parametrize("tag,col", KNOWN_TAGS.items())
def test_true_equivalents_are_mapped(tag, col):
    assert FEATURE_COL.get(tag) == col


@pytest.mark.parametrize("tag", MUST_STAY_UNMAPPED)
def test_tags_without_a_true_equivalent_map_to_nothing(tag):
    assert tag not in FEATURE_COL, (
        f"«{tag}» acquired a column. If no existing column means exactly this, it belongs in "
        f"features_ar, not in the nearest-looking boolean."
    )


def test_garden_is_never_a_balcony():
    assert FEATURE_COL.get("حديقة") != "balcony_terrace"


def test_private_roof_is_never_a_rooftop_villa():
    assert FEATURE_COL.get("سطح خاص") != "villa_on_roof"


def test_nothing_maps_to_air_conditioner_except_actual_cooling():
    cooling = {t for t, c in FEATURE_COL.items() if c == "air_conditioner"}
    assert cooling == {"تكييف مركزي", "تكييف"}, (
        f"unexpected tags mapped to air_conditioner: {cooling - {'تكييف مركزي', 'تكييف'}}"
    )


def test_every_mapped_target_is_a_real_eastabha_column():
    columns = {
        "elevator", "kitchen", "parking", "air_conditioner", "electricity", "water_supply",
        "sanitation", "balcony_terrace", "laundry_room", "private_entrance", "optical_fibers",
        "maid_room", "driver_room", "villa_on_roof", "car_entrance",
    }
    assert set(FEATURE_COL.values()) <= columns
