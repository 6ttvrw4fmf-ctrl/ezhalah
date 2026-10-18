"""A same-name town is tie-broken by Aqar's OWN city id — and only when the slug alone found no city.

Owner 2026-10-18: 13 active Aqar Monthly ads named a real catalog town in their own slug and still
had no city, so none was production_ready and no search could reach them. الدرب is catalogued in
Asir (1862) AND Jazan (3402); العقيق in four places; the slug names no «منطقة», so resolve_slug()
rightly refused to guess. Every ad also carries Aqar's own city_id, and `AQAR_CITY_REGION` holds the
region each id was measured to sit in. These pin both directions: the hint resolves the twin, and it
never touches a city the slug already resolved (Aqar's ids are not region-pure). No network/DB.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al
from scrapers.aqarmonthly.run import AQAR_CITY_REGION, _resolve_location


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    monkeypatch.setattr(al, "_CITY", {
        "الدرب": [(1862, 6), (3402, 10)],                         # Asir and Jazan twins
        "العقيق": [(2819, 12), (2973, 6), (5730, 2), (15607, 6)],
        "الرياض": [(3, 1)],
        "ابها": [(7, 6)],
    })
    monkeypatch.setattr(al, "_CID_AR", {1862: "الدرب", 3402: "الدرب", 2819: "العقيق", 2973: "العقيق",
                                        5730: "العقيق", 15607: "العقيق", 3: "الرياض", 7: "أبها"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    yield


def test_twin_town_resolves_in_the_region_of_aqars_own_city_id():
    # real ad 761622: «الدرب-الدرب-3716038», Aqar city_id 56 → Jazan
    r = _resolve_location("الدرب-الدرب-3716038", 56)
    assert (r["city_id"], r["region_id"]) == (3402, 10)
    # real ad 762555: «…-العقيق-العقيق-5831971», Aqar city_id 5 → Al-Baha
    r = _resolve_location("شارع-الحارث-بن-يزيد-بن-انيسة-العقيق-العقيق-5831971", "5")
    assert (r["city_id"], r["region_id"]) == (2819, 12)


def test_without_a_known_aqar_id_the_twin_stays_unresolved():
    for aqar_id in (None, "", 0, 99999, "x"):
        assert _resolve_location("الدرب-الدرب-3716038", aqar_id)["city_id"] is None


def test_a_city_the_slug_already_resolved_is_never_overridden():
    # Aqar id 21 is Riyadh-region, yet a slug that names أبها alone keeps أبها.
    r = _resolve_location("حي-المنهل-ابها-6000001", 21)
    assert r["city_id"] == 7


def test_the_hint_never_invents_a_town_outside_its_region():
    # id 21 → Riyadh region; الدرب has no Riyadh twin, so nothing is picked.
    assert _resolve_location("الدرب-الدرب-3716038", 21)["city_id"] is None


def test_the_measured_ids_are_pinned():
    assert AQAR_CITY_REGION[21] == 1 and AQAR_CITY_REGION[56] == 10 and AQAR_CITY_REGION[5] == 12
    assert 40 not in AQAR_CITY_REGION and 96 not in AQAR_CITY_REGION  # split evidence: never a hint
