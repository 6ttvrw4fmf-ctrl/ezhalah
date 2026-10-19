"""Rawaf: `parking` is an enum and the XML encoding turns counts into strings — both were read as UNKNOWN.

Measured 2026-09-26 on all 19 available units: parking = OUTSIDE ×7 / UNDERGROUND ×12 (the project page
prints «موقف خارجي» / «موقف قبو»), yet every unit was stored without parking. And /api/deals/<id>
alternates JSON and XML; in XML `ketchin` arrives as "1", which the flag reader dropped.
"""
import pytest

import scrapers.rawaf.run as R


@pytest.mark.parametrize("v, want", [
    (1, True), ("1", True), ("0", None), (0, None),       # a count, JSON int or XML string
    ("true", True), ("false", False), (True, True),
    ("OUTSIDE", None), (None, None),                        # a word is not a flag
])
def test_flag(v, want):
    assert R._flag(v) is want


@pytest.mark.parametrize("kind", ["OUTSIDE", "UNDERGROUND", " underground "])
def test_a_parking_kind_means_the_unit_has_parking(kind):
    assert kind.strip().upper() in R._PARKING_KINDS
