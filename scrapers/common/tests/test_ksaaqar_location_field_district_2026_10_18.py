"""ksaaqar: the district is the «حي X» segment of the page's own «الموقع:» address field — never prose, never
the truncated map line's plus code (2026-10-18).

287 live rows had no district. Rendered 2026-10-18: the theme prints the map line TRUNCATED («AHAA8868، 8868 ...
انظر الخريطة»), so the old reader got a plus code, a street or nothing; the full address sits in the page's
«الموقع:» field («AHAA8868، 8868 خليفة ابن عبدالله ابن الحارث، 4816، حي الحيلة الغربي، محايل 63312, Saudi
Arabia» on /ad/دور-للبيع/). The field is read ONLY when it is a structured address (postal code or country
among its comma segments) and holds exactly one «حي …» segment; the field's prose («تقع خلف نادي وقت
اللياقة …» on /ad/روف-للبيع/) is never a district. Every string below is the recorded page text, verbatim.
"""
from __future__ import annotations

import json

import pytest

import scrapers.common.db as db
import scrapers.ksaaqar.run as K

# the two recorded «الموقع:» fields, exactly as K._txt() renders them (2026-10-18)
FIELD_ADDRESS = ("الموقع: AHAA8868، 8868 خليفة ابن عبدالله ابن الحارث، 4816، حي الحيلة الغربي، محايل 63312, Saudi Arabia "
                 "اكتب مراجعة معرض المراجعات: اختر ملف")
FIELD_PROSE = ("الموقع: تقع خلف نادي وقت اللياقة في منطقة هادئة وقريبة من كل الاحتياجات. ​الخدمات: الشارع العام حيوي "
               "ومخدوم بالكامل، ويضم (محطات وقود، بقالات، مغاسل، مطاعم، ومستشفى).")
MAP_TRUNCATED = "AHAA8868، 8868 ... انظر الخريطة"
# the spec block of a live listing (verbatim in test_ksaaqar_captures_what_the_source_publishes.py)
SPEC = ("الدولة: عقارات الرياض الحالة: غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة "
        "50,000.00SAR (قابل للتفاوض) النوع: للإيجار الحالة: غير مؤجرة "
        "رقم رخصة فال : 1200023153 عدد الغرف : 3 عدد الصالات : 1 دورة المياه : 2 "
        "عدد الأدوار : 2 التكييف : نعم عرض الشارع : ١٥ واجهة العقار : جنوب "
        "عمر العقار : 7 سنوات نوع العقار : سكني التأثيث : مفروشة "
        "الوصف: شقه للايجار حي الملقا ثلاث غرف وصاله")


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(K, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(K, "find_district_in_text", lambda text, city_id: text if text and text.startswith("حي ") else None)


def _post(title="شقق سكنية > شقق سكنية للإيجار"):
    return {"id": 4242, "link": "https://ksaaqar.com/ad/x/", "title": {"rendered": title},
            "content": {"rendered": ""}, "class_list": []}


def test_recorded_address_field_gives_the_hayy_segment_as_written():
    assert K.location_field_district(FIELD_ADDRESS) == "حي الحيلة الغربي"
    assert K.district_candidate(FIELD_ADDRESS + " " + MAP_TRUNCATED) == "حي الحيلة الغربي"


def test_end_to_end_the_field_district_reaches_the_row_with_its_provenance():
    row, _cat, why = K.map_listing(_post(), FIELD_ADDRESS + " " + SPEC.replace("الملقا، الرياض السعودية... انظر الخريطة", MAP_TRUNCATED), "")
    assert row is not None, why
    assert row["neighborhood"] == "حي الحيلة الغربي" and row["district_ar"] == "حي الحيلة الغربي"
    assert row["additional_info"]["district_source"] == "location_field"


@pytest.mark.parametrize("text", [
    FIELD_PROSE,                                                                 # prose in the field
    "الموقع: خلف المدرسة، حي النسيم، قرب المسجد الخدمات: كذا",                    # a «حي» segment but no address signal
    "الموقع: 1234 شارع، حي الورود، حي الربيع، الرياض 12345, Saudi Arabia",        # two «حي» segments = a conflict
    "الموقع والخدمات المحيطة: حي كذا، الرياض 12345",                            # not the «الموقع:» field
    "QQWW+5XH، الرياض ... انظر الخريطة",                                         # a plus code on the map line
    "جديدة RFRA3688, 3688 ... انظر الخريطة",                                     # an agent's reference code
    MAP_TRUNCATED,                                                               # the truncated map line alone
])
def test_mutation_prose_conflict_plus_code_or_truncation_is_no_district(text):
    assert K.district_candidate(text) is None


def test_the_map_line_still_answers_when_it_starts_with_the_district(monkeypatch):
    assert K.district_candidate("غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة") == "الملقا"
    monkeypatch.setattr(K, "find_district_in_text", lambda text, city_id: "حي الملقا" if text == "الملقا" else None)
    row, _cat, why = K.map_listing(_post(), SPEC, "")
    assert row is not None, why
    assert row["neighborhood"] == "الملقا" and row["district_ar"] == "حي الملقا"
    assert row["additional_info"]["district_source"] == "map_line"


# 2026-10-18. `neighborhood` is the SOURCE's own district word: when the catalog has no match, the index carries it
# to the card and to the Filter's district list as written. Live before this fix: 162 ksaaqar rows served a carried
# map line — «فلل فاخرة للبيع بدون دفعه مق», «المملكة العربية السعودية», «عقارات جدة JIJB», «شقه ايجار في الرياض 1» —
# and 28 rows stored a Google plus code («عقارات الدمام 8Q9H+JHH» on 12226888, whose title says «حي القصور، الظهران»;
# the bare code resolves to Kirkuk, Iraq). Every line below is a stored value, verbatim.
JUNK_MAP_LINES = ["فلل فاخرة للبيع بدون دفعه مق", "المملكة العربية السعودية", "عقارات جدة JIJB",
                  "شقه ايجار في الرياض 1", "تصميم تنفيذ مطاعم كافي", "القاهرة طريق الواحات مح"]
PLUS_CODE_LINES = ["عقارات الدمام 8Q9H+JHH", "6JJ6+25 ابو ال", "عقارات الرياض 3C5W+WW الخير", "66H5+WXP 16255",
                   "عقارات الدمام 925V+M38 الدمام السع"]


def _page(line):
    return SPEC.replace("غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة", f"غير مؤجرة {line}... انظر الخريطة")


@pytest.mark.parametrize("line", JUNK_MAP_LINES)
def test_mutation_a_map_line_the_catalog_does_not_know_is_never_the_neighborhood(line):
    row, _cat, why = K.map_listing(_post(), _page(line), "")
    assert row is not None, why
    # None, or AUTHORITATIVE_NULL when the line names another city («عقارات جدة JIJB» on a الرياض ad): no district either way
    assert row["neighborhood"] in (None, db.AUTHORITATIVE_NULL) and row["district_ar"] in (None, db.AUTHORITATIVE_NULL)
    assert row["additional_info"]["map_line"] == line          # kept as the fact it is, never as a district


@pytest.mark.parametrize("line", PLUS_CODE_LINES)
def test_mutation_a_plus_code_anywhere_on_the_map_line_reaches_nothing(line):
    assert K.district_candidate(f"الدولة: {line}... انظر الخريطة") is None
    row, _cat, why = K.map_listing(_post(), _page(line), "")
    assert row is not None, why
    assert row["neighborhood"] is None and row["district_ar"] is None
    code = next(w for w in line.split() if "+" in w)
    located = {k: row.get(k) for k in ("neighborhood", "district_ar")} | {"map_line": row["additional_info"].get("map_line")}
    assert code not in json.dumps(located, ensure_ascii=False)     # no location field of ours carries the code


def test_a_field_a_catalog_hit_or_a_self_named_hayy_is_kept_and_nothing_else():
    assert K.neighborhood_word("الملقا", "حي الحيلة الغربي", None) == "حي الحيلة الغربي"   # the field wins
    assert K.neighborhood_word("الملقا", None, "حي الملقا") == "الملقا"                    # the catalog knows it
    assert K.neighborhood_word("حي بحرة", None, None) == "حي بحرة"                         # it names itself a district
    for junk in ["حي", "حي 12", "حي الراقي JIJB", "بحي الراقي", "محافظة محايل عسير حى", None]:
        assert K.neighborhood_word(junk, None, None) is None, junk


# Recorded map lines (stored 2026-10-18) that END in a district they name: that segment is the source's word.
@pytest.mark.parametrize("line, word", [
    ("الرياض حي النضيم", "حي النضيم"),
    ("خميس مشيط حي الاسكان", "حي الاسكان"),
    ("عقارات الرياض الرياض حي ضهر البن", "حي ضهر البن"),
])
def test_a_map_line_ending_in_a_named_district_gives_that_segment(line, word):
    assert K.neighborhood_word(line, None, None) == word


# 2026-10-18, recorded: the field separated by «_», followed by the page's review box (advertiser handle and phone
# scrubbed here). Read as one comma-free segment, the whole run was stored as the district.
FIELD_UNDERSCORE = ("الموقع: حي النهضه _ صبيا _ جازان _ المملكة العربية السعودية اكتب مراجعة معرض المراجعات: اختر ملف "
                    "اختر ملف تعليقات: * إرسال المراجعة")


def test_an_underscore_separated_field_gives_the_district_segment_only():
    assert K.location_field_district(FIELD_UNDERSCORE) == "حي النهضه"


@pytest.mark.parametrize("field", [
    "الموقع: حي النهضه صبيا جازان المملكة العربية السعودية اكتب مراجعة معرض المراجعات",   # no separator: a run of text
    "الموقع: حي الربوة 12، الرياض 12345, Saudi Arabia",                                     # digits in the segment
])
def test_mutation_a_field_segment_that_is_not_a_district_name_is_nothing(field):
    assert K.location_field_district(field) is None
