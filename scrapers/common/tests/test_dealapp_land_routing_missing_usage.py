"""dealapp land routing (🆕 New Listings Engineer, 2026-10-03).

The usage chip «استخدامات العقار» routes land residential vs commercial when the page renders it.
When the page renders NO chip, the ad's own propertyType must stand: «ارض تجارية» with no chip used
to be filed as Residential Land out of silence (new rows 14986583-class, measured 2 of 3,323).

Run: python -m pytest scrapers/common/tests/test_dealapp_land_routing_missing_usage.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import TYPE_MAP_AR, _route_land  # noqa: E402


def test_missing_usage_keeps_the_ads_own_land_type():
    assert TYPE_MAP_AR["ارض تجارية"] == "Commercial Land"
    assert _route_land("Commercial Land", None) == "Commercial Land"
    assert _route_land("Commercial Land", "") == "Commercial Land"
    assert _route_land("Residential Land", None) == "Residential Land"


def test_usage_chip_still_decides_when_rendered():
    assert _route_land("Residential Land", "تجاري") == "Commercial Land"
    assert _route_land("Commercial Land", "سكني") == "Residential Land"


def test_non_land_types_are_untouched():
    assert _route_land("Apartment", "تجاري") == "Apartment"
    assert _route_land(None, None) is None
