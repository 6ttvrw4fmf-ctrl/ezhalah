"""Haraj: when the deed names a city but no «الحي:», REGA's licence location supplies the district — only when the
licence's city IS the deed's city (by name or through loc_catalog_city_alias: جيزان = جازان), never by edit distance.
English locations go through the shared EN→AR bridge (unique key) and must be in the city's catalogue (owner 2026-10-19).

Licence strings are verbatim from the 116 posts re-read on 2026-10-19 (run 39175157914).

Run: python -m pytest scrapers/common/tests/test_haraj_licence_district_same_city_2026_10_19.py -v
"""
from __future__ import annotations

from datetime import date

import pytest

from scrapers.common import arabic_location as AL
from scrapers.haraj import parse as P
from scrapers.haraj import run as R
from scrapers.haraj.classify import classify

BURAIDAH, JAZAN, MAKKAH, JEDDAH, MAHAYEL, RIYADH = 4, 30, 2, 1, 50, 3
CITY = {"بريده": [(BURAIDAH, 4)], "جازان": [(JAZAN, 10)], "جيزان": [(JAZAN, 10)],   # جيزان: an alias row
        "مكه": [(MAKKAH, 2)], "جده": [(JEDDAH, 2)], "محايل عسير": [(MAHAYEL, 6)], "الرياض": [(RIYADH, 1)],
        "حائل": [(9, 8)], "تربه": [(11, 2)], "الافلاج": [(17, 1)]}
CATALOG = {(RIYADH, "حي الخير"), (RIYADH, "حي الملز"), (RIYADH, "حي الضباط")}   # both «Al Malaz» answers are real districts
BRIDGE = {"Riyadh": (("Al Khair Dist.", "حي الخير"), ("Al Malaz", "حي الملز"), ("Al Malaz", "حي الضباط"))}


@pytest.fixture(autouse=True)
def _seed(monkeypatch):
    monkeypatch.setattr(AL, "_CITY", dict(CITY))
    monkeypatch.setattr(R, "city_ar_for", {RIYADH: "الرياض", JAZAN: "جازان", BURAIDAH: "بريدة"}.get)
    monkeypatch.setattr(R, "bridge_rows", lambda city_en: BRIDGE.get(city_en, ()))
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: d if (cid, d) in CATALOG else None)


def _p(loc, deed):
    return {"deed_city_ar": deed, "licence_location": loc}


@pytest.mark.parametrize("loc, deed, cid, want", [
    ("منطقة القصيم, بريدة, الليوان", "بريدة", BURAIDAH, "الليوان"),
    ("منطقة جازان, جازان, السويس 2", "جيزان", JAZAN, "السويس 2"),            # equal only through the alias row
    ("حي المليداء بمدينة بريدة .", "بريدة", BURAIDAH, "المليداء"),
    ("حي الحيلة محافظة محايل عسير مساحة الوحدة من الأرض 49.2 متر", "محايل عسير", MAHAYEL, "الحيلة"),
    ("حي الملك عبدالله في محافظة الأفلاج", "الأفلاج", 17, "الملك عبدالله"),     # «في» is not part of the name
])
def test_the_licence_district_is_taken_when_its_city_is_the_deeds(loc, deed, cid, want):
    assert R.licence_district(_p(loc, deed), cid) == (want, "licence_location")


@pytest.mark.parametrize("loc, deed, cid", [
    ("منطقة مكة المكرمة, جدة, الزهراء", "مكه", MAKKAH),               # another city: left as it is
    ("حي الدهناء في مدينة تربة حائل", "مكه", MAKKAH),
    ("المنطقة الشرقية, الاحساء, هجر الخامس", "الهفوف", 7),             # no alias joins them: not the same city
    ("حي مركز العبدلية (ب) في محافظة الغاط", "الغاط", 12),            # not a plain «حي X <marker> CITY»
    ("قطعة الارض رقم 331 من المخطط رقم 686 الواقع فى حى الريحانى جنوب طريق حرض محافظة الخرج .", "الخرج", 13),
    ("منطقة جازان, العدايا, العدايا", "صبيا", 14),                      # a village named twice is no district
    ("منطقة عسير, المعلمات, غير محدد", "البرك", 15),
    ("منطقة جازان, جازان, جازان", "جازان", JAZAN),                       # the city repeated is no district
    ("Al Qassim Region, Alfwylq, Not Determined", "عيون الجواء", 16),
])
def test_another_city_or_no_district_gives_nothing(loc, deed, cid):
    assert R.licence_district(_p(loc, deed), cid) == (None, None)


def test_english_goes_through_the_unique_bridge_and_the_catalogue():
    assert R.licence_district(_p("Riyadh Region, Riyadh, Al Khair", "الرياض"), RIYADH) == ("حي الخير", "licence_location_en_bridge")
    assert R.licence_district(_p("Riyadh Region, Riyadh, Al Malaz", "الرياض"), RIYADH) == (None, None)   # two answers
    assert R.licence_district(_p("Hail Region, Hayil, Al-Luqayyata", "حائل"), 9) == (None, None)        # «Hayil» ≠ «Hail»
    assert R.licence_district(_p("Riyadh Region, Diriyah, Al Khair", "الرياض"), RIYADH) == (None, None)  # another city
    CATALOG.discard((RIYADH, "حي الخير"))
    try:
        assert R.licence_district(_p("Riyadh Region, Riyadh, Al Khair", "الرياض"), RIYADH) == (None, None)
    finally:
        CATALOG.add((RIYADH, "حي الخير"))


def test_no_deed_city_leaves_the_old_precedence_alone():
    assert R.licence_district(_p("منطقة القصيم, بريدة, الليوان", None), BURAIDAH) == (None, None)


DEED = ("معلومات العقار حسب الرخصة\nغرض الإعلان: بيع\nسعر الوحدة: 1300000\nنوع العقار: فيلا\nمساحة العقار: 418\n"
        "وصف موقع العقار: منطقة القصيم, بريدة, الليوان\n"
        "تاريخ انتهاء رخصة الإعلان : 2027-08-31\n-----\nوصف موقع العقار حسب الصك\nالمدينة: بريدة\n{hay}")


def _row(monkeypatch, hay):
    monkeypatch.setattr(R, "resolve", lambda c, d=None, region_hint=None: {"city_id": BURAIDAH, "region_id": 4})
    ld = {"@type": "RealEstateListing", "name": "فيلا للبيع", "description": DEED.format(hay=hay),
          "url": "https://haraj.com.sa/1/x/", "datePosted": "2026-10-10T05:38:40.000Z",
          "address": {"addressLocality": "بريدة"}, "image": ["https://img4cdn.haraj.com.sa/a.jpg"]}
    v, why = classify(ld["name"], P.strip_person_lines(ld["description"]))
    row, _, skip, _ = R.map_post("1", ld, "", v, why, today=date(2026, 10, 19))
    assert skip == "" and row is not None
    return row


def test_map_post_serves_the_licence_district_and_the_deed_still_wins(monkeypatch):
    row = _row(monkeypatch, "")
    assert (row["district_ar"], row["additional_info"]["district_source"]) == ("الليوان", "licence_location")
    row = _row(monkeypatch, "الحي: الريان\n")
    assert (row["district_ar"], row["additional_info"]["district_source"]) == ("الريان", "deed")
