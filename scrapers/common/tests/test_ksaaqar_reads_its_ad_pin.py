"""ksaaqar: the ad page's hidden ad_lat/ad_lng is the pin, except the map's default centre (owner 2026-10-20 night)."""
import scrapers.ksaaqar.run as K

REAL = '<div id="itemMap"></div> <input type="hidden" id="ad_lat" value="21.2817249"/> <input type="hidden" id="ad_lon" value="40.4325578"/>'
DEFAULT = '<div id="itemMap"></div> <input type="hidden" id="ad_lat" value="24.633333"/> <input type="hidden" id="ad_lon" value="46.716667"/>'


def test_a_placed_pin_is_read():
    assert K.own_pin(REAL) == {"latitude": 21.2817249, "longitude": 40.4325578}


def test_the_default_centre_is_not_a_pin():
    assert K.own_pin(DEFAULT) == {}


def test_absent_is_empty():
    assert K.own_pin("<div>no map</div>") == {}
