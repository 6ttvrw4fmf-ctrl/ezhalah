"""af_score: squares' chip list is structured, so description prose never scores a miss for its six chip fields.

CI re-read 38384423613 (2026-10-13): squares 13602723 / 13602726 «misses» were prose («يوجد مصعد في العمارة»,
«غرفة خادمة مع دورة مياة») on ads whose «مميزات العقار» chip list names neither — our NULL is the source's
structured answer (ADVANCED_FILTER_SOURCE_TRUTH §2), not a trapped value (backlog 515).
"""
from scrapers.common import af_score as A


def test_squares_prose_is_not_a_statement_for_its_chip_fields():
    results = {"elevator": A.WE_MISS, "maid_room": A.WE_MISS}
    page = {"jsonld": [], "lines": ["يوجد مصعد في العمارة", "غرفة خادمة مع دورة مياة"]}
    out = A.structured_only("squares", results, {"elevator": None, "maid_room": None}, page)
    assert out["elevator"] == A.PAGE_SILENT and out["maid_room"] == A.PAGE_SILENT


def test_a_site_without_the_entry_keeps_its_prose_reading():
    results = {"elevator": A.WE_MISS}
    out = A.structured_only("some_prose_only_site", results, {"elevator": None}, {"jsonld": []})
    assert out["elevator"] == A.WE_MISS
