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
from scrapers.common import db  # noqa: E402
from scrapers.dealapp.run import af_answers  # noqa: E402


def test_real_ad_prose_and_utilities():
    # dealapp_residential_listings:14841728, verbatim shape of its stored text
    got = af_answers({"utilities": "Electricity, Waters, Sanitation"},
                     "🏡 اسنديو مؤثث بالكامل للإيجار الشهري 📍 قريبة من: طريق الجنادرية • مطبخ مجهز • مؤثث بالكامل")
    assert got == {"kitchen": True, "furnished": True, "electricity": True, "water_supply": True, "sanitation": True}


def test_unlisted_utility_is_unknown_not_no():
    got = af_answers({"utilities": "Waters, Sanitation, FixedPhone, FibreOpt"}, None)
    assert "electricity" not in got
    assert got["optical_fibers"] is True and got["water_supply"] is True


def test_stated_no_silence_and_neighbourhood():
    got = af_answers({}, "شقة بدون مصعد، موقف خاص\nقريب من مواقف عامة")
    assert got["elevator"] is False          # a stated no
    assert got["parking"] is True
    assert "kitchen" not in got              # silence stays unknown


def test_furnished_four_outcomes():
    # backlog 386: the residential table carries furnished since 2026-10-12; prose is the only statement
    assert af_answers({}, "شقة مفروشة للايجار مدخل مستقل")["furnished"] is True      # dealapp 5441841
    assert af_answers({}, "شقة غير مفروشة للإيجار السنوي")["furnished"] is False      # dealapp 7175349
    assert "furnished" not in af_answers({}, "شقة 3 غرف وصالة")                        # silence → unknown


def test_commercial_row_never_carries_furnished():
    """dealapp_commercial_listings has no furnished column: writing the key would fail the whole batch."""
    import json
    from scrapers.dealapp.run import map_listing
    schema = {"@type": "RealEstateListing", "name": "مكتب للإيجار", "description": "مكتب مفروش بالكامل",
              "offers": {"price": 50000, "priceCurrency": "SAR", "availability": "https://schema.org/InStock"},
              "itemOffered": {"additionalProperty": [{"name": "propertyType", "value": "Office"}],
                              "address": {}, "geo": {}}}
    state = {"schemaMarkupScripts": {"real-estate-listing-1": json.dumps(schema)}}
    html = f'<html><body><script id="ng-state" type="application/json">{json.dumps(state)}</script></body></html>'
    row, cat, _sold = map_listing(html, "557925")
    if row is not None and cat == "commercial":
        assert "furnished" not in row


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
    # the ad is silent on furnishing → NULL is WRITTEN (sentinel), never False and never a dropped key (2026-11-04)
    assert row["furnished"] is db.AUTHORITATIVE_NULL
    assert row["kitchen"] is True and row["elevator"] is False
    assert row["electricity"] is True and row["water_supply"] is True
    assert "sanitation" not in row           # an unlisted utility stays unknown: no key, nothing written


def test_negator_with_attached_conjunction_is_a_no():
    """dealapp 16155289, verbatim clause: «وغير مؤثثة» is «and NOT furnished». The negator only matched as a
    bare word, so the attached «و» hid it and the shared reader said furnished = YES (🔬 2026-10-12)."""
    got = N.amenities_from_lines("فيلا وليست عمارة سكنية ، وغير مؤثثة ، ويوجد بها مكيفات")
    assert got["furnished"] is False and got["air_conditioner"] is True
    assert N.amenities_from_lines("شقة ولا يوجد مصعد")["elevator"] is False
    assert N.amenities_from_lines("مصعد وغيرها")["elevator"] is True      # «وغيرها» (and others) is no negator


def test_one_reader_2026_11_03():
    """Prose answers come from the Advanced Filter's word reader (owner 2026-11-03, «clear them»)."""
    from scrapers.dealapp.run import af_answers
    lobby = af_answers({}, "شقة للإيجار مداخل مكيفة وكاميرات مراقبة")
    assert "air_conditioner" not in lobby
    flat = af_answers({}, "شقة فيها مكيفات سبليت ومصعد وبلكونة ومطبخ راكب")
    assert flat.get("air_conditioner") is True and flat.get("elevator") is True
    assert flat.get("balcony_terrace") is True and flat.get("kitchen") is True
    assert af_answers({"utilities": "Electricity, Waters"}, "").get("electricity") is True   # structured list kept


def _page(description: str, ptype: str = "شقة") -> str:
    import json
    schema = {"@type": "RealEstateListing", "name": "فيلا للبيع", "description": description,
              "offers": {"price": 900000, "priceCurrency": "SAR", "availability": "https://schema.org/InStock"},
              "itemOffered": {"additionalProperty": [{"name": "propertyType", "value": ptype}],
                              "address": {}, "geo": {}}}
    state = {"schemaMarkupScripts": {"real-estate-listing-1": json.dumps(schema)}}
    return f'<html><body><script id="ng-state" type="application/json">{json.dumps(state)}</script></body></html>'


def test_floor_covering_is_not_furnished_2026_11_04():
    """dealapp 438767 / 598307 / 493432, verbatim clauses: a turf roof, a carpeted room, a grassed yard. The word
    reader skipped the floor-covering guard when the word carried its proclitic («بنجيل», «بالموكيت», «بالعشب»)."""
    for text in ("غرفة سائق بمدخل خارجي * سطح مفروش بنجيل صناعي * ديوانية خلفية",
                 "غرفة النوم مفروشة بالموكيت ويوجد سرير",
                 "حوش كبير مفروش بالعشب ومظلل جزء منه"):
        assert "furnished" not in af_answers({}, text), text
    assert af_answers({}, "شقة مفروشة بالكامل")["furnished"] is True


def test_a_yes_the_reader_now_refuses_is_cleared_on_the_next_crawl():
    """The stored yes must not outlive the reading that produced it: silence is sent as AUTHORITATIVE_NULL so
    db._unknown_must_not_overwrite_known writes the NULL instead of dropping the key (and keeping the old yes)."""
    from scrapers.dealapp.run import map_listing
    row, _cat, _sold = map_listing(_page("فيلا دورين سطح مفروش بنجيل صناعي"), "438767")
    assert row is not None and row["furnished"] is db.AUTHORITATIVE_NULL
    probe = dict(row)
    db._unknown_must_not_overwrite_known(probe)
    assert "furnished" in probe and probe["furnished"] is None       # the NULL reaches PostgREST
    # no description read → nothing written (a failed read never erases)
    row2, _c, _s = map_listing(_page(""), "438768")
    assert row2 is not None and "furnished" not in row2 and "elevator" not in row2
