"""A space is not a letter: a district the source spells with (or without) a space inside a name still maps to that
city's catalogue district (🆕 2026-11-02, contract G — a spelling is MAPPED, never added).

Measured 2026-11-02 07:10 UTC, unknown_named_districts_checked(3): sakani «أبو مرخة» (المدينة المنورة, 3 active ads:
22223810, 22790797, 22223672) had NO district while the catalogue holds «حي ابومرخة» (district 1291). The 2026-10-19
batch mapped the reverse case («أبوكبير» → «حي ابو كبير») one site at a time; this folds the class in the shared
matcher both scrapers' mappers call (find_district_in_text / catalog_district).
Mutation: making _squeezed_key return None turns the two space tests red; the ambiguity and unknown tests stay green.

Run: python -m pytest scrapers/common/tests/test_district_space_is_not_a_letter.py -q
"""
from __future__ import annotations

import pytest

import scrapers.common.arabic_location as L

MADINAH, OTHER = 14, 99
CATALOG = {MADINAH: ["حي ابومرخة", "حي ابو كبير", "حي العزيزية"], OTHER: ["حي ام سليم", "حي امس ليم"]}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(L, "_load", lambda: None)
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {c: {L.norm_district_tok(d) for d in ds} for c, ds in CATALOG.items()})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_NORM", {L.norm_district_tok(d): d for ds in CATALOG.values() for d in ds})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_CITY",
                        {(c, L.norm_district_tok(d)): d for c, ds in CATALOG.items() for d in ds})
    monkeypatch.setattr(L, "_SQUEEZED", {})


def test_spaced_source_maps_to_the_joined_catalogue_name():
    assert L.find_district_in_text("أبو مرخة", MADINAH) == "حي ابومرخة"
    assert L.catalog_district(MADINAH, "أبو مرخة") == "حي ابومرخة"


def test_joined_source_maps_to_the_spaced_catalogue_name():
    assert L.find_district_in_text("أبوكبير", MADINAH) == "حي ابو كبير"
    assert L.catalog_district(MADINAH, "حي أبوكبير") == "حي ابو كبير"


def test_exact_names_unchanged_and_unknown_stays_none():
    assert L.find_district_in_text("العزيزية", MADINAH) == "حي العزيزية"
    assert L.find_district_in_text("أبو شوشة", MADINAH) is None
    assert L.catalog_district(MADINAH, "مرخة") is None


def test_a_squeezed_form_two_names_share_matches_nothing_new():
    # each exact name still wins; the joined «امسليم» could be either one → None, never a pick.
    assert L.catalog_district(OTHER, "ام سليم") == "حي ام سليم"
    assert L.catalog_district(OTHER, "امسليم") is None
    assert L.find_district_in_text("امسليم", OTHER) is None


def test_never_across_cities():
    assert L.catalog_district(OTHER, "أبو مرخة") is None
