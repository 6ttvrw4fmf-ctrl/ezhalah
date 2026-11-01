"""rakez: the taxonomy's own leaf is the district, as written, when the catalogue lacks it (owner 2026-10-18).

255 live units had no district. Their projects ARE tagged with a district term — 56204 «شقق برج أتبار –
العنبريه المدينة المنورة» carries the city tree [4343 «العنبرية» → 334 «المدينة المنورة»] (read live from
/wp-json/wp/v2 on 2026-10-18) — but المدينة المنورة's catalogue has no «العنبرية», and the old rule dropped
a tree-named district the catalogue lacked («the title never overrules it»), keeping nothing. The source
named it; it is shown as written. A zone («شمال الرياض»), the city itself and a root term are never a
district; a catalogued leaf still gets the catalogue spelling.
"""
from __future__ import annotations

import pytest

import scrapers.common.arabic_location as _al
from scrapers.rakez import run as R

_RIYADH, _MEDINA = 3, 14
TREE = {
    443:  {"name": "الرياض",         "parent": 0},
    1434: {"name": "شمال الرياض",    "parent": 443},
    566:  {"name": "الياسمين",       "parent": 1434},
    334:  {"name": "المدينة المنورة", "parent": 0},
    4343: {"name": "العنبرية",       "parent": 334},      # not in our catalogue (checked 2026-10-18)
    2720: {"name": "الشرقية",        "parent": 0},        # a region root
}


@pytest.fixture(autouse=True)
def _seed(monkeypatch):
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _RIYADH, {_al.norm_district_tok("حي الياسمين")})
    monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok("حي الياسمين"), "حي الياسمين")
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _MEDINA, set())
    monkeypatch.setattr(R, "to_catalog", lambda name, region_hint=None: {
        "الرياض": (_RIYADH, 1), "المدينة المنورة": (_MEDINA, 3)}.get(name, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", _al.find_district_in_text)


@pytest.mark.parametrize("terms, city_ar, want", [
    ([4343], "المدينة المنورة", "العنبرية"),     # the leaf names a district the catalogue lacks → kept as written
    ([566], "الرياض", "الياسمين"),              # a catalogued leaf is also the source's word
    ([1434], "الرياض", None),                   # a zone is not a district
    ([443], "الرياض", None),                    # the city itself is not its own district
    ([2720], None, None),                       # a region root is not a district
    ([], "الرياض", None),
])
def test_tree_leaf_district_is_the_sources_own_term_or_nothing(terms, city_ar, want):
    assert R.tree_leaf_district(terms, TREE, city_ar) == want


def test_resolve_location_still_prefers_the_catalogue_spelling():
    assert R.resolve_location([566], TREE, "أدوار س – الياسمين الرياض")[3] == "حي الياسمين"
    # the catalogue lacks العنبرية: the catalogue-scoped walk itself still answers None (unchanged) …
    assert R.resolve_location([4343], TREE, "شقق برج أتبار – العنبريه المدينة المنورة")[3] is None
    # … and the leaf, as written, is what map_unit keeps (see test_rakez_unit_and_project_join.py).
    assert R.tree_leaf_district([4343], TREE, "المدينة المنورة") == "العنبرية"
