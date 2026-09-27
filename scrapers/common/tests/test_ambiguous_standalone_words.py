"""Hermetic unit tests for scrapers/common/arabic_location.AMBIGUOUS_STANDALONE_WORDS /
is_ambiguous_standalone_word() — the shared, fleet-wide guard for the 2026-09-25 "الشرقية" bug
class (ialqarawi: a Makkah plot and a Khobar plot both matched to an unrelated Asir village of
that literal, obscure catalog name, because a bare directional/age/position adjective was accepted
as a city by a free-text title scan). See that module's own docstring above the constant for the
full incident and why this is a closed linguistic class, not an open-ended list.

Pure/static: no catalog, no network, no monkeypatching — this module's contract does not depend on
loaded state.

Run: python -m pytest scrapers/common/tests/test_ambiguous_standalone_words.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common.arabic_location import (  # noqa: E402
    AMBIGUOUS_STANDALONE_WORDS, is_ambiguous_standalone_word, norm_ar,
)


# ── 1. THE ORIGINAL BUG, EXACTLY ─────────────────────────────────────────────────────────────────
def test_the_exact_word_from_the_makkah_and_khobar_bug_is_caught():
    assert is_ambiguous_standalone_word("الشرقية")
    assert is_ambiguous_standalone_word("الشرقيه")  # ة/ه spelling variant, same word


# ── 2. THE WHOLE CLOSED CLASS, EVERY CONFIRMED CATALOG COLLISION (checked live 2026-09-25) ───────
@pytest.mark.parametrize("word", [
    "الشرقية", "الغربية", "الشمالية", "الجنوبية", "الوسطى",           # direction
    "الجديدة", "الجديد", "الحديثة", "المحدثة", "القديمة",             # age/currency
    "العليا", "العلياء", "السفلى", "الكبرى", "الصغرى",                # relative position
])
def test_every_confirmed_catalog_collision_is_caught(word):
    assert is_ambiguous_standalone_word(word), word


# ── 3. REAL CITIES ARE NEVER FALSE-POSITIVES — the exact cities the original bug misplaced ───────
@pytest.mark.parametrize("real_city", [
    "مكة المكرمة", "الدمام", "الخبر", "الرياض", "جدة", "عنيزة",
    "أبها", "الطائف", "المدينة المنورة", "تبوك", "حائل", "نجران",
])
def test_real_city_names_are_never_flagged(real_city):
    assert not is_ambiguous_standalone_word(real_city), real_city


# ── 4. A COMPOUND PHRASE CONTAINING ONE OF THESE WORDS IS NOT ITSELF FLAGGED — the guard is for a
#    BARE standalone occurrence (the actual free-text-scan candidate), not a substring/contains
#    check; a scraper that accidentally widens this to "contains" would over-block real matches
#    like «حي النوارية الشرقية» (a real, valid multi-word candidate elsewhere in the same scan). ──
def test_only_the_bare_word_is_flagged_not_a_longer_phrase_containing_it():
    assert not is_ambiguous_standalone_word("حي النوارية الشرقية")
    assert not is_ambiguous_standalone_word("المدينة الجديدة")


# ── 5. SAFE ON EMPTY/NULL INPUT — a scraper's candidate can legitimately be blank ─────────────────
@pytest.mark.parametrize("bad", [None, "", "   "])
def test_blank_input_is_never_flagged_and_never_raises(bad):
    assert is_ambiguous_standalone_word(bad) is False


# ── 6. THE CONSTANT ITSELF: every member actually round-trips through is_ambiguous_standalone_word
#    (catches a maintenance slip — e.g. adding a word to the set but the normalizer not covering it)
def test_every_set_member_is_individually_detected():
    for word in AMBIGUOUS_STANDALONE_WORDS:
        assert is_ambiguous_standalone_word(word), word


def test_the_set_is_the_closed_class_not_accidentally_empty_or_huge():
    """A guard that matches nothing is decoration; one that matches almost everything blocks real
    cities. Pins the class to a sane, reviewed size (see the module docstring for the exact list)."""
    assert 15 <= len(AMBIGUOUS_STANDALONE_WORDS) <= 40


# ── 7. MUTATION PROOF: removing a word from the set must be detectable by this suite ─────────────
def test_the_guard_would_actually_fail_if_the_set_lost_its_entry(monkeypatch):
    """Reconstructs the exact original defect shape at the unit level: strip "الشرقية" out of the
    normalized lookup set the same way the pre-fix ialqarawi code had no entry for it at all, and
    confirm detection genuinely flips to False — proving test_the_exact_word_from_the_makkah_
    and_khobar_bug_is_caught is not vacuously true."""
    import scrapers.common.arabic_location as al
    shrunk = {n for n in al._AMBIGUOUS_NORMALIZED if n != norm_ar("الشرقية")}
    monkeypatch.setattr(al, "_AMBIGUOUS_NORMALIZED", shrunk)
    assert not al.is_ambiguous_standalone_word("الشرقية")
