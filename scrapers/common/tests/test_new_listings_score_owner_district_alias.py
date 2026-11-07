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


# ── A home described floor by floor states no total (same night) ─────────────────────────────────────────────────
def _page(text: str) -> dict:
    return {"title": "", "meta": {}, "evidence_lines": [], "text_head": text, "jsonld": []}


def test_per_floor_room_counts_are_not_a_miss():
    pf = _page("تفاصيل الأدوار تفاصيل الدور الأرضي | عدد المجالس: 1 ، دورات المياه: 3 ، الصالات: 1 ، غرف النوم: 2")
    out = S.compare_listing({"living_rooms": None, "majlis_rooms": None, "bathrooms": None}, pf, skip_price=True)
    assert out["living_rooms"] == S.PAGE_SILENT
    assert out["majlis_rooms"] == S.PAGE_SILENT
    assert out["bathrooms"] == S.PAGE_SILENT


def test_a_whole_home_count_is_still_a_miss_and_a_stored_value_still_judged():
    flat = _page("شقة للبيع | 3 دورات مياه | صالة واسعة")
    assert S.compare_listing({"bathrooms": None}, flat, skip_price=True)["bathrooms"] == S.WE_MISS
    floors = _page("الدور الارضي: مجلس ودورة مياه | الدور الاول : 3 دورات مياه")
    # a value we DO store is judged as before; the per-floor rule never turns a stored mismatch into silence
    assert S.compare_listing({"bathrooms": 7}, floors, skip_price=True)["bathrooms"] != S.PAGE_SILENT
