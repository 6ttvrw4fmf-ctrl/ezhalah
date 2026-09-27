"""Mobasher: type/area live in searchableAttributes; land type comes from the structured usage list."""
import pytest

import scrapers.mobasher.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (13, 5) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _x(type_ar="أرض", usage=("Industrial",), **kw):
    x = {"listingType": "DIRECT_SALE", "documentId": "d1", "slugAr": "s", "askingPrice": 2000000,
         "cityNameAr": "الدمام", "searchableAttributes": {"propertyTypeAr": type_ar, "propertyUsage": list(usage),
                                                         "propertySpace": 2000, "propertyPriceUnit": "WHOLE",
                                                         "deedNumber": "123456789"}}
    x.update(kw)
    return x


def test_industrial_usage_is_industrial_land_and_price_is_the_asking_total():
    (row, cat), why = R.map_listing(_x(), {})
    assert why == "" and row["property_type"] == "Industrial Land" and row["price_total"] == 2000000


def test_mixed_residential_commercial_land_waits_for_the_owner():
    got, why = R.map_listing(_x(usage=("Residential", "Commercial")), {})
    assert got is None and why.endswith("owner_question")


def test_an_auction_row_never_maps():
    assert R.map_listing(_x(listingType="AUCTION"), {})[0] is None


def test_a_zero_page_age_is_a_default_not_new():
    assert R.page_facts('\\"propertyAge\\":0,') == {}
    assert R.page_facts('\\"propertyAge\\":10,')["age"] == 10
