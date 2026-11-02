"""arkaan glues «ب + the town» onto its district («الرابية بالهفوف»); the town words go only when what remains is
الهفوف's own catalogue district (🆕 2026-11-02: 55 + 15 served ads under a district no picker offers).
Mutation: returning `hood` unchanged from town_suffix_folded turns test_glued_town_folds_to_the_catalogue red.
"""
import pytest

import scrapers.common.arabic_location as L
import scrapers.arkaan.run as A

HOFUF = 12
CATALOG = ["حي الرابية", "حي الهدا", "حي الدانة"]


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(L, "_load", lambda: None)
    # Two catalogue towns are called «الهفوف» (12 in الشرقية, 501 in الرياض): without the region it is ambiguous
    # and to_catalog answers None — the 08:03 production crawl folded nothing (2026-11-02).
    monkeypatch.setattr(A, "to_catalog",
                        lambda city, region_hint=None: (HOFUF, 5) if city == "الهفوف" and region_hint == 5 else (None, None))
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {HOFUF: {L.norm_district_tok(d) for d in CATALOG}})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_NORM", {L.norm_district_tok(d): d for d in CATALOG})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_CITY", {(HOFUF, L.norm_district_tok(d)): d for d in CATALOG})
    monkeypatch.setattr(L, "_SQUEEZED", {})


def test_glued_town_folds_to_the_catalogue():
    assert A.town_suffix_folded("الرابية بالهفوف") == "حي الرابية"
    assert A.town_suffix_folded("الهدا بالاحساء") == "حي الهدا"
    assert A.town_suffix_folded("الدانة - بالهفوف") == "حي الدانة"


def test_everything_else_is_left_as_published():
    assert A.town_suffix_folded("الرضا بالمبرز") == "الرضا بالمبرز"          # another town: owner's placement
    assert A.town_suffix_folded("مخطط الرياض بالاحساء") == "مخطط الرياض بالاحساء"  # a plan, never a district
    assert A.town_suffix_folded("النخيل بالهفوف") == "النخيل بالهفوف"        # not on الهفوف's list: never a guess
    assert A.town_suffix_folded("الرابية") == "الرابية"
    assert A.town_suffix_folded(None) is None
