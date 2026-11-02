"""Gathern short stays (owner 2026-10-25): chalets / rest houses / camps are built but stay OUT of search
until the owner says yes — GATHERN_SHORT_STAYS=1 is the only switch. Farm and resort are never guessed."""
import pytest

from scrapers.common.tests.test_gathern_republish_reingestion import _monthly_item
import scrapers.gathern.run as G


@pytest.fixture(autouse=True)
def _stub_location_resolver(monkeypatch):
    monkeypatch.setattr(G.AL, "resolve", lambda *a, **k: {
        "city_ar": "جدة", "city_id": 1, "region_id": 2, "district_ar": "الشاطئ", "confidence": "exact"})


def _item(type_id):
    return dict(_monthly_item(), unit_type_id=type_id)


def test_flag_off_keeps_every_short_stay_type_out(monkeypatch):
    monkeypatch.setattr(G, "SHORT_STAYS", False)
    assert all(G.map_listing(_item(t)) is None for t in (1, 2, 3, 4, 5))
    assert G.map_listing(_item(6))["additional_info"].get("short_stay") is None   # flats unchanged


@pytest.mark.parametrize("type_id,ptype", [(2, "Chalet"), (3, "Rest House"), (5, "Camp")])
def test_flag_on_ingests_chalet_rest_house_camp_marked_as_short_stay(monkeypatch, type_id, ptype):
    monkeypatch.setattr(G, "SHORT_STAYS", True)
    row = G.map_listing(_item(type_id))
    assert (row["property_type"], row["additional_info"]["short_stay"]) == (ptype, True)


def test_farm_and_resort_are_never_guessed_even_with_the_flag(monkeypatch):
    monkeypatch.setattr(G, "SHORT_STAYS", True)
    assert G.map_listing(_item(4)) is None and G.map_listing(_item(1)) is None
