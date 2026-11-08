"""The score reads a worded age on its OWN value line, before or after the label, and an open bucket as a floor
(🔬 2026-11-08, backlog 1615). Pages re-read via net.http_get that night:
  abaad 577 (abaad_residential_listings:13214839)      «عمر العقار» / «سنتين»            stored 2
  abaad 1261 (:22771126), aqarcity 29885 (:2292939)  «عمر العقار» / «اكثر من عشر سنوات» stored 10
  aqarcity 28335 (:594262)                           «ثلاث سنوات» / «عمر العقار»       stored 3 (JSON-LD says the same)
All four scored MISMATCH on the 11-08 night although the stored value is the page's own.
"""
from scrapers.common import new_listings_score as S

KW = S.AGE_KW


def cmp(stored, lines):
    return S._cmp_number(stored, lines, "\n".join(lines), KW)


def test_dual_on_the_value_line_is_two():
    assert cmp(2, ["عمر العقار", "سنتين"]) == S.MATCH
    assert cmp(5, ["عمر العقار", "سنتين"]) == S.MISMATCH


def test_worded_value_printed_before_its_label():
    assert cmp(3, ["ثلاث سنوات", "عمر العقار"]) == S.MATCH
    assert cmp(7, ["ثلاث سنوات", "عمر العقار"]) == S.MISMATCH


def test_open_bucket_is_a_floor():
    assert cmp(10, ["عمر العقار", "اكثر من عشر سنوات"]) == S.MATCH
    assert cmp(14, ["عمر العقار", "اكثر من عشر سنوات"]) == S.MATCH
    assert cmp(4, ["عمر العقار", "اكثر من عشر سنوات"]) == S.MISMATCH
    assert cmp(12, ["عمر العقار: أكثر من 10 سنوات"]) == S.MATCH


def test_a_bucket_inside_another_sentence_is_not_the_value():
    # a neighbour line that merely CONTAINS the words («ضمان اكثر من عشر سنوات») is not the age's value line
    assert S._age_floor("ضمان اكثر من عشر سنوات", own=False) is None
    assert S._age_floor("اكثر من عشر سنوات", own=False) == 10


def test_existing_shapes_unchanged():
    assert cmp(3, ["عمر العقار", "ثلاث سنوات"]) == S.MATCH          # reinvest 21664052 (value after the label)
    assert cmp(0, ["عمر العقار", "جديد"]) == S.MATCH
    assert cmp(9, ["عمر العقار: 9 سنوات"]) == S.MATCH
    assert cmp(None, ["عمر العقار", "سنتين"]) in (S.WE_MISS, S.PAGE_SILENT)
