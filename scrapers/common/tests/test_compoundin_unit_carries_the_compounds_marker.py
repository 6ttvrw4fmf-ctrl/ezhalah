"""compoundin: every unit carries its compound's own Leaflet marker (owner 2026-10-30: 286 ads, 0 pins).

The compound page draws one marker from an inline script, `cinMapMarkers = [{marker: {…, position: {lat, lng}}}]`
(measured on azure-al-reem 24.8397,46.7507 · satel-at-opal · salwa-garden-village). A page with no marker says
pin_absent; a marker outside Saudi Arabia is no pin (source_pin.sa_pin).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
# The sibling stubs supabase/dotenv and keeps the REAL scrapers.common.db module (its prune test patches db.*);
# importing it first means this file never replaces db with an empty stub that would break it in the same session.
import scrapers.common.tests.test_compoundin_card_fields_stay_in_their_card_and_prune_asks_the_page  # noqa: E402,F401
from scrapers.compoundin import run as C  # noqa: E402

MARKER = ('<script> var cinMapMarkers = [ {marker: {map: null, icon: "", position: {lat: 24.839727054602537, '
          'lng: 46.75069381265134}}, title: "Azure Al Reem"} ]; </script>')
CAIRO = MARKER.replace("24.839727054602537", "30.0443").replace("46.75069381265134", "31.2357")


def test_the_pages_own_marker_is_read_and_a_foreign_one_is_not():
    assert C.compound_pin(MARKER) == {"latitude": 24.839727054602537, "longitude": 46.75069381265134}
    assert C.compound_pin(CAIRO) == {}
    assert C.compound_pin("<html>no map</html>") == {} and C.compound_pin("") == {}


def test_every_unit_row_carries_the_compound_pin_or_says_absent(monkeypatch):
    monkeypatch.setattr(C, "to_catalog", lambda name: (3, 1))
    monkeypatch.setattr(C, "find_district_in_text", lambda *_a, **_k: None)
    monkeypatch.setattr(C, "_bridge_en_ar", lambda _city: {})     # never fill the real lru_cache from a stub world
    card = ('<article class="cin-unit-card"><h3 class="cin-unit-card__title">Apartment</h3>'
            '<p class="cin-compound-card__specs">2 Bedrooms 2 Bathrooms 97 sqm</p>'
            '<span class="cin-compound-card__amount-value">95,000</span>'
            '<button data-cin-contact-unit="485"></button></article>')
    html = f"<html><h1>Azure Al Reem</h1>{MARKER}{card}</html>"
    rows, why = C.map_units("https://compoundin.com/compounds/riyadh/azure-al-reem", html)
    assert rows, why
    ai = rows[0]["additional_info"]
    assert (ai["latitude"], ai["longitude"], ai["pin_scope"]) == (24.839727054602537, 46.75069381265134, "compound")
    assert "pin_absent" not in ai
    rows, _ = C.map_units("https://compoundin.com/compounds/riyadh/azure-al-reem", f"<html><h1>X</h1>{card}</html>")
    ai = rows[0]["additional_info"]
    assert ai.get("pin_absent") is True and "latitude" not in ai
