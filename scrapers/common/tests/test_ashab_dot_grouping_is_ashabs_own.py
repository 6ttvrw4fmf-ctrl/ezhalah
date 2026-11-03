"""Ashab's dot-grouped prices are read by ashab itself, not by the shared to_int (backlog 1209).

Ashab prints thousands with DOTS: «الحد 4.500.000 ر.س», «الحد 4.500000 ر.س», «الحد 60.000 ر.س». Other sources
send str(float) «430389.39999999997», where the same single-dot shape is a DECIMAL. PR #4771 makes to_int
read any single dot as a decimal (right for those sources) and so turned ashab's 4.500000 into 4. The
fix: ashab ungroups its own dots before calling to_int. This test runs ashab's _sar under BOTH the
current to_int and #4771's rule, so ashab stays right whichever to_int is live.
"""
import re

import pytest

import scrapers.ashab.run as R
from scrapers.common import normalize

_REAL_TO_INT = normalize.to_int


def _to_int_4771(raw):
    """PR #4771's rule: a single dot is a decimal, except 1-3 digits '.' exactly 3 digits."""
    if raw is None:
        return None
    s = re.sub(r"[^\d.,]", "", str(raw).translate(normalize._TRANS).replace("٬", "").replace("٫", "."))
    s = s.replace(",", "")
    if not re.search(r"\d", s):
        return None
    m = re.match(r"^(\d+)\.(\d+)$", s)
    if m and not re.match(r"^\d{1,3}\.\d{3}$", s):
        return int(m.group(1))
    s = s.replace(".", "")
    return int(s) if s else None


CASES = [
    ("الحد 4.500000 ر.س", 4500000),
    ("الحد 4.500.000 ر.س", 4500000),
    ("الحد 1.250.000 ر.س", 1250000),
    ("الحد 60.000 ر.س", 60000),
    ("الحد 850000 ر.س", 850000),
    ("الحد 20000 ر.س", 20000),
    ("1500.50 ر.س", 1500),               # a 1-2 digit tail is halalas, never grouping
    ("0 ر.س", None),
]


@pytest.mark.parametrize("to_int", [_REAL_TO_INT, _to_int_4771], ids=["to_int-now", "to_int-pr4771"])
@pytest.mark.parametrize("text, want", CASES)
def test_ashab_reads_its_own_dot_grouping(monkeypatch, to_int, text, want):
    monkeypatch.setattr(normalize, "to_int", to_int)
    assert R._sar(text) == want


def test_the_4771_rule_really_breaks_raw_ashab_text():
    """Mutation proof: without ashab's own ungrouping, #4771's rule reads 4.500000 as 4."""
    assert _to_int_4771("4.500000") == 4
    assert _to_int_4771(R._ungroup_dots("4.500000")) == 4500000
