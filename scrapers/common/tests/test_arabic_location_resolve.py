"""Hermetic unit tests for scrapers/common/arabic_location.py's `resolve()`/`to_catalog()` — the
single shared resolver every scraper must route location fields through (2026-07-10 architecture
redesign). No network/DB: we monkeypatch the module's loaded-catalog state directly with a small
fake catalog and stub `_load()` to a no-op, so these tests are fast, deterministic, and need no
Supabase credentials.

The fake catalog mirrors the REAL shape found live in production during the 2026-07-10 audit:
  - a clean, globally-unique city (city_id 168 = الارطاوية, region 1 = Riyadh)
  - a twin city ambiguous across two regions with NO district data (region-hint-only case)
  - a twin city ambiguous across two regions where only ONE region's city has district data
    (proves district-based disambiguation narrows correctly and never guesses)
  - two DIFFERENT cities that happen to share an identical district name (the adversarial case:
    proves shared district names across unrelated cities can never cause a wrong resolution,
    because disambiguation only ever operates within the already-ambiguous candidate set for ONE
    city name — a district collision on a city name that ISN'T ambiguous is irrelevant)
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)  # never hit the network
    monkeypatch.setattr(al, "_CITY", {
        "الارطاويه": [(168, 1)],                      # clean, globally unique
        "بيش": [(9001, 6), (9002, 10)],                # twin, no district data at all → region-hint only
        "الباحه": [(1542, 12), (2693, 8)],             # twin, only 1542 has districts → disambiguable
        "طويق": [(9101, 1), (9102, 6)],                # twin sharing an IDENTICAL district name → must stay unresolved
    })
    monkeypatch.setattr(al, "_REGION_NORM", {"منطقه الباحه": 12, "الباحه": 12})
    monkeypatch.setattr(al, "_REGION_AR_FOR", {1: "منطقة الرياض", 6: "منطقة عسير", 8: "منطقة حائل", 10: "منطقة جازان", 12: "منطقة الباحة"})
    monkeypatch.setattr(al, "_CID_AR", {168: "الارطاوية", 9001: "بيش (عسير)", 9002: "بيش (جازان)",
                                       1542: "الباحة", 2693: "الباحة (حائل)", 9101: "طويق (الرياض)", 9102: "طويق (عسير)"})
    monkeypatch.setattr(al, "_DISTRICT_BY_CITY", {
        1542: {"حي الازهر", "حي الروضه"},
        9101: {"حي مشترك"},
        9102: {"حي مشترك"},   # SAME district name as 9101 — the adversarial collision case
    })
    yield


# ── resolve(): the new centralized API ──────────────────────────────────────────────────────────

def test_clean_unique_city_resolves():
    r = al.resolve("الارطاوية")
    assert r == {"city_ar": "الارطاوية", "city_id": 168, "region_id": 1,
                 "region_ar": "منطقة الرياض", "district_ar": None, "district_id": None, "confidence": "city"}


def test_ambiguous_twin_with_no_district_stays_unresolved():
    r = al.resolve("بيش")
    assert r["city_id"] is None
    assert r["confidence"] == "unresolved"


def test_ambiguous_twin_disambiguated_by_matching_district():
    r = al.resolve("الباحه", district_ar="حي الازهر")
    assert r["city_id"] == 1542
    assert r["region_id"] == 12
    assert r["confidence"] == "city+district"


def test_ambiguous_twin_with_nonmatching_district_stays_unresolved():
    r = al.resolve("الباحه", district_ar="حي لا يوجد له اسم في القطاع")
    assert r["city_id"] is None


def test_region_hint_disambiguates_without_needing_district():
    r = al.resolve("الباحه", region_hint=8)  # Hail region → picks 2693, not 1542
    assert r["city_id"] == 2693
    assert r["region_id"] == 8
    assert r["confidence"] == "city"


def test_district_collision_across_unrelated_candidates_never_guesses():
    # Adversarial case: both twin candidates for "طويق" have a district called "حي مشترك". District
    # disambiguation must find TWO matches (not one) and therefore refuse to pick either — proving a
    # coincidental district-name collision can never produce a wrong (or any) resolution.
    r = al.resolve("طويق", district_ar="حي مشترك")
    assert r["city_id"] is None
    assert r["confidence"] in ("unresolved", "region_only")


def test_placeholder_input_is_never_resolved():
    for junk in ("Other", "Unknown", "", None, "N/A"):
        r = al.resolve(junk)
        assert r["city_id"] is None
        assert r["confidence"] == "unresolved"


def test_district_is_ignored_when_district_itself_is_a_placeholder():
    r = al.resolve("الباحه", district_ar="Other")
    assert r["district_ar"] is None  # placeholder district text must not be echoed back either
    assert r["city_id"] is None       # and must not accidentally "match" anything


# ── to_catalog(): pre-existing API, must stay 100% behavior-compatible (6 live callers depend on
# this exact signature and return shape: aqargate/aqarmonthly/aldarim/alhoshan/hajer/sanadak) ─────

def test_to_catalog_unchanged_for_clean_city():
    assert al.to_catalog("الارطاوية") == (168, 1)


def test_to_catalog_unchanged_for_ambiguous_twin_no_hint():
    assert al.to_catalog("بيش") == (None, None)


def test_to_catalog_region_hint_still_works():
    assert al.to_catalog("الباحه", region_hint=8) == (2693, 8)


def test_to_catalog_never_uses_district_disambiguation():
    # to_catalog() takes no district parameter at all — confirms the NEW capability was added
    # additively via resolve(), without changing to_catalog()'s existing contract.
    import inspect
    assert "district" not in inspect.signature(al.to_catalog).parameters
