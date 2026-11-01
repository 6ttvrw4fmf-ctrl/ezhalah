"""dealapp «جزيرة فرسان» is the island of «فرسان», a town both Jazan (3571) and Asir (1675) hold: the ad's own pin decides
by the same rule as the other twin towns, or nothing is placed (owner 2026-10-19). The page's own word stays in
city_ar; the catalogue form travels as additional_info.catalog_town_ar. Pins are DA418566's and DA553555's.

Run: python -m pytest scrapers/common/tests/test_dealapp_island_town_by_own_pin_2026_10_19.py -v
"""
import json
import sys

sys.path.insert(0, ".")

import pytest  # noqa: E402

from scrapers.common import arabic_location as _al  # noqa: E402
from scrapers.dealapp.run import map_listing  # noqa: E402


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(_al, "_CITY", {"فرسان": [(3571, 10), (1675, 6)], "ليلي": [(700, 1)]})


def _page(city_ar, lat, lng):
    schema = {"@type": "RealEstateListing", "name": f"أرض للبيع - {city_ar}",
              "offers": {"price": 300000, "priceCurrency": "SAR", "availability": "https://schema.org/InStock"},
              "itemOffered": {"additionalProperty": [{"name": "propertyType", "value": "أرض"}],
                              "address": {}, "geo": {"latitude": lat, "longitude": lng}}}
    crumb = {"itemListElement": [{"position": 1, "name": "الرئيسية"}, {"position": 2, "name": city_ar}]}
    state = {"schemaMarkupScripts": {"real-estate-listing-1": json.dumps(schema),
                                     "breadcrumb-list-schema": json.dumps(crumb)}}
    return f'<html><body><script id="ng-state" type="application/json">{json.dumps(state)}</script></body></html>'


def test_the_island_pinned_in_jazan_is_jazans_farasan_and_keeps_its_own_word():
    row, _c, _s = map_listing(_page("جزيرة فرسان", 16.693197913872442, 42.12538474617556), "418566")
    info = row["additional_info"]
    assert (info["pin_city_id"], info["city_source"], info["catalog_town_ar"]) == (3571, "own_pin_disambiguation", "فرسان")
    assert info["city_ar"] == "جزيرة فرسان"


def test_a_pin_outside_every_region_outline_places_nothing():
    row, _c, _s = map_listing(_page("جزيرة فرسان", 16.855960012886282, 41.933306212148686), "553555")
    assert not {"pin_city_id", "city_source", "catalog_town_ar"} & set(row["additional_info"])


def test_a_catalogue_name_carries_no_catalog_town():
    row, _c, _s = map_listing(_page("فرسان", 16.693197913872442, 42.12538474617556), "1")
    assert row["additional_info"]["pin_city_id"] == 3571 and "catalog_town_ar" not in row["additional_info"]
