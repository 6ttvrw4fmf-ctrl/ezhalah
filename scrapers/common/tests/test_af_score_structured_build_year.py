"""af-score judges a property's age by the page's own STRUCTURED build year before any prose (🔬 2026-11-10, backlog 1615).

Pages re-read via net.http_get on 2026-11-10 (responses 10895, 10896):
- squares 13602726 prints the spec row «سنة البناء» / «2022» and we store 4 (2026 − 2022); its 2024 prose still says
  «عمر العقار : سنتين», so the 11-10 night scored our correct 4 a MISMATCH.
- erapulse 648075's JSON-LD carries «"yearBuilt":1993» (stored 33); the page also prints ANOTHER ad's prose
  «🏠 عمر العقار: 3 سنوات فقط», which the night read as this ad's age.
"""
import sys

sys.path.insert(0, ".")

from scrapers.common.new_listings_score import (  # noqa: E402
    MATCH, MISMATCH, WE_MISS, _structured_age, compare_listing,
)

SQUARES_LINES = ["للبيع فيلا في حي القدس مخطط الراجحي المساحة : 360 متر مربع الواجهة : غربية عرض الشارع : 15 متر "
                 "عمر العقار : سنتين تتكون الفيلا من", "النوع", "فيلا", "سنة البناء", "2022", "المساحة", "360 م2"]
ERAPULSE_JSONLD = [{"@type": "SingleFamilyResidence", "numberOfRooms": 6, "numberOfBathroomsTotal": 4,
                    "numberOfFloors": 2, "yearBuilt": 1993}]
ERAPULSE_LINES = ["🏠 عمر العقار: 3 سنوات فقط", "🛏️ عدد الغرف: 6 غرف"]


def _page(lines, jsonld=None):
    return {"title": "", "meta": {}, "jsonld": jsonld or [], "evidence_lines": lines, "text_head": ""}


def test_squares_spec_row_wins_over_stale_prose():
    out = compare_listing({"property_age": 4}, _page(SQUARES_LINES), skip_price=True)
    assert out["property_age"] == MATCH


def test_squares_a_wrong_age_still_mismatches():
    out = compare_listing({"property_age": 2}, _page(SQUARES_LINES), skip_price=True)
    assert out["property_age"] == MISMATCH


def test_erapulse_jsonld_year_built_wins_over_a_neighbour_ads_prose():
    out = compare_listing({"property_age": 33}, _page(ERAPULSE_LINES, ERAPULSE_JSONLD), skip_price=True)
    assert out["property_age"] == MATCH
    out = compare_listing({"property_age": 3}, _page(ERAPULSE_LINES, ERAPULSE_JSONLD), skip_price=True)
    assert out["property_age"] == MISMATCH


def test_a_stated_build_year_with_nothing_stored_is_a_miss():
    assert _structured_age(None, ["سنه البناء", "2022"], "", now_year=2026) == WE_MISS


def test_one_year_either_way_is_the_same_building():
    assert _structured_age(5, ["سنه البناء: 2022"], "", now_year=2026) == MATCH
    assert _structured_age(6, ["سنه البناء: 2022"], "", now_year=2026) == MISMATCH


def test_no_build_year_leaves_the_prose_reader_in_charge():
    assert _structured_age(3, ["عمر العقار: 3 سنوات"], "", now_year=2026) is None
    out = compare_listing({"property_age": 3}, _page(["عمر العقار: 3 سنوات"]), skip_price=True)
    assert out["property_age"] == MATCH


def test_a_future_or_bogus_year_is_ignored():
    assert _structured_age(0, ["سنه البناء", "2099"], "", now_year=2026) is None
