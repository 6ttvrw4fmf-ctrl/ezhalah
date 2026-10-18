"""af_score: a wasalt REGA deed border row («ممرات ودرج ومصعد ثم ارتداد») is a legal boundary, not the ad
saying the unit has a lift. 🔬 2026-10-18: all 4 wasalt findability misses asked «elevator» from it
(re-read 39114420405, wasalt_residential_listings:511263) while the seller's description never names one.

Run: python -m pytest scrapers/common/tests/test_af_score_wasalt_deed_borders_are_not_the_ad.py -v
"""
from __future__ import annotations

from scrapers.common import af_score as S


def _page(extra_fields):
    pd = {"propertyInfo": {"description": "<p>Apartment for Sale in Alawaly</p><p>The property has 5 bedrooms</p>"},
          "regaVerifiedInfo": [{"groups": [{"fields": extra_fields}]}]}
    return S.wasalt_page("https://wasalt.sa/en/property/x-1",
                         fetch=lambda _u: ({"props": {"pageProps": {"propertyDetailsV3": pd}}}, 200, 1))


def test_border_row_is_not_read():
    pg = _page([{"key": "borders.southLimitDescription", "label": "Description",
                 "value": " ممرات  و درج  ومصعد ثم ارتداد 2 ثم قطعة رقم 29 / ب / 1"}])
    assert not any("مصعد" in x for x in pg["evidence_lines"])


def test_a_non_border_field_is_still_read():
    pg = _page([{"key": "propertyArea", "label": "Area Size", "value": "311.53"}])
    assert any("311.53" in x for x in pg["evidence_lines"])


def test_amaall_description_bullets_never_build_a_request():
    # amaall's taxonomy is the structured field; «⚫مصعد» typed into the description is prose (law §2).
    lines = ["⚫غرفة غسيل", "⚫مؤثثة", "⚫مصعد", "⚫مطبخ"]
    assert S.says_yes(lines, "elevator", "amaall", {"jsonld": []}) is False
    assert S.says_yes(lines, "kitchen", "amaall", {"jsonld": []}) is False
    assert S.says_yes(lines, "elevator", "someprosesite", {"jsonld": []}) is True
