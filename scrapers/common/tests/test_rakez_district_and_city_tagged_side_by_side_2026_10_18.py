"""rakez: a district and its city tagged SIDE BY SIDE under the region give that city and district (2026-10-18).

/ar/project/1908/ («شقق تمليك بالخبر ماربيلا 07») prints «المدينة: الحمراء , الخبر». Read live from /wp-json/wp/v2/city
the same day: 734 «الحمراء» → 2720 «الشرقية» and 1049 «الخبر» → 2720 «الشرقية» — siblings, so the deepest tag's own
chain [الحمراء, الشرقية] never reached a city and 7 live units carried no city and no district. Exactly one tagged
city in the chain's region is the stated city; two tagged cities, or one in another region, are not a choice.
"""
from __future__ import annotations

import scrapers.common.arabic_location as _al
from scrapers.rakez import run as R

_KHOBAR, _DAMMAM, _JEDDAH = 31, 30, 2
TREE = {
    2720: {"name": "الشرقية", "parent": 0},       # a region root
    734:  {"name": "الحمراء", "parent": 2720},
    1049: {"name": "الخبر",   "parent": 2720},
    1050: {"name": "الدمام",  "parent": 2720},
    2994: {"name": "الخور",   "parent": 2720},
    16:   {"name": "جدة",     "parent": 0},
}


def _seed(monkeypatch):
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    monkeypatch.setitem(_al._REGION_AR_FOR, 5, "المنطقة الشرقية")
    monkeypatch.setitem(_al._REGION_AR_FOR, 2, "منطقة مكة المكرمة")
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _KHOBAR, {_al.norm_district_tok("حي الحمراء")})
    monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok("حي الحمراء"), "حي الحمراء")
    monkeypatch.setattr(R, "to_catalog", lambda name, region_hint=None: {
        "الخبر": (_KHOBAR, 5), "الدمام": (_DAMMAM, 5), "جدة": (_JEDDAH, 2)}.get(name, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", _al.find_district_in_text)


def test_the_tagged_sibling_city_and_its_district(monkeypatch):
    _seed(monkeypatch)
    for order in ([734, 1049], [1049, 734]):
        city_ar, city_id, _rid, district = R.resolve_location(order, TREE, "شقق تمليك بالخبر ماربيلا 07")
        assert (city_ar, city_id, district) == ("الخبر", _KHOBAR, "حي الحمراء"), order


def test_no_city_tagged_two_cities_or_another_region_places_nothing(monkeypatch):
    _seed(monkeypatch)
    assert R.resolve_location([2994], TREE, "شقق لوفر الخور تاور – الخور الشرقية")[1] is None   # district + region only
    assert R.resolve_location([734, 1049, 1050], TREE, "x")[1] is None                         # الخبر AND الدمام
    assert R.resolve_location([734, 16], TREE, "x")[1] is None                                 # جدة is not in الشرقية


# 2026-10-18 (owner, the المبرز pattern): «المدينة: الخور , الشرقية» (/ar/project/56418/, 28 units) names a district and
# its REGION, no city. Placed only when the catalogue has that district in exactly ONE city of the region.
TREE2 = {**TREE, 2634: {"name": "الشبيلي الشرقية", "parent": 2720}}


def _seed_khor(monkeypatch, *, dammam_has_khor=False):
    _seed(monkeypatch)
    monkeypatch.setitem(_al._CITY, "الخبر", [(_KHOBAR, 5)])
    monkeypatch.setitem(_al._CITY, "الدمام", [(_DAMMAM, 5)])
    monkeypatch.setitem(_al._CID_AR, _KHOBAR, "الخبر")
    k = _al.norm_district_tok("حي الخور")
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _KHOBAR, {_al.norm_district_tok("حي الحمراء"), k})
    monkeypatch.setitem(_al._DISTRICT_AR_BY_CITY, (_KHOBAR, k), "حي الخور")
    if dammam_has_khor:
        monkeypatch.setitem(_al._DISTRICT_BY_CITY, _DAMMAM, {k})


def test_a_district_one_city_of_its_region_owns_places_the_project(monkeypatch):
    _seed_khor(monkeypatch)
    city_ar, city_id, rid, district = R.resolve_location([2994], TREE2, "شقق لوفر الخور تاور – الخور الشرقية")
    assert (city_ar, city_id, rid, district) == ("الخبر", _KHOBAR, 5, "حي الخور")


def test_a_district_two_cities_share_or_none_has_places_nothing(monkeypatch):
    _seed_khor(monkeypatch, dammam_has_khor=True)
    assert R.resolve_location([2994], TREE2, "x")[1] is None                       # الخبر AND الدمام
    _seed_khor(monkeypatch)
    assert R.resolve_location([2634], TREE2, "شقق برج ويف – الشبيلي الشرقية")[1] is None   # no city has it
