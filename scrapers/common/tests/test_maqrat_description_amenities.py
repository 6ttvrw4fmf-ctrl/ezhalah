"""MAQRAT: the ad's own description answers the amenity columns its chips cannot express (🔬 2026-10-23, backlog 790).

The «خدمات العقار» chips are the only structured amenity field and say utilities plus «مصعد». 213 active ads, 2 with
any Advanced Filter answer, while 13605174 says «مطبخ راكب مكيفات اسبلت» and 19039930 «شقة مؤثثة»: ops_af_score
2026-10-23 maqrat 0 of 5 findable. Elevator stays the chips' (prose never answers it); silence writes nothing.
"""
import pytest

import scrapers.maqrat.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (15, 4) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي النور" if t else None)


def _row(desc, title="شقة للبيع", services=()):
    kv = {"نوع العقار": "شقة", "سعر الوحدة": "715,000", "المدينة": "الخبر", "المنطقة": "المنطقة الشرقية"}
    (row, _), why = R.map_listing("10104", {"deal": "للبيع"}, {"kv": kv, "title": title, "description": desc,
                                                              "services": list(services), "photos": []})
    assert why == ""
    return row


def test_13605174_kitchen_and_ac_come_from_its_description():
    row = _row("شقه مرهونه مكونه من غرفة نوم ماستر غرفتين نوم مقلط مجلس نساء مجلس رجال غرفة عامله مع حمام او "
               "غرفة غسيل مطبخ راكب مكيفات اسبلت مساحه ٢١٤ عمرها ٤سنوات")
    assert row.get("kitchen") is True and row.get("air_conditioner") is True


def test_19039930_furnished_comes_from_its_description():
    assert _row("شقة مؤثثة جديدة فاخرة مكونة من 5 غرف للبيع").get("furnished") is True


def test_prose_never_answers_elevator_and_silence_writes_nothing():
    row = _row("عمارة بمصعد حديث", services=["كهرباء", "مياه"])
    assert "elevator" not in row
    assert _row("شقة مؤثثة", services=["مصعد"]).get("elevator") is True
    row = _row("شقة واسعة قريبة من الخدمات")
    assert not any(c in row for c in R.PROSE_COLS)


def test_a_negation_is_a_statement():
    assert _row("الشقة غير مؤثثة").get("furnished") is False


def test_a_fixture_that_is_not_this_units_writes_nothing():
    # replayed over every active maqrat row, 2026-10-23: three would have been a wrong «yes»
    assert "parking" not in _row("موقع تجاري يبعد 3 دقائق عن مواقف كدي و12 دقيقة عن الحرم المكي")
    assert "furnished" not in _row("يوجد شقة في نفس المشروع داخليه مؤثثة البيع 680 الف")
    assert "furnished" not in _row("مرونة تصميمية للمشاريع الكبرى (شقق تمليك، مبنى إداري، شقق مفروشة)")
    assert _row("موقف خاص - يبعد 5 دقائق عن الحرم").get("parking") is True
