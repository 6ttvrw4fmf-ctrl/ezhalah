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
