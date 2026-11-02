"""ksaaqar: an ad whose pin halves the site printed SWAPPED is read swapped, never dropped (2026-11-02).

Live 2026-11-02 (map-pins investigation, 30 pin-less ads sampled): two ads printed
`<input id="ad_lat" value="46.799907"/> <input id="ad_lon" value="24.818849"/>` — Riyadh, halves exchanged.
sa_pin() refuses a latitude of 46.8, so the ad showed a district border although the source states a pin.
Inside Saudi Arabia latitude (16–32.5) and longitude (34–56) never overlap, so a pair valid only when
swapped is unambiguous. The site's "not set" centre and an out-of-Kingdom pair stay rejected.

    python -m pytest scrapers/common/tests/test_ksaaqar_swapped_pin_is_read.py -q
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")

import scrapers.ksaaqar.run as KS  # noqa: E402


def _page(lat: str, lon: str) -> str:
    return f'<div><input type="hidden" id="ad_lat" value="{lat}"/><input type="hidden" id="ad_lon" value="{lon}"/></div>'


def test_a_normal_pin_is_read_as_printed():
    assert KS.own_pin(_page("21.60640022963145", "39.23080142587423")) == {"latitude": 21.60640022963145, "longitude": 39.23080142587423}


def test_swapped_halves_are_read_swapped():
    # verbatim from https://ksaaqar.com/ad/29184-2/ on 2026-11-02 (Riyadh, حي اليرموك)
    assert KS.own_pin(_page("46.799907", "24.818849")) == {"latitude": 24.818849, "longitude": 46.799907}
    assert KS.own_pin(_page("46.622681", "24.882888")) == {"latitude": 24.882888, "longitude": 46.622681}


def test_the_sites_not_set_centre_is_still_no_pin():
    assert KS.own_pin(_page("24.633333", "46.716667")) == {}


def test_an_out_of_kingdom_pair_is_still_no_pin_even_swapped():
    # The gate is sa_pin()'s Kingdom box (lat 16–32.5, lng 34–56); a pair outside it either way stays no pin.
    assert KS.own_pin(_page("30.0444", "31.2357")) == {}       # Cairo as printed: lng 31.2 < 34
    assert KS.own_pin(_page("31.2357", "30.0444")) == {}       # Cairo swapped: still outside
    assert KS.own_pin(_page("0.0", "0.0")) == {}


def test_mutation_the_old_reader_dropped_the_swapped_pin():
    # The defect this guards: reading the halves only as printed. Must FAIL the swapped assertion.
    from scrapers.common.source_pin import pin_dict
    la, lo = "46.799907", "24.818849"
    assert pin_dict(la, lo) == {}, "sa_pin must still refuse a 46.8 latitude — the swap is read in own_pin, not by loosening the gate"
