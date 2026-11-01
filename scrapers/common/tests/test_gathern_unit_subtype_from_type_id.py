"""Gathern «نوع الوحدة» (falcon 2026-10-30): when the feed drops event_data.unit_type_ar, the subtype
comes from the site's own unit_type_id label, so the Advanced Filter's استديو / شقق مخدومة / شقة
answers keep their inventory. An unknown id stays unknown."""
import pytest

from scrapers.common.tests.test_gathern_republish_reingestion import _monthly_item
import scrapers.gathern.run as G


@pytest.fixture(autouse=True)
def _stub_location_resolver(monkeypatch):
    monkeypatch.setattr(G.AL, "resolve", lambda *a, **k: {
        "city_ar": "جدة", "city_id": 1, "region_id": 2, "district_ar": "الشاطئ", "confidence": "exact"})


@pytest.mark.parametrize("type_id,label", [(9, "استديو"), (11, "شقق مخدومة"), (6, "شقة")])
def test_subtype_falls_back_to_the_type_id_label_when_the_feed_text_is_missing(type_id, label):
    row = G.map_listing(dict(_monthly_item(), unit_type_id=type_id))
    assert row["additional_info"]["unit_type_ar"] == label


def test_the_feed_text_still_wins_when_present():
    item = dict(_monthly_item(), unit_type_id=6)
    item["event_data"] = dict(item["event_data"], unit_type_ar="استديو")
    assert G.map_listing(item)["additional_info"]["unit_type_ar"] == "استديو"


def test_an_unknown_type_id_never_gets_a_guessed_subtype(monkeypatch):
    monkeypatch.setitem(G.TYPE_MAP, 99, "Apartment")
    row = G.map_listing(dict(_monthly_item(), unit_type_id=99))
    assert "unit_type_ar" not in row["additional_info"]
