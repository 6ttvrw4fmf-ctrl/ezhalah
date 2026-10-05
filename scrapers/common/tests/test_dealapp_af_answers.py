"""dealapp stores its Advanced Filter answers (🔬 AF engineer, 2026-10-05).

15,311 active dealapp listings stored NULL for every amenity and utility. The raw payload (source-reread
run 37290037560) shows dealapp's JSON-LD carries `utilities` structurally and NO amenity field, so:
utilities from the structured list (listed = yes, unlisted = unknown), amenities from the ad's own prose
through the shared four-outcome matcher (yes / stated no / silent / proximity-or-prepared → unknown).

Run: python -m pytest scrapers/common/tests/test_dealapp_af_answers.py -v
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")

from scrapers.common import normalize as N  # noqa: E402
from scrapers.dealapp.run import af_answers  # noqa: E402


def test_real_ad_prose_and_utilities():
    # dealapp_residential_listings:14841728, verbatim shape of its stored text
    got = af_answers({"utilities": "Electricity, Waters, Sanitation"},
                     "🏡 اسنديو مؤثث بالكامل للإيجار الشهري 📍 قريبة من: طريق الجنادرية • مطبخ مجهز • مؤثث بالكامل")
    assert got == {"kitchen": True, "electricity": True, "water_supply": True, "sanitation": True}


def test_unlisted_utility_is_unknown_not_no():
    got = af_answers({"utilities": "Waters, Sanitation, FixedPhone, FibreOpt"}, None)
    assert "electricity" not in got
    assert got["optical_fibers"] is True and got["water_supply"] is True


def test_stated_no_silence_and_neighbourhood():
    got = af_answers({}, "شقة بدون مصعد، موقف خاص\nقريب من مواقف عامة")
    assert got["elevator"] is False          # a stated no
    assert got["parking"] is True
    assert "kitchen" not in got              # silence stays unknown


def test_no_column_dealapp_lacks():
    assert "furnished" not in af_answers({}, "شقة مفروشة")


def test_lines_do_not_leak_a_negation_across_a_break():
    assert N.amenities_from_lines("الشقة غير مؤثثة\nمطبخ مغلق")["kitchen"] is True
    assert "kitchen" not in N.amenities_from_lines("مطبخ\nبدون مطبخ")   # disagreeing lines → unknown


def test_map_listing_carries_the_answers():
    """The wiring, not just the helper: a real-shaped page through map_listing()."""
    import json
    from scrapers.dealapp.run import map_listing
    schema = {"@type": "RealEstateListing", "name": "شقة للبيع", "description": "4 غرف\nمطبخ راكب\nبدون مصعد",
              "offers": {"price": 685000, "priceCurrency": "SAR", "availability": "https://schema.org/InStock"},
              "itemOffered": {"additionalProperty": [{"name": "propertyType", "value": "شقة"},
                                                     {"name": "utilities", "value": "Electricity, Waters"}],
                              "address": {}, "geo": {}}}
    state = {"schemaMarkupScripts": {"real-estate-listing-1": json.dumps(schema)}}
    html = f'<html><body><script id="ng-state" type="application/json">{json.dumps(state)}</script></body></html>'
    row, _cat, _sold = map_listing(html, "557924")
    assert row is not None
    assert row["kitchen"] is True and row["elevator"] is False
    assert row["electricity"] is True and row["water_supply"] is True
    assert "sanitation" not in row
