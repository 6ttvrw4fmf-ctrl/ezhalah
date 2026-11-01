"""Nuzul SaaS facade and street width reach their columns (🔬 AF engineer, 2026-10-11).

aldarim / abwbna / alobid / bahadhabab publish `facade` as an English slug cell and up to five width cells.
All four filed them only in additional_info: on 2026-10-11, 308 active ads stated a facade and 299 a width,
and direction / street_width_m were NULL on every one, so the Advanced Filter's direction and street-width
questions could never find them. aldarim_residential_listings:576280 (aldarim.sa/properties/49043) states
«الواجهة غربية · عرض الشارع الغربي 30 م» on its page; its payload carries facade "west", street_width_west 30.
"""
from __future__ import annotations

import importlib
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import arabic_location as al  # noqa: E402

SITES = ["aldarim", "abwbna", "alobid", "bahadhabab"]


@pytest.fixture(autouse=True)
def no_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {})
    monkeypatch.setattr(al, "_CID_AR", {})
    monkeypatch.setattr(al, "_REGION_NORM", {})


def _L(**kw):
    base = {"id": 49043, "type": "villa", "purpose": "sale", "category": "residential", "selling_price": 11000000,
            "area": 875, "city": {"name_ar": "الرياض", "name_en": "Riyadh"}, "district": {"name_ar": "النخيل"},
            "url_path": "x", "bedrooms": 0, "bathrooms": 0}
    return {**base, **kw}


@pytest.mark.parametrize("site", SITES)
def test_the_published_facade_and_width_are_stored(site):
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(_L(facade="west", street_width_west=30))
    assert row["direction"] == "غرب" and row["street_width_m"] == 30


@pytest.mark.parametrize("site", SITES)
def test_the_general_width_cell_counts_too(site):
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(_L(facade="south", street_width="20"))
    assert row["direction"] == "جنوب" and row["street_width_m"] == 20


@pytest.mark.parametrize("site", SITES)
@pytest.mark.parametrize("facade", ["north_south", "north_east", "north_south_east_west"])
def test_several_facades_are_not_one_direction(site, facade):
    # a compound slug lists facades (it reaches four): a corner plot, never a diagonal
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(_L(facade=facade))
    assert row["direction"] is None


@pytest.mark.parametrize("site", SITES)
def test_two_streets_are_not_one_width(site):
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(
        _L(facade="north_west", street_width_north=20, street_width_west=15))
    assert row["street_width_m"] is None


@pytest.mark.parametrize("site", SITES)
def test_silence_is_unknown(site):
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(_L(street_width=0))
    assert row["direction"] is None and row["street_width_m"] is None
