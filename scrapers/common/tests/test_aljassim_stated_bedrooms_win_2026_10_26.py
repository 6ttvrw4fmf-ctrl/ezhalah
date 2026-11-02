"""aljassim's index room cell counts EVERY room («أربع غرف الدور الثاني» = 4 rooms: bedrooms + majlis + hall)
and was stored as 4 bedrooms on 12589871 whose own prose says «3 غرف نوم», and on 12590024 («تتكون من ٣ غرف
وحده منهم ماستر»). An explicit bedroom count in the ad's own words wins over the cell (🆕 2026-10-26 → repair
backlog 903, 🔧 2026-10-26). A multi-unit description still asserts nothing; land has no bedrooms.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest  # noqa: E402

import scrapers.common.tests.test_aljassim_source_truth as T  # noqa: E402
from scrapers.common.tests.test_aljassim_source_truth import catalog  # noqa: E402,F401

R = T.R


@pytest.mark.parametrize("text,beds", [
    ("أربع غرف الدور الثاني 3 غرف نوم مجلس صاله 2 دوره مياه مطبخ", 3),          # 12589871
    ("أربع غرف الدور الاول المواصفات تتكون من ٣ غرف وحده منهم ماستر بحمام - مجلس كبير", 3),  # 12590024
    ("ثلاث غرف نوم ومجلس وصالة", 3),
    ("شقة غرفتين وصالة", None),                     # no explicit bedroom word → the cell decides
    ("4 شقق كل شقه 3 غرف نوم", None),               # a part of a multi-unit house, never the total
    ("", None), (None, None),
])
def test_stated_bedrooms_reads_only_an_explicit_bedroom_count(text, beds):
    assert R.stated_bedrooms(text) == beds


def test_the_ads_own_bedroom_count_beats_the_cells_all_rooms_count(catalog):
    ix = T._one(T.ROW_ROOMS)
    assert R.parse_rooms(ix["rooms_text"], "Apartment")[0] not in (None, 3), ix["rooms_text"]
    row, _c, why = R.map_listing(ix, {"description": "الدور الثاني 3 غرف نوم مجلس صاله 2 دوره مياه مطبخ"})
    assert why == ""
    assert row["bedrooms"] == 3, "the index cell's all-rooms count overrode the ad's own «3 غرف نوم»"


def test_without_a_stated_count_the_cell_still_decides(catalog):
    ix = T._one(T.ROW_ROOMS)
    cell_beds = R.parse_rooms(ix["rooms_text"], "Apartment")[0]
    row, _c, why = R.map_listing(ix, {"description": "مجلس صاله مطبخ"})
    assert why == "" and row["bedrooms"] == cell_beds
