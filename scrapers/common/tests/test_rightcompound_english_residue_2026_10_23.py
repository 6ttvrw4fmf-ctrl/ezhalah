"""rightcompound: «Ishbilia» (الخبر) and «Al Nakhil» (جدة) map to their catalogued Arabic district (2026-10-23).

unknown_named_districts(3) listed both on live rows with no district: le-ruya (khobar) prints neighbourhood
«Ishbilia» ×6, jeddah-view prints «Al Nakhil» ×5, «Al Andalus» (khobar) ×4. loc_catalog_district holds «حي اشبيليا» for الخبر (31) and
«حي النخيل» for جدة (18), «حي الاندلس» for الخبر. «Dariyah» stays unmapped for الرياض: الدرعية is its own town in loc_catalog_city.
"""
from scrapers.rightcompound.run import _DISTRICT_EN_AR, _norm_dist


def test_the_two_names_map_inside_their_own_city():
    assert _DISTRICT_EN_AR.get(("khobar", _norm_dist("Ishbilia"))) == "حي اشبيليا"
    assert _DISTRICT_EN_AR.get(("jeddah", _norm_dist("Al Nakhil"))) == "حي النخيل"
    assert _DISTRICT_EN_AR.get(("khobar", _norm_dist("Al Andalus"))) == "حي الاندلس"


def test_they_do_not_leak_into_another_city():
    assert _DISTRICT_EN_AR.get(("dammam", _norm_dist("Ishbilia"))) is None
    assert _DISTRICT_EN_AR.get(("khobar", _norm_dist("Al Nakhil"))) is None
    assert _DISTRICT_EN_AR.get(("khobar", _norm_dist("Dana Bay"))) is None
    assert _DISTRICT_EN_AR.get(("jubail", _norm_dist("Fanateer Al Jubail"))) is None
