"""Regression tests for scrapers/abeea/run.py:_select_area() and
scrapers/muktamel/run.py:_select_area() (2026-07-28).

The bug: both scrapers had an unconditional "land size OR building size" fallback chain for
area_m2, applied to EVERY property type including apartments/villas. A source page for a
villa/house can carry BOTH a plot size ("Land Area" / landArea) and a living/built size
("Property Size" / buildingArea); the old code always preferred the land figure regardless of
type, silently storing the plot size instead of the unit's own area.

Live-confirmed on abeea: villa ad ABRE151 stored area_m2=360 (Land Area) while the page's own
Property Size was 510 — 29% too low, and semantically the wrong kind of area (plot, not building).
muktamel had the identical unconditional-preference shape in code (0 active listings at audit
time, so no live row to reproduce against, but the same fix applies for when it's re-activated).

Fix: gate the preference on property type — prefer the BUILT/LIVING size for anything that is NOT
a land type, and keep the LAND size preference only for actual land listings. Either field is used
as a fallback if the preferred one is missing, so no listing ever loses its only available number.

Run: python -m pytest scrapers/common/tests/test_abeea_muktamel_area_fidelity.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.abeea.run import _select_area as abeea_select_area  # noqa: E402
from scrapers.muktamel.run import LAND_TYPES, _select_area as muktamel_select_area  # noqa: E402


# ── abeea ──────────────────────────────────────────────────────────────────────────────────────

def test_abeea_real_repro_villa_both_fields_present():
    # ad ABRE151, live 2026-07-28: Land Area 360, Property Size 510 — non-land listing must get 510.
    items = {"Land Area": "360", "Property Size": "510"}
    assert abeea_select_area(False, items) == 510


def test_abeea_land_listing_prefers_land_area():
    items = {"Land Area": "360", "Property Size": "510"}
    assert abeea_select_area(True, items) == 360


def test_abeea_non_land_falls_back_to_size_when_property_size_missing():
    assert abeea_select_area(False, {"Size": "112.12"}) == 112


def test_abeea_non_land_falls_back_to_land_area_when_nothing_else_present():
    # Better to store SOMETHING than nothing when the page only ever printed one field.
    assert abeea_select_area(False, {"Land Area": "400"}) == 400


def test_abeea_land_listing_falls_back_to_property_size_when_land_area_missing():
    assert abeea_select_area(True, {"Property Size": "250"}) == 250


def test_abeea_no_fields_at_all_returns_none():
    assert abeea_select_area(False, {}) is None


# ── muktamel ───────────────────────────────────────────────────────────────────────────────────

def test_muktamel_villa_both_fields_present_prefers_building_area():
    offer = {"landArea": 800, "buildingArea": 544}
    assert muktamel_select_area("Villa", offer) == 544


def test_muktamel_apartment_both_fields_present_prefers_building_area():
    offer = {"landArea": 300, "buildingArea": 120}
    assert muktamel_select_area("Apartment", offer) == 120


def test_muktamel_land_type_prefers_land_area():
    offer = {"landArea": 800, "buildingArea": 544}
    for t in LAND_TYPES:
        assert muktamel_select_area(t, offer) == 800


def test_muktamel_non_land_falls_back_to_land_area_when_building_area_missing():
    assert muktamel_select_area("Apartment", {"landArea": 200}) == 200


def test_muktamel_land_falls_back_to_building_area_when_land_area_missing():
    assert muktamel_select_area("Residential Land", {"buildingArea": 250}) == 250


def test_muktamel_no_fields_at_all_returns_none():
    assert muktamel_select_area("Villa", {}) is None


if __name__ == "__main__":
    test_abeea_real_repro_villa_both_fields_present()
    test_abeea_land_listing_prefers_land_area()
    test_abeea_non_land_falls_back_to_size_when_property_size_missing()
    test_abeea_non_land_falls_back_to_land_area_when_nothing_else_present()
    test_abeea_land_listing_falls_back_to_property_size_when_land_area_missing()
    test_abeea_no_fields_at_all_returns_none()
    test_muktamel_villa_both_fields_present_prefers_building_area()
    test_muktamel_apartment_both_fields_present_prefers_building_area()
    test_muktamel_land_type_prefers_land_area()
    test_muktamel_non_land_falls_back_to_land_area_when_building_area_missing()
    test_muktamel_land_falls_back_to_building_area_when_land_area_missing()
    test_muktamel_no_fields_at_all_returns_none()
    print("OK — abeea/muktamel area-fidelity regression tests pass")
