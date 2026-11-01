"""«تأسيس مصعد» (an elevator SHAFT prepared) is not an elevator (New Listings Engineer, 2026-10-07).

amenities_from_text() already left «مصعد مؤسس» NULL, but only looked AFTER the token, so the prefix
form read as yes: sakan 15854735's page says «* تأسيس مصعد» and was served elevator = yes (Advanced
Filter «مصعد» returned it). Prepared is neither yes nor no: the column stays NULL.

Run: python -m pytest scrapers/common/tests/test_prepared_prefix_is_not_the_fixture_2026_10_07.py -v
"""
import pytest

from scrapers.common.normalize import amenities_from_text


@pytest.mark.parametrize("text,col", [
    ("* تأسيس مصعد", "elevator"),
    ("تاسيس مصعد", "elevator"),
    ("مؤسس مصعد", "elevator"),
    ("تأسيس لمصعد", "elevator"),
    ("تأسيس مكيفات", "air_conditioner"),
    ("مهيأ مصعد", "elevator"),
    ("مصعد مؤسس", "elevator"),           # the suffix form, unchanged
])
def test_prepared_is_null(text, col):
    assert col not in amenities_from_text(text)


@pytest.mark.parametrize("text,col,val", [
    ("مصعد", "elevator", True),
    ("بدون مصعد", "elevator", False),
    ("الدور الأول: مطبخ، مصعد", "elevator", True),
    ("تأسيس مكيفات، مصعد", "elevator", True),   # a prepared fixture in another clause does not leak
])
def test_stated_values_unchanged(text, col, val):
    assert amenities_from_text(text).get(col) is val
