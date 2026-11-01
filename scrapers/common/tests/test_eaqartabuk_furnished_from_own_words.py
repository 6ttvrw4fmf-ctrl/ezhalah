"""eaqartabuk stores «furnished» from the ad's own words (🔬 AF engineer, 2026-10-16, backlog 552).

The site's feature checklist has no furnished item and the table had no column, so 18 active ads whose text
names their furnishing answered NULL to the Advanced Filter's furnished question. Shapes are verbatim from
the 2026-10-16 replay over every active ad. Fails on the parser before this change (no furnished key at all).
"""
import sys

sys.path.insert(0, ".")

from scrapers.eaqartabuk.run import furnished_answer  # noqa: E402


def test_stated_yes():
    assert furnished_answer("للإيجار | شقة دور أرضي مؤثثة بالكامل – حي البوادي") == {"furnished": True}


def test_stated_no_with_the_article():
    assert furnished_answer("شقه مكونة من غرفة نوم و صالة و مطبخ وحمام الغير مفروش") == {"furnished": False}


def test_partly_furnished_and_floor_covering_and_silence_write_nothing():
    assert furnished_answer("فيلا مفروشه للايجار السنوي الفيلا مفروشه جزئيا") == {}
    assert furnished_answer("مميزات السطح: سطح مفروش نجيلة مظلة") == {}
    assert furnished_answer("فيلا للبيع 5 غرف مطبخ راكب") == {}
    assert furnished_answer(None) == {}
