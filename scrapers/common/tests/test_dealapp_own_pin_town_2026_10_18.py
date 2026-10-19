"""dealapp: a town name that is a city in several regions is placed by the ad's OWN pin, or not at all (owner 2026-10-18).

151 served dealapp ads had no city: «الكهفة» is a catalogue city in the Eastern region AND in Hail, «الدرب» in Asir AND
Jazan, «قصيباء» in four regions. The ad's own pin decides, only when it sits inside exactly one candidate's region, at
least PIN_MARGIN_KM from every other candidate's region, and that region holds exactly one city of the name. Pins are
real ads' (DA417737, DA393253, DA394121, DA394609).

Run: python -m pytest scrapers/common/tests/test_dealapp_own_pin_town_2026_10_18.py -v
"""
import json
import sys

sys.path.insert(0, ".")

import pytest  # noqa: E402

from scrapers.common import arabic_location as _al  # noqa: E402
from scrapers.dealapp.run import map_listing  # noqa: E402

CATALOG = {
    "الكهفه": [(126, 5), (1965, 8)],
    "الدرب": [(1862, 6), (3402, 10)],
    "الرويضه": [(885, 1), (182, 1), (2774, 4)],
    "ليلي": [(700, 1)],
}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(_al, "_CITY", dict(CATALOG))


def test_the_pin_picks_the_one_candidate_whose_region_holds_it():
    assert _al.city_by_own_pin("الكهفة", 27.065563697474456, 43.01000789625592) == 1965   # Hail, not Eastern
    assert _al.city_by_own_pin("الدرب", 17.70873702591647, 42.273993093511926) == 3402    # Jazan, not Asir


def test_a_pin_near_the_other_candidates_border_places_nothing():
    # DA394121 sits ~1 km from the simplified Jazan/Asir line: the outline cannot tell.
    assert _al.city_by_own_pin("الدرب", 17.89746871848695, 42.26428071546034) is None


def test_two_cities_of_the_name_in_the_pins_region_place_nothing():
    assert _al.city_by_own_pin("الرويضة", 23.71869191859217, 44.6644192481127) is None    # twice in Riyadh


def test_no_pin_a_pin_outside_ksa_or_a_one_city_name_places_nothing():
    assert _al.city_by_own_pin("الكهفة", None, None) is None
    assert _al.city_by_own_pin("الكهفة", 0, 0) is None
    assert _al.city_by_own_pin("الكهفة", 30.04, 31.24) is None      # Cairo
    assert _al.city_by_own_pin("ليلى", 22.28, 46.73) is None        # one city: the bridge needs no pin
    assert _al.city_by_own_pin("مكان مجهول", 27.07, 43.01) is None


def _page(city_ar, lat, lng):
    schema = {"@type": "RealEstateListing", "name": f"أرض للبيع - {city_ar}",
              "offers": {"price": 300000, "priceCurrency": "SAR", "availability": "https://schema.org/InStock"},
              "itemOffered": {"additionalProperty": [{"name": "propertyType", "value": "أرض"}],
                              "address": {}, "geo": {"latitude": lat, "longitude": lng}}}
    crumb = {"itemListElement": [{"position": 1, "name": "الرئيسية"}, {"position": 2, "name": city_ar}]}
    state = {"schemaMarkupScripts": {"real-estate-listing-1": json.dumps(schema),
                                     "breadcrumb-list-schema": json.dumps(crumb)}}
    return f'<html><body><script id="ng-state" type="application/json">{json.dumps(state)}</script></body></html>'


def test_map_listing_stores_the_pin_city_with_its_provenance():
    row, _cat, _sold = map_listing(_page("الكهفة", 27.065563697474456, 43.01000789625592), "417737")
    assert row["additional_info"]["pin_city_id"] == 1965
    assert row["additional_info"]["city_source"] == "own_pin_disambiguation"
    row, _cat, _sold = map_listing(_page("الرويضة", 23.71869191859217, 44.6644192481127), "394609")
    assert "pin_city_id" not in row["additional_info"] and "city_source" not in row["additional_info"]
