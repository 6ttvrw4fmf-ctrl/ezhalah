"""Prose «furnished» has four outcomes, and three phrasings were read as YES (🔬 AF engineer, 2026-10-16).

eaqartabuk / dealapp ads, verbatim shapes from the 2026-10-16 class scan:
  «… وحمام الغير مفروش»      — «غير» with the article: a stated NO, read YES (eaqartabuk 598341)
  «الفيلا مفروشه جزئيا»       — PARTLY furnished: the yes/no answer cannot state it, read YES
  «سطح مفروش نجيلة مظلة»      — a turf-covered roof, a floor covering, not furniture, read YES (598600)
Each case fails on the reader before this change.
"""
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import normalize


@pytest.mark.parametrize("text, want", [
    ("شقه مكونة من غرفة نوم و صالة و مطبخ وحمام الغير مفروش", False),
    ("الشقة الغير مؤثثة", False),
    ("الفيلا مفروشه جزئيا", None),
    ("نصف مفروشة", None),
    ("semi furnished", None),
    ("سطح مفروش نجيلة مظلة", None),
    ("الدرج مفروش بالرخام", None),
    ("فيلا مفروشه للايجار السنوي الفيلا مفروشه جزئيا موقعها حي الهضيبه", None),
    ("شقة مفروشة\nالمجلس نصف مفروش", None),
])
def test_phrasings_that_are_not_a_yes(text, want):
    assert normalize.amenities_from_lines(text).get("furnished") is want


@pytest.mark.parametrize("text", [
    "للإيجار شقة دور أرضي مؤثثة بالكامل",
    "شقة مفروشه غرفتين وصاله",
    "شقة مفروشة فرش جديد",
    "furnished apartment",
])
def test_a_plain_furnished_is_still_yes(text):
    assert normalize.amenities_from_lines(text).get("furnished") is True


def test_the_article_does_not_turn_a_word_into_a_negator():
    # «الغيرة» is not a negator, and «صغيرة» never was: only the whole word «غير» with ال / و.
    assert normalize.amenities_from_lines("شقة صغيرة مفروشة").get("furnished") is True
