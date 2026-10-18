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

import pytest

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


def test_the_map_line_still_answers_when_it_starts_with_the_district():
    assert K.district_candidate("غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة") == "الملقا"
    row, _cat, why = K.map_listing(_post(), SPEC, "")
    assert row is not None, why
    assert row["neighborhood"] == "الملقا" and row["additional_info"]["district_source"] == "map_line"
