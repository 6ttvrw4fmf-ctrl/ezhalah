"""rightcompound: «Umm Al-Hamam Al-Gharbi» (الرياض) maps to the catalogued WEST half (🆕 2026-11-10).

unknown_named_districts(3) listed it on 3 live Riyadh ads with no district. loc_catalog_district holds both halves for
city 3: «حي ام الحمام الغربي» (district_id 12) and «حي ام الحمام الشرقي» (8). A bare «Umm Al Hamam» names neither half.
"""
from scrapers.rightcompound.run import _DISTRICT_EN_AR, _name_and_tails, _norm_dist


def _lookup(city, name):
    for key in _name_and_tails(name):
        if (city, key) in _DISTRICT_EN_AR:
            return _DISTRICT_EN_AR[(city, key)]
    return None


def test_the_west_half_maps_to_the_west_half():
    assert _lookup("riyadh", "Umm Al-Hamam Al-Gharbi") == "حي ام الحمام الغربي"
    assert _lookup("riyadh", "Umm Al Hamam Al Gharbi District") == "حي ام الحمام الغربي"


def test_the_east_half_maps_to_the_east_half():
    assert _lookup("riyadh", "Umm Al-Hamam Al-Sharqi") == "حي ام الحمام الشرقي"


def test_not_outside_riyadh():
    assert _lookup("jeddah", "Umm Al-Hamam Al-Gharbi") is None


def test_a_bare_name_never_picks_a_half():
    assert _lookup("riyadh", "Umm Al Hamam") not in ("حي ام الحمام الغربي", "حي ام الحمام الشرقي")
