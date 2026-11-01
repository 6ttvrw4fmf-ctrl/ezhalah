"""aqarmonthly: the district Aqar names for the listing's own district_id, when slug and address are silent.

281 live rows had no district (2026-10-18). Their slug has no «حي» («شارع-جدة-819-جدة-جدة-6918220») and the
address ends «…، جدة ، جدة» (district == city → honest null), yet the listing record carries Aqar's district_id
3494 and the page redirects to «/جدة/شمال-جدة/حي-الزمرد/…». Aqar names that id itself: Web.districts(category,
city_id) → {district_id: name} (read live 2026-10-18: 3494 → «حي الزمرد», Abha 3816 → «حي المروج»; the id→name
pairing is the same under the listing's category and under category 1). The name is Aqar's own district
entity, kept as written; a slug or address district still wins first; an unknown id or an unreadable list
yields nothing. Every value below is the recorded record, verbatim.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al
import scrapers.aqarmonthly.run as R

PRICE = {"discounted_price": 3000}
AQAR = {(66, 102): {3494: "حي الزمرد", 3514: "حي الشاطئ"}, (66, 1): {3494: "حي الزمرد"}, (1, 101): {3816: "حي المروج"}}
JEDDAH = {"id": 6918220, "uri": "شارع-جدة-819-جدة-جدة-6918220", "area": 100, "imgs": [], "address": "شارع جدة 819 ، جدة ، جدة",
          "city_id": 66, "district_id": 3494, "category": 102}


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {"الرياض": [(3, 1)], "جدة": [(18, 2)], "جده": [(18, 2)]})
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض", 18: "جدة"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    monkeypatch.setattr(al, "_DISTRICT_AR_BY_CITY", {(3, al.norm_district_tok("حي الصحافة")): "حي الصحافة"})
    monkeypatch.setattr(R, "_aqar_districts", lambda city_id, category: AQAR.get((city_id, category), {}))


def test_recorded_jeddah_record_gets_aqars_own_district_name():
    row = R.map_listing(JEDDAH, PRICE)
    assert row is not None
    assert row["district_ar"] == "حي الزمرد" and row["neighborhood"] == "حي الزمرد"


def test_the_listings_category_first_then_category_one():
    assert R._district_from_aqar_id(66, 3494, 102) == "حي الزمرد"
    assert R._district_from_aqar_id(66, 3494, 999) == "حي الزمرد"          # unknown category → Aqar's full list
    assert R._district_from_aqar_id(1, 3816, 101) == "حي المروج"           # Abha, recorded 2026-10-18


@pytest.mark.parametrize("city_id, district_id, category", [
    (66, 4040, 102),      # an id Aqar's list does not carry
    (66, 0, 102),         # no id
    (None, 3494, 102),    # no city
    (77, 3494, 102),      # a city whose list is unreadable → {}
])
def test_mutation_unknown_id_or_unreadable_list_is_no_district(city_id, district_id, category):
    assert R._district_from_aqar_id(city_id, district_id, category) is None
    row = R.map_listing({**JEDDAH, "city_id": city_id, "district_id": district_id, "category": category}, PRICE)
    assert row is not None and row["district_ar"] is None and row["neighborhood"] is None


def test_garbage_ids_are_no_district_but_a_garbage_category_falls_back_to_aqars_full_list():
    assert R._district_from_aqar_id("x", "y", 1) is None and R._district_from_aqar_id(66, None, 102) is None
    assert R._district_from_aqar_id(66, 3494, "k") == "حي الزمرد"      # category unusable → category 1


def test_slug_and_address_districts_still_win_first(monkeypatch):
    seen = []
    monkeypatch.setattr(R, "_district_from_aqar_id", lambda *a: seen.append(a) or "حي الزمرد")
    row = R.map_listing({**JEDDAH, "uri": "حي-الصحافة-الرياض-منطقة-الرياض-5839666", "address": None, "city_id": 3}, PRICE)
    assert row["district_ar"] == "حي الصحافة" and seen == []


def test_a_failed_graphql_read_degrades_to_nothing(monkeypatch, capsys):
    monkeypatch.undo()
    def down(*a, **k):
        raise RuntimeError("gql down")
    monkeypatch.setattr(R, "_gql", down)
    R._aqar_districts.cache_clear()
    try:
        assert R._aqar_districts(66, 102) == {}
    finally:
        R._aqar_districts.cache_clear()
    assert "gql down" in capsys.readouterr().out
