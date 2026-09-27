"""Manzo: `property_age` is a BUILD YEAR; the primary pricing option names the period."""
import pytest

import scrapers.manzo.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (227, 5) if c else (None, None))


def _d(**kw):
    d = {"display_status": "active", "property_type": "long_term_rent", "property_category": "Apartment",
         "slug": "long_term_rent-2500m2-rNWNNZWL", "property_id": 1403, "price": "48000.00", "area": "2500.00",
         "pricing_options": [{"price": 48000.0, "period": "annual", "primary": True}], "city": "الظهران",
         "property_age": 2019, "title_ar": "شقة للإيجار في الظهران", "lister_info": {"name": "Faisal"}}
    d.update(kw)
    return d


def test_the_build_year_becomes_an_age_and_the_period_is_the_sources():
    (row, _), why = R.map_property(_d())
    assert why == "" and row["property_age"] is not None and row["property_age"] < 20
    assert (row["rent_period"], row["price_annual"]) == ("annual", 48000)


def test_an_inactive_listing_is_skipped_and_the_lister_is_never_stored():
    assert R.map_property(_d(display_status="paused"))[0] is None
    assert "Faisal" not in str(R.map_property(_d())[0][0])
