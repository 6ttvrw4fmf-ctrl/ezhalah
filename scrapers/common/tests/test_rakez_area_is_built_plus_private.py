"""rakez: a unit's size is `area` + `private_area`, as its project page prints it (owner ruling 2026-10-16, #541).

Unit 14631: API area 144 + private_area 32 → page «176 م²». The 10-17 08:14 re-score capped rakez at 82.6% on
four units whose stored size was the built part alone.
"""
from scrapers.rakez.run import unit_area


def test_size_is_built_plus_private_area():
    assert unit_area({"area": "144", "private_area": "32"}) == 176
    assert unit_area({"area": "169.42", "private_area": "102.15"}) == 272     # 271.57 → nearest metre


def test_no_private_area_keeps_the_built_size():
    assert unit_area({"area": "144"}) == 144
    assert unit_area({"area": "144", "private_area": ""}) == 144
    assert unit_area({"area": "144", "private_area": "0"}) == 144


def test_no_built_area_is_unknown():
    assert unit_area({"private_area": "32"}) is None
    assert unit_area({"area": "0", "private_area": "32"}) is None
