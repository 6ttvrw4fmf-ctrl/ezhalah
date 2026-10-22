"""Pins the weekly border robot found published and unsaved (run 39836874659, 2026-10-22).

· sakan: pages stopped printing `show_exact_location`; ads 96939/96960 in حي الندوة carry two DIFFERENT
  markers 60 m apart (copied from the live page). A page that says `= false` is still not read, nor the
  old shared Riyadh default.
· almuteb: Houzez REST `fave_property_location` «LAT,LNG,ZOOM» (live: 24.9018849,46.6226254,16 on
  «فلل بحي العارض»).
"""
from scrapers.almuteb import run as almuteb
from scrapers.sakan import run as sakan

LIVE_96939 = ("function myMap() { var gmarkers = []; latLng = new google.maps.LatLng(24.798202096423783,46.86829775051132) "
              "var mapOptions = { center: latLng, zoom: 15, };")


def test_sakan_marker_without_the_flag_is_the_pin():
    assert sakan._marker_when_flag_absent(LIVE_96939) == {"latitude": 24.798202096423783, "longitude": 46.86829775051132}


def test_sakan_page_saying_false_is_still_an_approximation():
    assert sakan._marker_when_flag_absent("var show_exact_location = false; " + LIVE_96939) == {}


def test_sakan_old_shared_default_is_never_a_pin():
    assert sakan._marker_when_flag_absent("new google.maps.LatLng(24.7173,46.6753)") == {}


def test_sakan_no_marker_no_pin():
    assert sakan._marker_when_flag_absent("<html>no map here</html>") == {}


def test_almuteb_houzez_location_is_saved():
    post = {"property_meta": {"fave_property_location": ["24.9018849,46.6226254,16"]}}
    assert almuteb._location_pin(post) == {"latitude": 24.9018849, "longitude": 46.6226254}


def test_almuteb_without_location_has_no_pin():
    assert almuteb._location_pin({"property_meta": {}}) == {}
    assert almuteb._location_pin({"property_meta": {"fave_property_location": ["0,0,16"]}}) == {}
