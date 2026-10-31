"""mustqr: the pin is the Google Maps link the broker pasted into the ad's own text — when there is one
(owner 2026-10-30: 1,340 ads, 0 pins). The API's lat/lng columns are restricted to the office; the page's
JSON-LD «geo» is the office on every ad and is never read. Three outcomes: a link with a pair → the pin;
no link anywhere → pin_absent (the text was read); a short link whose hop failed → neither key.
"""
import scrapers.mustqr.run as m
from scrapers.common.tests.test_mustqr_ad_text_fills_blank_description import BASE_ROW, RAW_4827, _Session

PLACE = "https://www.google.com/maps/place/27.5231,41.6902"


def _extras(row):
    out, _ = m.map_listing(row, {})
    assert out is not None
    return out["additional_info"]


def test_a_maps_link_in_the_description_is_the_pin():
    ai = _extras({**BASE_ROW, "description": f"للبيع ارض بحي السويفله الموقع {PLACE}"})
    assert (ai["latitude"], ai["longitude"]) == (27.5231, 41.6902)
    assert "pin_absent" not in ai


def test_no_link_anywhere_says_pin_absent_and_a_failed_hop_says_nothing(monkeypatch):
    assert _extras({**BASE_ROW, "description": "للبيع ارض بحي السويفله"}).get("pin_absent") is True
    monkeypatch.setattr(m, "pin_from_page", lambda _t: {})          # the goo.gl hop failed this fetch
    ai = _extras({**BASE_ROW, "description": "الموقع https://maps.app.goo.gl/AGkS83s644uTKcNY8"})
    assert "pin_absent" not in ai and "latitude" not in ai


def test_raw_text_body_pin_is_read_before_ad_body_drops_the_link():
    s = _Session(rows=[{"id": 4827, "raw_text": RAW_4827.replace("‏مباشر", f"الموقع {PLACE}\n‏مباشر")}])
    pins = {}
    texts = m.ad_texts(s, "jwt", [4827], pins)
    assert PLACE not in texts[4827]                                  # the stored body still drops the link
    assert pins[4827] == ({"latitude": 27.5231, "longitude": 41.6902}, True)
    ai = _extras({**BASE_ROW, "_ad_pin": pins[4827]})
    assert (ai["latitude"], ai["longitude"]) == (27.5231, 41.6902)
    s2 = _Session(rows=[{"id": 4827, "raw_text": RAW_4827}])
    pins2 = {}
    m.ad_texts(s2, "jwt", [4827], pins2)
    assert pins2[4827] == ({}, False)
    assert _extras({**BASE_ROW, "_ad_pin": pins2[4827]}).get("pin_absent") is True
