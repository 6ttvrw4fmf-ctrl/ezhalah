"""A lone catalog namesake in ANOTHER region than the published one is not this place (2026-10-07).

muktamel publishes «بحرة» in «منطقة مكة المكرمة». The catalog's only exact «بحرة» (3504) is in Jazan, and
_pick_candidate() returned a single candidate without checking the region hint, so ~21 listings were
served under منطقة جازان. With a region hint, the city must be inside that region; otherwise unknown.
"""
import pytest

import scrapers.common.arabic_location as al


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {"بحره": [(3504, 10)], "ضمد": [(3402, 10)]})
    monkeypatch.setattr(al, "_REGION_NORM", {"منطقه مكه المكرمه": 2, "منطقه جازان": 10, "جازان": 10})


def test_lone_namesake_in_another_region_is_unknown():
    assert al.to_catalog("بحرة", region_hint=2)[0] is None
    assert al.to_catalog("بحرة", region_hint="منطقة مكة المكرمة")[0] is None


def test_lone_namesake_inside_the_region_still_resolves():
    assert al.to_catalog("ضمد", region_hint=10) == (3402, 10)
    assert al.to_catalog("ضمد", region_hint="منطقة جازان") == (3402, 10)


def test_no_hint_keeps_the_old_single_candidate_answer():
    assert al.to_catalog("بحرة") == (3504, 10)
