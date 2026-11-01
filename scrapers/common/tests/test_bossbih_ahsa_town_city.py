"""bossbih: an ad that names an Al-Ahsa TOWN as its place is served under that town (backlog #455).

Measured 2026-10-13: 30 active bossbih ads say «… للبيع في حرض», 8 «في البطالية», 4 «في الفضول» …
and every one was booked under the governorate «الاحساء» with no district, so a customer who
searched حرض (where Deal App's 13 حرض ads already live) never found them. Each title below is the
live shape; every assertion runs the SHIPPING `map_listing`.
"""
from __future__ import annotations

import pytest

from scrapers.common.tests import test_bossbih_price_basis_and_traps as T  # noqa: F401  (fixtures)
from scrapers.common.tests.test_bossbih_price_basis_and_traps import mapped, _AHSA_CITY_ID, _EASTERN
from scrapers.bossbih import run as R
import scrapers.common.arabic_location as _al

_HARAD, _JISHAH, _UYUN_ID = 2037, 2746, 2038
_TOWNS = {"حرض": _HARAD, "الجشة": _JISHAH, "العيون": _UYUN_ID, "الحليلة": 2762}


@pytest.fixture(autouse=True)
def _towns(monkeypatch, _seed_catalog):
    def to_catalog(city_ar, region_hint=None):
        if city_ar == R.OFFICE_CITY_AR:
            return _AHSA_CITY_ID, _EASTERN
        return (_TOWNS[city_ar], _EASTERN) if city_ar in _TOWNS else (None, None)
    monkeypatch.setattr(R, "to_catalog", to_catalog)
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _JISHAH, {_al.norm_district_tok("حي البريد")})
    monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok("حي البريد"), "حي البريد")


_seed_catalog = T._seed_catalog


def test_named_town_is_the_city():
    row, _c, why = mapped("بيت للبيع في حرض", price=500000)
    assert row, why
    assert (row["city_ar"], row["city_id"], row["district_ar"]) == ("حرض", _HARAD, None)
    assert row["additional_info"]["city_basis"] == "listing_title_town"


def test_admin_prefix_and_trailing_town():
    row, _c, _w = mapped("أرض للبيع في قرية الحليلة", price=300000)
    assert (row["city_ar"], row["city_id"]) == ("الحليلة", 2762)
    row, _c, _w = mapped("أرض للبيع في البريد بالجشه", price=300000)
    assert (row["city_ar"], row["city_id"], row["district_ar"]) == ("الجشة", _JISHAH, "حي البريد")


def test_district_names_and_unlisted_names_stay_governorate():
    # A catalog Al-Ahsa district wins and the city stays the governorate (docstring §3).
    row, _c, _w = mapped("منزل للبيع في النزهه (335/4) ج", price=500000)
    assert (row["city_ar"], row["district_ar"]) == ("الاحساء", "حي النزهة")
    # «الجابرية» is an المبرز district on abralosol: deliberately NOT a town here.
    row, _c, _w = mapped("بيت للبيع في الجابرية", price=500000)
    assert (row["city_ar"], row["city_id"]) == ("الاحساء", _AHSA_CITY_ID)
    assert row["additional_info"]["city_basis"] == "office_published_city_governorate_grain"
    # A substring is never a town: «شارع حرض» is not the town.
    assert R.town_city("شارع حرض الجديد") == (None, None)


def test_mutation_without_towns_falls_back_to_governorate(monkeypatch):
    # Proves the tests above can fail: with no towns, حرض is booked under الاحساء again.
    monkeypatch.setattr(R, "_AHSA_TOWN_BY_NORM", {})
    row, _c, _w = mapped("بيت للبيع في حرض", price=500000)
    assert row["city_ar"] == "الاحساء"
