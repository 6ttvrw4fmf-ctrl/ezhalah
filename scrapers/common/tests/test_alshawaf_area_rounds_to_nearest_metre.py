"""alshawaf: a decimal «المساحة» is stored as its NEAREST whole metre, never truncated (🆕 2026-11-09).

25868057 «507.63م» was stored 507 and 25868148 «362.5م» 362 (detail_fields, branch re-score 42580392761): the
scraper read the area through N.to_int, which truncates a halala fraction. Fleet rule: round (tuba `_area`, #123)."""
from scrapers.alshawaf.run import area_whole_metres


def test_decimal_areas_round_half_up():
    assert area_whole_metres("507.63م") == 508
    assert area_whole_metres("362.5م") == 363
    assert area_whole_metres("362.4م") == 362


def test_whole_and_grouped_areas_are_unchanged():
    assert area_whole_metres("587م") == 587
    assert area_whole_metres("1,250م") == 1250
    assert area_whole_metres("٣٦٢٫٥م") == 363


def test_no_number_is_none():
    assert area_whole_metres(None) is None
    assert area_whole_metres("") is None
    assert area_whole_metres("0م") is None
