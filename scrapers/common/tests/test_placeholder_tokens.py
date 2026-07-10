"""Hermetic unit tests for the canonical placeholder-token list (2026-07-10 architecture redesign).
No network, no DB, no secrets — pure string logic. Guards the ONE list every other layer
(arabic_location.resolve, db.py's DB-write guard, src/data/remote.ts's frontend guard) must agree
with: this test failing means the three layers have silently drifted apart.
"""
from __future__ import annotations

import pytest

from scrapers.common.placeholder_tokens import PLACEHOLDER_TOKENS, is_placeholder


@pytest.mark.parametrize("value", [
    "Other", "other", "OTHER", "  Other  ",
    "Unknown", "unknown", "N/A", "n/a", "None", "none",
    "null", "NULL", "undefined", "", "   ",
    "غير محدد", "اخرى", "أخرى",
])
def test_known_placeholders_are_caught(value):
    assert is_placeholder(value) is True


@pytest.mark.parametrize("value", [
    "Riyadh", "الرياض", "Jeddah", "جدة", "Al Khobar", "الدرعية",
    "Otherworld",   # substring of a token, but NOT an exact match — must NOT be caught
    "N/A Street",   # a real (if odd) street name containing a token as a substring
    "not a real city but also not a placeholder token",
])
def test_real_values_are_never_caught(value):
    assert is_placeholder(value) is False


@pytest.mark.parametrize("value", [None, 123, 45.6, ["Other"], {"city": "Other"}, True, False])
def test_non_string_input_is_never_a_placeholder(value):
    # None/numbers/collections are not strings, so they're not "placeholder junk" by definition —
    # callers handle absence-of-value via their own None-check, not via is_placeholder().
    assert is_placeholder(value) is False


def test_placeholder_set_is_frozen_and_lowercase_or_arabic():
    # Guards against a future edit accidentally adding a mixed-case English entry that would never
    # match (is_placeholder always lowercases before comparing).
    for tok in PLACEHOLDER_TOKENS:
        if tok.isascii():
            assert tok == tok.lower(), f"{tok!r} must be lowercase in the canonical set"
