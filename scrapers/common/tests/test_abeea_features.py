"""Abeea feature mapping — the tri-state and concept-boundary rules, locked.

Abeea publishes a grouped feature list per property. Until 2026-08-11 the scraper discarded it
entirely, so all 151 rows carried NULL for air_conditioner / kitchen / parking / maid_room /
driver_room / direction / street_width_m even though the columns exist and listing_extra_attrs
already reads them.

What these tests protect is not "the parser runs" — it is the four ways this mapping could start
lying:
  1. a feature the source did NOT tag becoming `False` instead of NULL (the manufactured-negative
     trap: the block is a positive-only tag list, so "untagged" means the seller was silent),
  2. two different concepts being merged so the columns line up (Smart Entry ≠ private entrance,
     Central Heating ≠ air conditioning),
  3. an ambiguous tag set being resolved by picking one (two facings, two street widths),
  4. a group HEADER term ("Facing", "Street Width") being read as if it carried a value.

Offline and hermetic — no network, no DB.
"""
from __future__ import annotations

import pytest

from scrapers.abeea.run import FEATURE_BOOL, FEATURE_DIRECTION, _feature_fields


def test_tagged_features_map_to_their_columns():
    f = _feature_fields({"air-condition", "open-kitchen", "garage", "maid-room", "laundry"})
    assert f["air_conditioner"] is True
    assert f["kitchen"] is True
    assert f["parking"] is True          # "Garage"
    assert f["maid_room"] is True
    assert f["laundry_room"] is True


def test_untagged_is_absent_not_false():
    """The single most important invariant: silence must reach the DB as NULL.

    A `False` here would tell every downstream filter that abeea's sellers positively declared
    "no lift / no driver room / no private entrance" on listings where they simply said nothing.
    """
    f = _feature_fields({"air-condition"})
    for absent in ("elevator", "driver_room", "private_entrance", "kitchen", "parking"):
        assert absent not in f, f"{absent} was written despite no source tag"
    assert not any(v is False for v in f.values())


def test_empty_tag_set_writes_nothing():
    assert _feature_fields(set()) == {}


@pytest.mark.parametrize("slug,forbidden", [
    ("smart-entry", "private_entrance"),   # a smart LOCK is not a private entrance (مدخل خاص)
    ("central-heating", "air_conditioner"),  # heating is not cooling
])
def test_distinct_concepts_are_never_merged(slug, forbidden):
    f = _feature_fields({slug})
    assert forbidden not in f
    assert f == {}, f"{slug} acquired a mapping it should not have: {f}"


@pytest.mark.parametrize("header", ["facing", "street-width", "services", "air-conditioning",
                                    "appliances"])
def test_group_headers_carry_no_value(header):
    """A few listings are tagged with the group name itself. It names a category without a value,
    so the only thing it can produce is a guess."""
    assert _feature_fields({header}) == {}


def test_single_direction_is_kept_verbatim_for_the_shared_canonicaliser():
    # canon_direction_ar() already accepts these exact English spellings; the scraper must NOT
    # pre-translate, or it would be doing canonicalisation in two places.
    assert _feature_fields({"north"})["direction"] == "North"
    assert _feature_fields({"south-west"})["direction"] == "South West"


def test_ambiguous_direction_and_width_stay_null():
    """A corner plot legitimately carries two facings / two street widths. There is no
    non-arbitrary way to choose, so we choose nothing."""
    assert "direction" not in _feature_fields({"north", "east"})
    assert "street_width_m" not in _feature_fields({"15m", "25m"})
    # a 3-way facing is not one of the eight canonical directions either
    assert "direction" not in _feature_fields({"east-south-west"})


def test_street_width_parses_and_is_bounded():
    assert _feature_fields({"20m"})["street_width_m"] == 20
    assert _feature_fields({"6m"})["street_width_m"] == 6
    assert _feature_fields({"100m"})["street_width_m"] == 100
    assert "street_width_m" not in _feature_fields({"500m"})   # out of range → no guess


def test_every_direction_value_is_one_canon_direction_ar_accepts():
    accepted = {"North", "South", "East", "West",
                "North East", "North West", "South East", "South West"}
    assert set(FEATURE_DIRECTION.values()) <= accepted


def test_mapping_targets_are_real_abeea_columns():
    """Guards the paste-error that would send a value to a column that does not exist — the upsert
    would fail the whole batch, i.e. a silent zero-row run."""
    columns = {
        "electricity", "water_supply", "sanitation", "air_conditioner", "kitchen", "maid_room",
        "driver_room", "parking", "laundry_room", "balcony_terrace", "optical_fibers",
        "elevator", "private_entrance", "car_entrance",
    }
    assert set(FEATURE_BOOL.values()) <= columns
