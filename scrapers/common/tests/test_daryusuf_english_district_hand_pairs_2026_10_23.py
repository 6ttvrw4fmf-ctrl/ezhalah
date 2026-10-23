"""daryusuf: «Al Ranoonah district» and «Al-Aridh District» (المدينة المنورة) have no unique bridge pair, so 3 + 3
ads stayed district-less (unknown_named_districts(3), 2026-10-23). A two-entry hand table restates them as the
catalogued «حي الرانوناء» / «حي العريض», still confirmed against THIS city's catalogue. Offline."""
from __future__ import annotations

import pytest

from scrapers.daryusuf import run as R

_CITIES = {"المدينة المنورة": (14, 3), "جدة": (18, 2)}
_CATALOG = {14: {"حي الرانوناء", "حي العريض"}, 18: set()}


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: _CITIES.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: t if t and t in _CATALOG.get(cid, set()) else None)
    monkeypatch.setattr(R, "bridge_rows", lambda city_en: ())
    R._bridge_en_ar.cache_clear()


def test_the_two_madinah_names_reach_their_catalogued_district():
    assert R.english_district("Al Ranoonah district", "المدينة المنورة", 14) == "حي الرانوناء"
    assert R.english_district("Al-Aridh District", "المدينة المنورة", 14) == "حي العريض"


def test_another_city_or_an_unknown_name_stays_null():
    assert R.english_district("Al Ranoonah district", "جدة", 18) is None
    assert R.english_district("Al Qiblatain district", "المدينة المنورة", 14) is None
