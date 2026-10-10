"""Backlog 312 (owner 2026-10-09): aqar's own map pin is captured from its JSON-LD GeoCoordinates.

Uses the committed real page excerpts: the live ad 6541629 carries geo 24.594493, 46.715077; the
soft-closed page carries none. Out-of-Saudi and 0,0 pins are rejected, never stored.
Run: python -m pytest scrapers/common/tests/test_aqar_source_pin.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqar.enrich_residential import source_pin  # noqa: E402

_TD = Path(__file__).resolve().parents[2] / "aqar" / "testdata"


def _ld(lat, lng):
    return ('<script type="application/ld+json">{"@type":["RealEstateListing"],"offers":{"itemOffered":'
            '{"geo":{"@type":"GeoCoordinates","latitude":%s,"longitude":%s}}}}</script>' % (lat, lng))


def test_live_page_excerpt_pin():
    html = (_TD / "aqar_live_page.excerpt.html").read_text(encoding="utf-8")
    assert source_pin(html) == {"lat": 24.594493, "lng": 46.715077}


def test_soft_closed_page_has_no_pin():
    html = (_TD / "aqar_soft_closed_page.excerpt.html").read_text(encoding="utf-8")
    assert source_pin(html) is None


def test_rejects_zero_and_outside_saudi():
    assert source_pin(_ld(0, 0)) is None
    assert source_pin(_ld(51.5, -0.12)) is None      # London
    assert source_pin(_ld('"x"', 46.7)) is None
    assert source_pin(_ld(21.54, 39.17)) == {"lat": 21.54, "lng": 39.17}  # Jeddah


def test_no_ld_json_is_silent():
    assert source_pin("<html><body>no pin</body></html>") is None
    assert source_pin("") is None


def test_enricher_stores_it_in_source_capture():
    src = (Path(__file__).resolve().parents[2] / "aqar" / "enrich_residential.py").read_text(encoding="utf-8")
    assert 'source_capture["pin"] = pin' in src
