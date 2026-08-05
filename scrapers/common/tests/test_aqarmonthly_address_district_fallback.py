"""Regression tests for the `address`-field district fallback added 2026-08-04: aqarmonthly's
DETAIL_Q never requested Aqar's `address` field, so district extraction relied solely on
resolve_slug()'s `\\bحي\\s+` regex over the URI slug — which misses whenever Aqar's own slug omits
the word «حي» (e.g. `...قرطبة-الرياض-6078012`, no «حي» token at all). Aqar's GraphQL
`Listing.get(id).address` is a clean, comma-delimited "[street?, district?, city]" string (confirmed
live: AQM5946944 address="شارع العمرة, الصحافة, الرياض" → page confirms حي الصحافة). ~330 of the 388
live aqarmonthly null-district search_listings_ar rows trace to this exact gap.

`_district_from_address()` (scrapers/aqarmonthly/run.py) is the fallback: only fires when the slug
path found nothing, and — UNLIKE the slug's «حي X» capture, which stores the raw regex match with
NO catalog check — validates the candidate against arabic_location's own loaded `_DISTRICT_BY_CITY`
before ever storing it. No network/DB: monkeypatch the module's loaded-catalog state directly,
exactly like test_aqarmonthly_resolve_slug_district_suffix.py's fixture.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al
from scrapers.aqarmonthly.run import _district_from_address


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    # _DISTRICT_BY_CITY stores district_norm (normalize_ar()'d — ة→ه folded), exactly like the real
    # loc_catalog_district table, e.g. real row: district_ar="حي الصحافة" / district_norm="حي الصحافه".
    monkeypatch.setattr(al, "_DISTRICT_BY_CITY", {
        3: {"حي الصحافه", "حي قرطبه"},    # الرياض
        18: {"حي الفردوس"},               # جدة
        99: {"حي حلباء"},                 # a 2-segment-address city (street segment omitted)
    })
    yield


def test_three_segment_address_resolves_catalogued_district():
    # real live example: AQM5946944 "شارع العمرة, الصحافة, الرياض"
    r = _district_from_address("شارع العمرة, الصحافة, الرياض", 3)
    assert r == "حي الصحافة"


def test_district_already_prefixed_in_source_matches_directly():
    r = _district_from_address("مكتب تأجير, حي الفردوس, جدة", 18)
    assert r == "حي الفردوس"


def test_district_equal_to_city_stays_null():
    # source has no real district (street/city shape only) — honest null, matches the gathern
    # district==own-city policy, never invents a district equal to the city itself.
    r = _district_from_address("الرياض, الرياض", 3)
    assert r is None


def test_uncatalogued_candidate_stays_null_never_guessed():
    r = _district_from_address("شارع كذا, حي غير موجود في الفهرس, الرياض", 3)
    assert r is None


def test_two_segment_address_still_resolves():
    r = _district_from_address("حلباء ، النماص", 99)  # Arabic comma (٬٬٬ ،) + spaces
    assert r == "حي حلباء"


def test_single_segment_address_has_no_district():
    r = _district_from_address("الاحساء", 46)
    assert r is None


def test_none_address_or_city_id_stays_null():
    assert _district_from_address(None, 3) is None
    assert _district_from_address("شارع, حي الصحافة, الرياض", None) is None


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
