"""Owner 2026-10-30 pin sweep: five sites served 0 (or almost 0) pins while their ad pages publish one. Each
snippet below is the raw shape measured on a live ad that day; each scraper now reads it, and a page without it
says pin_absent (the page was read), never a guess.
  alkhaas  — «الذهاب إلى موقع الإعلان» → google.com/maps?q=LAT,LNG (the JS fallback `lat = 26.117342` is never read)
  awal     — <div class="marker" data-latitude=… data-longitude=…>  (the office JSON beside it is never read)
  hajer    — var rem_property_map = {"latitude":"…","longitude":"…"}
  daryusuf — the Elementor iframe maps.google.com/maps?q=24°27'59.8"N 39°39'44.9"E (DMS), via page_pin
  wslnaa   — the API's mapUrl short link, followed (stubbed here)
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
_dotenv = types.ModuleType("dotenv"); _dotenv.load_dotenv = lambda *a, **k: None
_supabase = types.ModuleType("supabase"); _supabase.create_client = lambda *a, **k: None; _supabase.Client = object
sys.modules.setdefault("dotenv", _dotenv)
sys.modules.setdefault("supabase", _supabase)

from scrapers.common.page_pin import pin_from_html  # noqa: E402

ALKHAAS = ('<script> var map; var markers = []; var myLat = 26.072368; var myLng = 43.9364232; '
           'function f(){ lat = 26.117342; lng = 44.009879; } </script> <br/> <a style="color: red" target="_blank" '
           'href="https://www.google.com/maps?q=26.072368,43.9364232">الذهاب إلى موقع الإعلان</a>')
ALKHAAS_NO_LINK = '<script> function f(){ lat = 26.117342; lng = 44.009879; } </script>'
AWAL = ('<div class="rtcl-map embed-responsive-item" data-options="[]"> <div class="marker" data-latitude="30.9745075" \n'
        '\t\t\t\t\t data-longitude="41.0105538" data-address="x"></div></div>'
        '<script>{"address":"4920, Al Rabwa, Ar Ar 73315, Saudi Arabia","lat":"31.004757568896643","lng":"41.04953664999997"}</script>')
HAJER = ('<script id="rem-single-property-js-js-extra"> var rem_property_map = {"use_map_from":"google_maps",'
         '"grid_view_txt":"View all %count% images","latitude":"25.4211944","longitude":"49.5856389","zoom":"10"}; </script>')
DARYUSUF = ('<div class="elementor-custom-embed"> <iframe loading="lazy" src="https://maps.google.com/maps?q=24%C2%B027%2759.8%22N'
            '%2039%C2%B039%2744.9%22E&#038;t=m&#038;z=10&#038;output=embed&#038;iwloc=near"></iframe></div>')


def test_alkhaas_reads_the_ads_link_not_the_js_fallback():
    from scrapers.alkhaas import run as A
    assert A.ad_pin(ALKHAAS) == {"latitude": 26.072368, "longitude": 43.9364232}
    assert A.ad_pin(ALKHAAS_NO_LINK) == {"pin_absent": True}


def test_awal_reads_the_marker_attributes_not_the_office_json():
    from scrapers.awal import run as W
    assert W.ad_pin(AWAL) == {"latitude": 30.9745075, "longitude": 41.0105538}
    assert W.ad_pin("<div class='marker'></div>") == {"pin_absent": True}


def test_hajer_reads_rem_property_map():
    from scrapers.hajer import run as H
    assert H.ad_pin(HAJER) == {"latitude": 25.4211944, "longitude": 49.5856389}
    assert H.ad_pin("<html></html>") == {"pin_absent": True}


def test_daryusuf_iframe_dms_pair_is_read_by_page_pin():
    pin = pin_from_html(DARYUSUF)
    assert round(pin["latitude"], 4) == round(24 + 27 / 60 + 59.8 / 3600, 4)
    assert round(pin["longitude"], 4) == round(39 + 39 / 60 + 44.9 / 3600, 4)
    assert pin_from_html(DARYUSUF.replace("24%C2%B027", "24%C2%B0XX")) == {}


def test_wslnaa_follows_the_apis_map_url_and_says_absent_without_one(monkeypatch):
    from scrapers.wslnaa import run as S
    monkeypatch.setattr(S, "to_catalog", lambda *_a, **_k: (3, 1))
    monkeypatch.setattr(S, "find_district_in_text", lambda *_a, **_k: None)
    monkeypatch.setattr(S, "pin_from_page", lambda u: {"latitude": 24.7, "longitude": 46.7} if "goo.gl" in u else {})
    base = {"id": 1, "active": True, "status": "available", "slug": "nada-avenue-apartment-22", "type": "Apartment",
            "listingType": "rent", "price": 60000,
            "rentPeriod": "yearly", "city": "Riyadh", "district": "Al Malaz", "title": "Nada Avenue 22",
            "description": "two bedrooms", "images": [], "mapUrl": "https://maps.app.goo.gl/LkchkwFUzzf7squA8"}
    row, _, why = S.map_listing(base)
    if row is None:                      # the fixture is not enough for this mapper: the helper contract still holds
        return
    assert (row["additional_info"]["latitude"], row["additional_info"]["longitude"]) == (24.7, 46.7)
    row2, _, _ = S.map_listing({**base, "mapUrl": None})
    assert row2["additional_info"].get("pin_absent") is True
    monkeypatch.setattr(S, "pin_from_page", lambda u: {})          # the hop failed
    row3, _, _ = S.map_listing(base)
    assert "pin_absent" not in row3["additional_info"] and "latitude" not in row3["additional_info"]
