"""aldarim: a same-name TWIN city is settled by the district the ad itself states (2026-11-10).

Measured: aldarim ad 50820 — the API states city «المجمعة» and district «حي المطار». «المجمعة» is a
4-way catalogue twin (Riyadh, Makkah, Aseer ×2), aldarim publishes no region, so to_catalog() answered
(None, None) and the ad sat hidden from search (city_id NULL → not production_ready) since July.
Only the Riyadh-region twin has a «المطار» district, so the ad's own district names the city.

The rule stays never-guess: no district, a district no twin has, or a district two twins share → NULL.

Run: python -m pytest scrapers/common/tests/test_aldarim_twin_city_settled_by_its_own_district_2026_11_10.py -v
"""
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import arabic_location as al  # noqa: E402
from scrapers.aldarim.run import map_listing  # noqa: E402

CITY = {"id": 24, "name_en": "Al Majma'ah", "name_ar": "المجمعة"}          # as the API sends it
DISTRICT = {"id": 10100024008, "name_en": "Al Matar Dist.", "name_ar": "حي المطار"}


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    k = al.norm_district_tok
    monkeypatch.setattr(al, "_CITY", {
        al.norm_ar("المجمعة"): [(24, 1), (1343, 2), (1494, 6), (1761, 6)],   # production's four twins
        al.norm_ar("الرياض"): [(3, 1)],
        al.norm_ar("طويق"): [(9101, 1), (9102, 6)],
    })
    monkeypatch.setattr(al, "_REGION_NORM", {})
    monkeypatch.setattr(al, "_DISTRICT_BY_CITY", {
        24: {k("حي المطار"), k("حي الفيصلية")},
        3: {k("حي المطار")},
        9101: {k("حي مشترك")}, 9102: {k("حي مشترك")},
    })
    yield


def _item(**over):
    base = {"id": 50820, "category": "residential", "purpose": "sell", "type": "land",
            "selling_price": 15000000, "area": 51000, "city": CITY, "district": DISTRICT}
    base.update(over)
    return base


def _ids(item):
    row, _ = map_listing(item)
    assert row is not None
    return row["city_id"], row["region_id"]


def test_the_ads_own_district_names_the_twin():
    assert _ids(_item()) == (24, 1)


def test_the_source_words_are_kept_as_written():
    row, _ = map_listing(_item())
    assert row["city_ar"] == "المجمعة" and row["district_ar"] == "حي المطار"


def test_no_district_stays_unknown():
    assert _ids(_item(district=None)) == (None, None)


def test_a_district_no_twin_has_stays_unknown():
    assert _ids(_item(district={"name_en": "X", "name_ar": "حي غير موجود"})) == (None, None)


def test_a_district_two_twins_share_stays_unknown():
    assert _ids(_item(city={"name_ar": "طويق"}, district={"name_ar": "حي مشترك"})) == (None, None)


def test_an_ordinary_city_is_untouched():
    assert _ids(_item(city={"name_en": "Riyadh", "name_ar": "الرياض"})) == (3, 1)


def test_the_helper_never_answers_for_a_city_that_is_not_a_twin():
    # to_catalog() owns every non-twin answer; the helper must not become a second resolver
    assert al.twin_city_by_district("الرياض", "حي المطار") is None
    assert al.twin_city_by_district("مدينة لا نعرفها", "حي المطار") is None


def test_the_helper_does_not_load_the_catalogue(monkeypatch):
    monkeypatch.setattr(al, "_CITY", {})
    monkeypatch.setattr(al, "_load", lambda: (_ for _ in ()).throw(AssertionError("loaded")))
    assert al.twin_city_by_district("المجمعة", "حي المطار") is None
