"""ksaaqar: an area written in brackets is still the area (2026-11-01).

12226358 (Jeddah land) says «المساحه الاجمالية ( 2713) متر مربع» in its own description and was stored with no
area: _AREA_RE allowed «:» «/» «-» between the label and the figure, never a bracket around it. The unit is still
required, so a bracketed number with no unit, or prose about «مساحة», never becomes an area.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.ksaaqar.run import parse_area  # noqa: E402

DESC_12226358 = ("للبيع ارض تجاريه في جدة على ٣شوارع تفتح على طريق الملك عبدالله جنوب البنك الاهلي موقع مميز جدا "
                 "في قلب جدة . المساحه الاجمالية ( 2713) متر مربع المتر (٨) الف قابل للتفاوض")


def test_bracketed_area_12226358():
    assert parse_area(DESC_12226358) == 2713


def test_bracket_variants():
    assert parse_area("المساحة (450 م²)") == 450
    assert parse_area("مساحة الأرض: (١٢٠٠) م2") == 1200


def test_bracket_without_unit_is_not_an_area():
    assert parse_area("المساحة (2713) قابل للتفاوض") is None
    assert parse_area("بمساحة مريحة (3) غرف") is None


def test_old_shapes_unchanged():
    assert parse_area("المساحة: 163.27 متر مربع") == 163
    assert parse_area("مساحة الأرض الإجمالية: 1,200 م²") == 1200
    assert parse_area("المساحة / 620 م") == 620
