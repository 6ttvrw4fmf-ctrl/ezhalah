"""normalize.to_int must truncate a decimal with ANY number of fractional digits, not glue them on.

2026-09-27: Earth App's API sends total_price as str(float) — '430389.39999999997'. The old rule only
read 1-2 fractional digits as a decimal, so this fell through to "strip the dots" and became
43,038,939,999,999,997. Every shape below is the value it must parse to.

Run: python3 -m pytest -q scrapers/common/tests/test_to_int_long_decimals.py -p no:cacheprovider
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common.normalize import to_int  # noqa: E402


@pytest.mark.parametrize("raw, want", [
    ("430389.39999999997", 430389),       # the Earth App trigger
    (430389.39999999997, 430389),         # same value as a float
    ("٤٣٠٣٨٩٫٣٩٩٩٩٩٩٩٩٩٧", 430389),      # Arabic-Indic digits + Arabic decimal separator
    ("24829872.186", 24829872),           # 3 decimals on a >3-digit integer is not grouping
    ("1262700.0", 1262700),
    ("263976.5", 263976),
    ("150588.72", 150588),
    ("4,875.77", 4875),
    ("1,262,700.00", 1262700),
    ("١,٤٠٠,٠٠٠", 1400000),
    ("SAR 69,000", 69000),
    # unchanged grouping shapes — scrapers rely on these
    ("1.262.700", 1262700),
    ("123.456", 123456),
    ("550.0K - 830.0K", 55008300),
])
def test_to_int(raw, want):
    assert to_int(raw) == want
