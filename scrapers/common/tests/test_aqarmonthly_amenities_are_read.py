"""Aqar Monthly stores Aqar's own structured amenity flags (🔬 AF engineer, 2026-10-05).

Before this, the detail query asked for `furnished` and nothing else, so all 3,675 searchable Aqar
Monthly units stored NULL for elevator / kitchen / AC / parking / maid / driver while their own pages
render «مطبخ · مصعد · مكيف · موقف خاص». A customer who ticked any amenity on a Monthly search never saw
one of them (ops_af_score 2026-10-05: aqarmonthly findability 0/10; source-reread run 37288862098).

Tri-state, through the annual aqar parser's own tables: 1 → True, 0 → False (a published NO), null or
absent → UNKNOWN (never False). And the schema probe is fail-safe: an unknown field never takes the
whole catalogue down with it.

Run: python -m pytest scrapers/common/tests/test_aqarmonthly_amenities_are_read.py -v
"""
from __future__ import annotations

import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import arabic_location as al  # noqa: E402
from scrapers.aqarmonthly import run as R  # noqa: E402


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {"الرياض": [(3, 1)]})
    monkeypatch.setattr(al, "_CID_AR", {3: "الرياض"})
    monkeypatch.setattr(al, "_REGION_NORM", {})
    yield


PRICE = {"discounted_price": "7260", "total_price": None}


def _listing(**extra) -> dict:
    return {"id": 6570974, "uri": "شقة-الرياض-6570974", "area": 122, "category": 101, "imgs": [],
            "address": None, **extra}


def test_published_flags_are_stored_tri_state():
    row = R.map_listing(_listing(lift=1, ketchen=1, ac=1, maid=0, driver=None,
                                 extended_details={"special_parking": True, "laundry_room": None}), PRICE)
    assert row["elevator"] is True
    assert row["kitchen"] is True
    assert row["air_conditioner"] is True
    assert row["parking"] is True                      # extended_details.special_parking («موقف خاص»)
    assert row["maid_room"] is False                   # a published 0 is a real NO
    assert row["driver_room"] is None                  # null is UNKNOWN, never NO
    assert row["laundry_room"] is None


def test_extended_details_sent_as_a_json_string_is_read():
    row = R.map_listing(_listing(extended_details='{"special_parking": false}'), PRICE)
    assert row["parking"] is False


def test_silent_payload_emits_no_amenity_and_never_false():
    row = R.map_listing(_listing(), PRICE)
    for col in R.AMENITY_COLUMNS:
        assert col not in row, f"{col}: an absent key must not be emitted (it would read as a value)"


def test_furnished_is_not_written_to_a_column_the_table_lacks():
    row = R.map_listing(_listing(furnished=1, lift=1), PRICE)
    assert "furnished" not in row


def test_private_entrance_from_either_entrance_flag():
    assert R.map_listing(_listing(special_entrance=0, two_entrances=1), PRICE)["private_entrance"] is True
    assert R.map_listing(_listing(special_entrance=0, two_entrances=0), PRICE)["private_entrance"] is False


def test_detail_query_asks_for_the_flags_once_settled():
    q = R.detail_query(R.AMENITY_GQL_FIELDS)
    for f in ("lift", "ketchen", "ac", "maid", "driver", "extended_details"):
        assert f" {f}" in q
    assert R.detail_query() == R.DETAIL_Q             # () is exactly the old query


def test_settle_keeps_every_field_the_schema_accepts():
    ok = {"data": {"Listing": {"get": {"id": 1}}}}
    assert R.settle_amenity_fields(lambda q: ok) == R.AMENITY_GQL_FIELDS


def test_settle_drops_only_the_field_the_schema_rejects():
    def answer(q: str):
        if " extended_details" in q:
            return {"errors": [{"message": 'Field "extended_details" of type "X" must have a selection of subfields.'}]}
        return {"data": {"Listing": {"get": {"id": 1}}}}
    got = R.settle_amenity_fields(answer)
    assert "extended_details" not in got and "lift" in got and "ketchen" in got


@pytest.mark.parametrize("answer", [
    lambda q: None,                                              # transport failure
    lambda q: {"errors": [{"message": "Internal server error"}]},  # an error naming none of our fields
    lambda q: {"data": {"Listing": {"get": None}}},              # nothing to judge by
])
def test_settle_falls_back_to_the_old_query_when_it_cannot_prove_the_schema(answer):
    assert R.settle_amenity_fields(answer) == ()


# ── one unit is not proof (🔬 2026-10-06): a gone first unit no longer strips a whole shard ──────────
def _units(gone: set):
    asked = []

    def answer_for(q, lid):
        asked.append(lid)
        if lid in gone:
            return {"data": {"Listing": {"get": None}}}      # the first unit of the shard is gone
        return {"data": {"Listing": {"get": {"id": lid}}}}
    return answer_for, asked


def test_a_gone_first_unit_does_not_strip_the_shard():
    answer_for, asked = _units(gone={101})
    got = R.settle_across_units(answer_for, [101, 102, 103])
    assert "lift" in got and "ketchen" in got
    assert asked[0] == 101 and 102 in asked


def test_three_unreadable_units_still_fall_back_to_the_old_query():
    answer_for, asked = _units(gone={1, 2, 3, 4})
    assert R.settle_across_units(answer_for, [1, 2, 3, 4]) == ()
    assert 4 not in asked                                     # bounded: never more than SETTLE_TRIES units


# ── parking from the search result's extended_details (🔬 2026-10-06, backlog 79b) ──────────────────
def test_parking_from_discovery_reaches_the_column(monkeypatch):
    monkeypatch.setattr(R, "_ext_by_id", {7: {"special_parking": True, "laundry_room": None},
                                          8: {"special_parking": False}})
    g7 = R.with_search_extended_details({"id": 7, "lift": 1}, 7)
    assert R.map_amenities(g7)["parking"] is True
    assert R.map_amenities(R.with_search_extended_details({"id": 8}, 8))["parking"] is False
    assert "parking" not in R.map_amenities(R.with_search_extended_details({"id": 9}, 9))  # silent: unknown
    assert R.with_search_extended_details(None, 7) is None


def test_discovery_falls_back_when_the_schema_refuses_the_block(monkeypatch):
    calls = []

    def fake_gql(q, v, tries=3):
        calls.append(q)
        if q is R.FIND_Q_EXT:
            return None, True
        return {"Search": {"find": {"total": 2, "listings": [{"id": 1}, {"id": 2}]}}}, False
    monkeypatch.setattr(R, "_gql", fake_gql)
    d = R.discover_ids()
    assert d.ids == [1, 2] and calls[0] is R.FIND_Q_EXT and R.FIND_Q in calls


def test_discovery_records_each_units_block(monkeypatch):
    monkeypatch.setattr(R, "_ext_by_id", {})

    def fake_gql(q, v, tries=3):
        return {"Search": {"find": {"total": 1, "listings": [
            {"id": 5, "extended_details": {"special_parking": True}}]}}}, False
    monkeypatch.setattr(R, "_gql", fake_gql)
    R.discover_ids()
    assert R._ext_by_id[5] == {"special_parking": True}
