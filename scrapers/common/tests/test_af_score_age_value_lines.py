"""The score reads a worded age on its OWN value line, before or after the label, and an open bucket as a floor
(🔬 2026-11-08, backlog 1615). Pages re-read via net.http_get that night:
  abaad 577 (abaad_residential_listings:13214839)      «عمر العقار» / «سنتين»            stored 2
  abaad 1261 (:22771126), aqarcity 29885 (:2292939)  «عمر العقار» / «اكثر من عشر سنوات» stored 10
  aqarcity 28335 (:594262)                           «ثلاث سنوات» / «عمر العقار»       stored 3 (JSON-LD says the same)
All four scored MISMATCH on the 11-08 night although the stored value is the page's own.
"""
import pytest

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


@pytest.mark.parametrize("value_first", [False, True], ids=["label-first", "value-first"])
@pytest.mark.parametrize("value, age", [
    ("سنتين", 2), ("سنتان", 2), ("عامين", 2), ("عامان", 2),
    ("ثلاث سنوات", 3), ("اربعه سنين", 4), ("خمس سنه", 5),
    ("ست سنوات", 6),   # a bare «سته» before the label names no years: not this field's (CodeRabbit on #11299) ("سبع سنوات", 7), ("ثماني سنوات", 8),
    ("تسعه سنوات", 9), ("عشره سنوات", 10),
])
def test_standalone_age_variants_in_both_directions(value, age, value_first):
    lines = ["عمر العقار", f"  {value}  "]
    if value_first:
        lines.reverse()
    assert cmp(age, lines) == S.MATCH
    assert cmp(age + 1, lines) == S.MISMATCH


@pytest.mark.parametrize("value_first", [False, True])
@pytest.mark.parametrize("value", [
    "ضمان سنتين", "سنتين ضمان", "حوالي ثلاث سنوات", "ثلاث سنوات تقريبا",
    "ضمان اكثر من عشر سنوات",
])
def test_neighbouring_prose_does_not_state_an_age(value, value_first):
    lines = ["عمر العقار", value]
    if value_first:
        lines.reverse()
    assert cmp(2, lines) == S.PAGE_SILENT


@pytest.mark.parametrize("lines", [
    [], ["عمر العقار"], ["سنتين"], ["اكثر من عشر سنوات"],
    ["ثلاث سنوات", "الحي", "عمر العقار"],
    ["عمر العقار", "الحي", "سنتين"],
    ["عمر العقار", "الحي", "اكثر من عشر سنوات"],
    ["اختر عمر العقار", "سنتين"],
    ["اختر عمر العقار", "اكثر من عشر سنوات"],
])
def test_missing_or_nonadjacent_age_evidence_is_silent(lines):
    assert cmp(7, lines) == S.PAGE_SILENT


@pytest.mark.parametrize("placement", ["before", "after", "inline"])
@pytest.mark.parametrize("bucket, floor", [
    ("اكثر من عشر سنوات", 10), ("أكثر من 10 سنوات", 10),
    ("اكثر من ٢٥ سنة", 25), ("اعلى من خمسه اعوام", 5),
    ("فوق من 12 عام", 12), ("أعلى من 99 سنين", 99),
])
def test_age_floor_boundary_and_direction(bucket, floor, placement):
    if placement == "inline":
        lines = [f"عمر العقار: {bucket}"]
    elif placement == "before":
        lines = [bucket, "عمر العقار"]
    else:
        lines = ["عمر العقار", bucket]
    assert cmp(floor - 1, lines) == S.MISMATCH
    assert cmp(floor, lines) == S.MATCH
    assert cmp(floor + 1, lines) == S.MATCH


@pytest.mark.parametrize("line, expected", [
    ("  اكثر من عشره سنوات  ", 10),
    ("اكثر من ٢٥ سنة", 25),
    ("اكثر من عشرين سنوات", None),  # do not parse the prefix «عشر» as ten
    ("اكثر من", None),
    ("اقل من عشر سنوات", None),
    ("ضمان اكثر من عشر سنوات", None),
    ("", None),
])
def test_age_floor_requires_a_recognized_value_at_the_start(line, expected):
    assert S._age_floor(line, own=False) == expected


def test_inline_floor_can_follow_the_age_label():
    line = "عمر العقار: اكثر من عشر سنوات"
    assert S._age_floor(line, own=True) == 10
    assert S._age_floor(line, own=False) is None


@pytest.mark.parametrize("label, kw, value", [
    ("عدد الغرف", S.ROOM_KW["bedrooms"], "غرفتين"),
    ("دورات المياه", S.ROOM_KW["bathrooms"], "حمامان"),
    ("عدد الغرف", S.ROOM_KW["bedrooms"], "ثلاث غرف"),
])
@pytest.mark.parametrize("value_first", [False, True])
def test_shared_count_comparator_reads_standalone_words(label, kw, value, value_first):
    lines = [label, value]
    if value_first:
        lines.reverse()
    expected = 3 if value == "ثلاث غرف" else 2
    assert S._cmp_number(expected, lines, "\n".join(lines), kw) == S.MATCH
    assert S._cmp_number(expected + 1, lines, "\n".join(lines), kw) == S.MISMATCH


def test_open_bucket_does_not_turn_a_room_count_into_a_minimum():
    lines = ["عدد الغرف: اكثر من عشر غرف"]
    kw = S.ROOM_KW["bedrooms"]
    assert S._cmp_number(10, lines, "\n".join(lines), kw) == S.MATCH
    assert S._cmp_number(11, lines, "\n".join(lines), kw) == S.MISMATCH


@pytest.mark.parametrize("body, stored, expected", [
    ("<span>سنتان</span><span>عمر العقار:</span>", 2, S.MATCH),
    ("<span>عمر العقار</span><span>أربعة سنوات</span>", 4, S.MATCH),
    ("<span>أكثر من ١٠ سنوات</span><span>عمر العقار</span>", 11, S.MATCH),
    ("<span>عمر العقار</span><span>أكثر من ١٠ سنوات</span>", 9, S.MISMATCH),
    ("<p>عمر العقار: أكثر من عشرة سنوات</p>", 10, S.MATCH),
])
def test_page_evidence_and_normalization_reach_the_age_comparator(body, stored, expected):
    page = S.page_evidence(f"<html><body>{body}</body></html>")
    assert S.compare_listing({"property_age": stored}, page)["property_age"] == expected


def test_a_value_before_the_label_belongs_to_its_own_field():
    # CodeRabbit on #11299: the age's «ثلاث سنوات» is not the bedrooms' value
    lines = ["عمر العقار", "ثلاث سنوات", "غرف النوم", "اربع غرف"]
    assert S._cmp_number(3, lines, "\n".join(lines), S.ROOM_KW["bedrooms"]) != S.MATCH


def test_month_and_partial_floors_are_not_year_floors():
    assert S._age_floor("اكثر من 10 اشهر", own=False) is None
    assert S._age_floor("اكثر من عشر سنوات في السوق", own=False) is None
    assert cmp(1, ["عمر العقار", "اكثر من 10 اشهر"]) == S.PAGE_SILENT
