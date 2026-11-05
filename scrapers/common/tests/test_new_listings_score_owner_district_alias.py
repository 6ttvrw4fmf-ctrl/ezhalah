"""The scorer honours the owner's «one district» rulings (loc_district_alias) — 🆕 2026-11-05.

The 05:35 score counted akariyoun / raghdan «دور للبيع في حي المعيزيلة» against our «حي المعيزلة» as 8 district
MISMATCHES (both sites capped at 88.2%), although the owner ruled on 2026-10-25 that they are one district and the
index serves the catalogue spelling for every such ad. Executed against the real _cmp_district.
Mutation: removing the alias branch (or loading no aliases) turns the first case back into MISMATCH.

Run: python -m pytest scrapers/common/tests/test_new_listings_score_owner_district_alias.py -q
"""
from __future__ import annotations

import pytest

import scrapers.common.new_listings_score as S


class _Client:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        assert name == "loc_district_alias"
        return self

    def select(self, *_):
        return self

    def execute(self):
        return type("R", (), {"data": self.rows})()


@pytest.fixture(autouse=True)
def _aliases():
    S.load_owner_district_aliases(_Client([{"from_norm": "معيزيله", "to_norm": "معيزله"},
                                           {"from_norm": "ربوه الشرقيه", "to_norm": "ربوه"}]))
    yield
    S.OWNER_DISTRICT_ALIASES.clear()


def test_owner_alias_spelling_on_the_page_is_our_district():
    assert S._cmp_district("حي المعيزلة", S.norm("دور للبيع في حي المعيزيلة")) == S.MATCH
    assert S._cmp_district("حي المعيزلة", S.norm("دور للبيع في المعيزيلة، الرياض")) == S.MATCH


def test_multi_word_alias_is_matched_whole():
    assert S._cmp_district("حي الربوة", S.norm("شقة في حي الربوة الشرقية")) == S.MATCH


def test_a_different_district_is_still_a_mismatch():
    assert S._cmp_district("حي المعيزلة", S.norm("دور للبيع في حي النرجس")) == S.MISMATCH


def test_alias_direction_matters_and_no_aliases_means_letters_only():
    # the alias says the page's «المعيزيلة» is OUR «المعيزلة» — never that any page word maps to anything
    assert S._cmp_district("حي النرجس", S.norm("دور للبيع في حي المعيزيلة")) == S.MISMATCH
    S.OWNER_DISTRICT_ALIASES.clear()
    assert S._cmp_district("حي المعيزلة", S.norm("دور للبيع في حي المعيزيلة")) == S.MISMATCH
