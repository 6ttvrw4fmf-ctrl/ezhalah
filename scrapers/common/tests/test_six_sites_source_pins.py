"""Owner 2026-10-19: «fix the ones we don't get a pin — every new listing gets the pin».

Six native-preview sites publish the ad's own pin on the page and no scraper read it. Each shape
below is the EXACT text measured on a live ad that day, so the regexes are proven against the real
source, not against a guess; and the wiring tests read each scraper's source to prove the pin is
written into additional_info, the key the index's generic branch reads
(test_source_pins_reach_the_index.py). No network.
Run: python -m pytest scrapers/common/tests/test_six_sites_source_pins.py -q
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scrapers.common.page_pin import (  # noqa: E402
    pin_from_html, pin_from_short_link, resolve_redirect, short_maps_link)

# ── the live shapes ────────────────────────────────────────────────────────────────────────────
NOFODH = ('… "address":{"@type":"PostalAddress"},"geo":{"@type":"GeoCoordinates","latitude":24.728956,'
          '"longitude":46.7436311},"url":"https://www.nofodh.sa/listings/612433" … '
          'selectorMap = new google.maps.Map(document.getElementById("map-selector"), {'
          ' center: { lat: 24.793809, lng: 46.7039 }, // Default location')
ABRALOSOL = '<a href="https://www.google.com/maps/place/25.452943695262,49.606221994409" target="_blank">الموقع</a>'
BOSSBIH = ('<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3605.28!2d49.63198218498713!3d25.361896383819893"></iframe>'
           '<a href="https://www.google.com/maps/place/25.357535239782,49.583245219722">الموقع</a>')
REINVEST_EMBED = '<iframe src="https://www.google.com/maps?q=24.81646,46.632262&amp;z=14&amp;output=embed">'
SAKAN = ('var has_latLng = true; var show_exact_location = true; function myMap() { var gmarkers = []; '
         'var latLng = new google.maps.LatLng(21.621892334251047,39.163360657531236); var mapOptions = {')
SAKAN_APPROX = SAKAN.replace("show_exact_location = true", "show_exact_location = false")
AQALEMHAJER = '<a href="https://maps.app.goo.gl/Qg3j1DUtCWPULM1ZA?g_st=ic">الموقع</a>'
AQALEMHAJER_FINAL = "https://www.google.com/maps?q=25.3152163,49.6193885&entry=gps&shh=CAE"


def test_nofodh_reads_the_jsonld_pin_never_the_default_centre():
    assert pin_from_html(NOFODH) == {"latitude": 24.728956, "longitude": 46.7436311}
    # the default centre alone must yield nothing — it is the same number on every ad
    assert pin_from_html("center: { lat: 24.793809, lng: 46.7039 }, // Default location") == {}


def test_maps_place_links():
    assert pin_from_html(ABRALOSOL) == {"latitude": 25.452943695262, "longitude": 49.606221994409}
    # bossbih: the «الموقع» link wins over the embed's map centre (the regex never reads !2d/!3d)
    assert pin_from_html(BOSSBIH) == {"latitude": 25.357535239782, "longitude": 49.583245219722}
    assert pin_from_html(REINVEST_EMBED) == {"latitude": 24.81646, "longitude": 46.632262}


def test_sakan_marker_only_when_exact():
    assert pin_from_html(SAKAN) == {"latitude": 21.621892334251047, "longitude": 39.163360657531236}
    assert pin_from_html(SAKAN_APPROX) == {}
    # no flag at all → the marker is not trusted either
    assert pin_from_html(SAKAN.replace("var show_exact_location = true; ", "")) == {}


def test_outside_ksa_and_garbage_rejected():
    assert pin_from_html('href="https://www.google.com/maps/place/51.5074,-0.1278"') == {}
    assert pin_from_html('href="https://www.google.com/maps/place/0.0000,0.0000"') == {}
    assert pin_from_html("") == {} and pin_from_html(None) == {}


def test_short_link_is_followed_not_guessed():
    assert short_maps_link(AQALEMHAJER) == "https://maps.app.goo.gl/Qg3j1DUtCWPULM1ZA"
    assert pin_from_short_link(short_maps_link(AQALEMHAJER), lambda u: AQALEMHAJER_FINAL) == {
        "latitude": 25.3152163, "longitude": 49.6193885}
    assert pin_from_short_link(short_maps_link(AQALEMHAJER), lambda u: None) == {}
    assert pin_from_short_link(short_maps_link(AQALEMHAJER), lambda u: (_ for _ in ()).throw(RuntimeError("down"))) == {}
    assert pin_from_short_link(None, lambda u: AQALEMHAJER_FINAL) == {}


class _Resp:
    def __init__(self, status, loc=None):
        self.status_code, self.headers = status, ({"location": loc} if loc else {})


class _Sess:
    def __init__(self, hops):
        self.hops, self.calls = hops, []

    def get(self, url, allow_redirects=False, timeout=20):
        self.calls.append(url)
        return self.hops.get(url, _Resp(200))


def test_resolve_redirect_stops_at_the_maps_url_without_loading_it():
    s = _Sess({"https://maps.app.goo.gl/x": _Resp(302, "https://maps.google.com/?q=25.3152163,49.6193885&x=1"),
               "https://maps.google.com/?q=25.3152163,49.6193885&x=1": _Resp(302, "https://consent.google.com/…")})
    assert resolve_redirect(s, "https://maps.app.goo.gl/x") == "https://maps.google.com/?q=25.3152163,49.6193885&x=1"
    assert s.calls == ["https://maps.app.goo.gl/x"]          # never fetched Maps itself
    assert resolve_redirect(_Sess({}), "https://maps.app.goo.gl/dead") is None


# ── wiring: the pin lands in additional_info in each scraper ──────────────────────────────────
def _src(p: str) -> str:
    return (ROOT / "scrapers" / p / "run.py").read_text(encoding="utf-8")


def test_each_scraper_writes_the_pin_into_additional_info():
    assert 'out["pin"] = pin_from_html(page)' in _src("sakan") and '**(p.get("pin") or {}),' in _src("sakan")
    assert '"pin": pin_from_html(page),' in _src("abralosol") and '**(detail.get("pin") or {}),' in _src("abralosol")
    assert '"pin": pin_from_html(body),' in _src("nofodh") and '**(rec.get("pin") or {}),' in _src("nofodh")
    assert '"pin": pin_from_html(art) or pin_from_html(page_html),' in _src("bossbih") and '**(detail.get("pin") or {}),' in _src("bossbih")
    aq = _src("aqalemhajer")
    assert '"pin_link": short_maps_link(page_html),' in aq and 'pin_from_short_link(d["pin_link"], lambda u: resolve_redirect(s, u))' in aq
    assert '**(detail.get("pin") or {}),' in aq
    assert '**pin_dict(rec.get("latitude"), rec.get("longitude")),' in _src("reinvest")


def test_the_six_sites_are_on_the_border_map_meanwhile():
    data = (ROOT / "src" / "data" / "adPageData.ts").read_text(encoding="utf-8")
    for p in ("sakan", "abralosol", "nofodh", "bossbih", "aqalemhajer", "reinvest"):
        assert f"'{p}'" in data.split("DISTRICT_MAP_PLATFORMS")[1].split("];")[0]
