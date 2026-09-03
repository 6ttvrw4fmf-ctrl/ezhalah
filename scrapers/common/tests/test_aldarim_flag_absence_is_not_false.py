"""Aldarim feature flags: absence must stay UNKNOWN, a published 0 must stay False.

Found 2026-08-11 by the field-level safety barrier: aldarim carried air_conditioner=false on all
169 active rows with `true` nowhere on the platform. Root cause was `bool(L.get("is_ac_installed"))`
— bool(None) is False, so a listing aldarim said nothing about recorded a confident "no AC".

The trap this test exists to stop is the OVER-correction. Aldarim really does publish the negative:
157 of the 169 rows carry a source "0" and only 12 carry null. Retracting the whole column — the
obvious reading of "false with zero true anywhere" — would have destroyed 157 real source values.
So `_flag` must distinguish the two, and both directions are pinned below.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from scrapers.aldarim.run import _flag


def test_absent_key_is_unknown_not_false():
    assert _flag(None) is None


def test_empty_string_is_unknown():
    assert _flag("") is None


def test_published_zero_is_a_real_negative():
    # 157 active rows depend on this staying False, not None.
    assert _flag(0) is False
    assert _flag("0") is False


def test_published_one_is_true():
    assert _flag(1) is True
    assert _flag("1") is True


def test_flag_can_return_none():
    # Narrowing the return type back to bool is what caused the fabrication in the first place.
    assert _flag(None) is None and _flag(0) is False, "tri-state collapsed to two states"


def test_old_bool_implementation_would_fail_this():
    # The exact defect: bool(None) is False, which is why absence became a denial.
    assert bool(None) is False
    assert _flag(None) is not False


# ── COUNT-backed flags (parking_spots / elevators / maid_rooms / driver_rooms / balconies) ────────
# Found 2026-09-02 by the end-to-end UNKNOWN-safety census: `_flag` fixed the 0/1 keys on
# 2026-08-11, but the count keys kept `(_int(x) or 0) > 0`, which turns a null count into a
# confident "no". Measured on the active inventory: parking_spots null on 8 rows, elevators 8,
# maid_rooms 7, driver_rooms 7 — every one stored `false`.
from scrapers.aldarim.run import _count_flag, map_listing


def test_count_absent_is_unknown_not_false():
    assert _count_flag(None) is None
    assert _count_flag("") is None


def test_count_published_zero_is_a_real_negative():
    assert _count_flag(0) is False
    assert _count_flag("0") is False


def test_count_positive_is_true():
    assert _count_flag(2) is True
    assert _count_flag("1") is True


def test_count_unparseable_is_unknown():
    assert _count_flag("abc") is None


def test_old_count_implementation_would_fail_this():
    # The exact defect: (None or 0) > 0 is False, which is why an unpublished count became a denial.
    assert ((None or 0) > 0) is False
    assert _count_flag(None) is not False


def test_mapping_site_uses_count_flag_for_every_count_backed_key():
    # The helper being correct is not enough — the 2026-08-11 fix left the count keys on the old
    # `(_int(x) or 0) > 0` shape at the mapping site. Pin that every count-backed column is wired
    # through _count_flag, and that the old shape is gone from map_listing.
    src = pathlib.Path(__file__).resolve().parents[2].joinpath("aldarim", "run.py").read_text(encoding="utf-8")
    for key, col in (("parking_spots", "parking"), ("elevators", "elevator"), ("maid_rooms", "maid_room"),
                     ("driver_rooms", "driver_room"), ("balconies", "balcony_terrace")):
        assert f'"{col}":' in src and f'_count_flag(L.get("{key}"))' in src, f"{col} not wired through _count_flag"
        assert f'(_int(L.get("{key}")) or 0) > 0' not in src, f"absence→False count shape is back for {col}"
