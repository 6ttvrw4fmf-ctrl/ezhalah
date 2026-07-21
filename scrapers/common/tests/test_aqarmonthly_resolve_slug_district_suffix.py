"""Regression tests for the district city-name-suffix corruption found live 2026-07-21 (post-deploy
Filter QA sweep, follow-up investigation): `resolve_slug()`'s district capture
(`\\bحي\\s+([؀-ۿ]+(?:\\s+[؀-ۿ]+){0,2})`) grabs "حي" plus up to 3 following Arabic tokens with no stop
condition, so on aqarmonthly's own slug format (district+city, back-to-back, no delimiter — e.g.
`...حي-المهدية-الرياض-5924177`) it swallows the city name (and/or an "امارة"/"منطقة" admin marker) as
trailing "district" tokens. Confirmed live: 988 of 1,471 aqarmonthly search_listings_ar rows (67.2%)
carried a corrupted district_ar, across 32 cities, all production_ready=true, still happening in the
newest ingested batch.

Six real corruption shapes were found live (all explained by "regex grabs 3 tokens, no boundary
check" — token-order differs per how Aqar happened to lay out district/city/امارة/منطقة in that
listing's own slug), reproduced here as regression cases. No network/DB: monkeypatch the module's
loaded-catalog state directly, exactly like test_arabic_location_resolve.py's fixture.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    monkeypatch.setattr(al, "_CITY", {
        "الرياض": [(3, 1)],
        "جده": [(4, 2)],       # note: _CITY keys are norm_ar()'d — ة/ه folded, so "جدة" -> "جده"
        "المحاله": [(5, 6)],   # a city whose name coincidentally equals a real district's own name
    })
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض", 4: "جدة", 5: "المحالة"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    yield


def test_plain_city_suffix_is_stripped():
    # real live example: district_ar came out "حي المهدية الرياض" instead of "حي المهدية"
    r = al.resolve_slug("شارع-محمد-بن-أحمد-الغزوي-حي-المهدية-الرياض-5924177")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي المهدية"


def test_city_plus_region_marker_suffix_is_stripped():
    # real live example: "حي المهدية الرياض منطقة" (district+city+"منطقة", capped at 3 tokens)
    r = al.resolve_slug("حي-المهدية-الرياض-منطقة-الرياض-5839666")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي المهدية"


def test_duplicated_city_name_is_collapsed_not_erased():
    # real live example: "حي المهدية الرياض الرياض" (district+city+region-name, reads as duplicated)
    r = al.resolve_slug("حي-المهدية-الرياض-الرياض-5196392")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي المهدية"


def test_city_plus_emirate_marker_suffix_is_stripped():
    # real live example: "حي الرمال الرياض امارة" (district+city+"امارة")
    r = al.resolve_slug("حي-الرمال-الرياض-امارة-منطقة-الرياض-5510892")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي الرمال"


def test_region_marker_before_city_name_is_stripped():
    # real live example: "حي الربوة منطقة الرياض" (district+"منطقة"+region-name, region-word first)
    r = al.resolve_slug("الرياض-حي-الربوة-منطقة-الرياض-5714262")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي الربوة"


def test_district_name_equal_to_city_name_is_preserved_once_not_erased():
    # real live example: "حي المحالة المحالة امارة" — the district is genuinely named after its own
    # city (المحالة), so after stripping the "امارة" marker and one duplicated city-name occurrence,
    # exactly ONE "المحالة" must remain — never zero.
    r = al.resolve_slug("حي-المحالة-المحالة-امارة-منطقة-عسير-5455838")
    assert r["city_id"] == 5
    assert r["district_ar"] == "حي المحالة"


def test_legitimate_multiword_district_not_ending_in_city_name_is_untouched():
    # a real, non-corrupted 3-word district (no city name or marker as a trailing token) must survive
    # completely unmodified — the fix must never touch a LEADING token.
    r = al.resolve_slug("حي-ام-الحمام-الغربي-الرياض-1234567")
    assert r["city_id"] == 3
    assert r["district_ar"] == "حي ام الحمام الغربي"


def test_short_district_with_no_suffix_to_strip_is_untouched():
    r = al.resolve_slug("حي-الملقا-الرياض-7654321".replace("-الرياض", "", 1))  # no city suffix present at all
    assert r["district_ar"] == "حي الملقا"
