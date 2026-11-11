"""A dot followed by groups of three digits is the thousands mark in a Haraj seller's price (2026-11-11 launch audit).

HRJ 11188704307 («المطلوب:300.000💸») was stored as a 300 SAR plot: asking_price() read «300.000» as the decimal 300.0.
«1.500» read as 2. With a scale word the dot stays a decimal point: «1.500 مليون» is 1.5 million.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.haraj.prose as P  # noqa: E402  -- the REAL module


@pytest.mark.parametrize("num,scale,want", [
    ("300.000", None, 300_000), ("1.500", None, 1_500), ("1.250.000", None, 1_250_000), ("85.000", None, 85_000),
    ("2.5", "مليون", 2_500_000), ("1.500", "مليون", 1_500_000), ("1.25", None, 1), ("300", None, 300),
    ("300,000", None, 300_000), ("0", None, None),
])
def test_value(num, scale, want):
    assert P._value(num, scale) == want


@pytest.mark.parametrize("text,want", [("السعر 1.250.000 ريال", 1_250_000), ("المطلوب 85.000", 85_000),
                                       ("السعر 2.5 مليون", 2_500_000)])
def test_dotted_prices_are_read_whole_through_asking_price(text, want):
    # CodeRabbit on #11799: the capture itself must take every dotted group, not only the converter
    assert P.asking_price("", text)["price"] == want


def test_the_audit_post_reads_300_thousand():
    out = P.asking_price("", "أرض بضاحية اسكان جليل للبيع مساحــة 450 م المطلـوب:300.000💸 التواصل")
    assert out["price"] == 300_000
