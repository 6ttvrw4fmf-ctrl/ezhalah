"""amlakalahsa: the office's type box (pw-typ) never overrides the ad's own section when the title agrees with the
section (2026-11-11). Live: 4 /land/ posts with pw-typ «شقة» and titles «للبيع ارض …» were stored as Apartment;
/home/ AMH19584 «للبيع دبلكس مودرن …» with pw-typ «ارض» was stored as land."""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import scrapers.common.arabic_location as _al  # noqa: E402
# Same catalogue stub as test_wp_acf_listing_types_and_plan_exclusion.py (run.py binds to_catalog at import).
_al.to_catalog = lambda city_ar, region_hint=None: (
    (12, 5) if city_ar == "الهفوف" and region_hint == "المنطقة الشرقية" else (None, None)
)

from scrapers.amlakalahsa.run import map_listing, _type_for_section  # noqa: E402

LAND = json.loads((Path(__file__).parent / "testdata" / "20186.land.json").read_text())


def _post(section, box, title):
    p = copy.deepcopy(LAND)
    p["type"] = section
    p["acf"]["pw-typ"] = box
    p["title"] = {"rendered": title}
    return p


def test_land_post_with_apartment_box_is_land():
    row, cat = map_listing(_post("land", "شقة", "للبيع ارض في حي الرفاع"), {})
    assert row["property_type"] == "Residential Land" and cat == "residential"


def test_home_post_with_land_box_and_duplex_title_is_a_residential_duplex():
    row, cat = map_listing(_post("home", "ارض", "للبيع دبلكس مودرن بالحي الثاني بضاحية هجر"), {})
    assert row["property_type"] == "Duplex" and cat == "residential"


def test_box_inside_section_is_kept_and_a_silent_title_never_guesses():
    assert _type_for_section("Villa", "home", "للبيع شقة") == "Villa"            # box agrees with section
    assert _type_for_section("Apartment", "land", "للبيع في حي الرفاع") == "Apartment"   # title names nothing
    assert _type_for_section("Apartment", "land", "للبيع فيلا") == "Apartment"   # title outside section too
    assert _type_for_section("Apartment", "unknown_section", "للبيع ارض") == "Apartment"


def test_agricultural_land_title_in_land_section_is_farm():                  # CodeRabbit #11800
    assert _type_for_section("Apartment", "land", "للبيع ارض زراعية") == "Farm"


def test_a_later_landmark_never_beats_the_ads_own_type_word():               # CodeRabbit #11800
    assert _type_for_section("Apartment", "land", "للبيع ارض قرب فيلا") == "Residential Land"
    assert _type_for_section("Apartment", "land", "للبيع قطعة أرض تجارية") == "Commercial Land"
    assert _type_for_section("Apartment", "land", "للبيع قطعة أرض تجارية قرب صالة تجارية") == "Commercial Land"


def test_a_two_word_type_whose_first_word_is_not_a_type():                  # CodeRabbit #11800
    assert _type_for_section("Apartment", "shop", "للبيع صالة عرض قرب أرض تجارية") == "Showroom"
