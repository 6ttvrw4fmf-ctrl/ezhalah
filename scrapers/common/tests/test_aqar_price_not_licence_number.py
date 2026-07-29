"""aqar Buy price must never capture a REGA advertisement licence number (audit 2026-07-28).

The page prints the licence as

    ... رقم الإعلان 6631224 نسخ رخصة الإعلان 7100267943 رابط رخصة الإعلان ...

and the Buy fallback pattern `(\\d{6,9})\\s*[§ر﷼]` had the bare Arabic letter «ر» in its currency
class, so it matched the licence's last 9 digits against the ر of the FOLLOWING word «رابط» and
stored 100267943 as the price. 303 live rows landed in [100,000,000-101,000,000) that way — a
128 m² Jeddah apartment listed at 100.2 million SAR — and price_per_meter was derived from it
(783,343 = 100,267,943 / 128), so the corruption propagated.

The two comma-grouped patterns keep «ر» (a grouped number followed by «ريال» is a real price and an
identifier can never match them). Only the ungrouped 6-9 digit pattern requires a true currency
SYMBOL. The strings below are taken from the actual stored source_capture of live rows.

    python3 -m pytest scrapers/common/tests/test_aqar_price_not_licence_number.py
"""
from __future__ import annotations

import re

# The exact pattern tuple shipped in scrapers/aqar/enrich_residential.py (Buy branch).
BUY_PATTERNS = (
    r"(\d{1,3}(?:,\d{3}){2,3})\s*[§ر﷼]",
    r"(\d{1,3}(?:,\d{3}){1,3})\s*[§ر﷼]",
    r"(\d{6,9})\s*[§﷼]",
)
# What it used to be — kept so the test proves the bug was REAL, not hypothetical.
BUY_PATTERNS_BEFORE = (
    r"(\d{1,3}(?:,\d{3}){2,3})\s*[§ر﷼]",
    r"(\d{1,3}(?:,\d{3}){1,3})\s*[§ر﷼]",
    r"(\d{6,9})\s*[§ر﷼]",
)

# Real capture text (aqar ad 6631224, listing_id 15593 — stored price was 100267943).
LICENCE_TEXT = (
    "الموقع رقم الإعلان 6631224 نسخ رخصة الإعلان 7100267943 رابط رخصة الإعلان الرابط مصدر الإعلان"
)


def _first_price(text: str, patterns) -> int | None:
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            v = int(m.group(1).replace(",", ""))
            if v >= 50_000:
                return v
    return None


def test_licence_number_is_not_a_price():
    """The shipped patterns must find NO price in licence-only text."""
    assert _first_price(LICENCE_TEXT, BUY_PATTERNS) is None


def test_the_bug_was_real():
    """Negative control: the OLD patterns really did return the licence tail as a price.

    Without this, a future refactor could 'pass' the test above by breaking price parsing entirely.
    """
    assert _first_price(LICENCE_TEXT, BUY_PATTERNS_BEFORE) == 100267943


def test_genuine_prices_still_parse():
    """The fix must not cost us any real price format aqar publishes."""
    cases = [
        ("السعر 1,200,000 §", 1_200_000),      # comma-grouped, symbol
        ("السعر 299,000 §", 299_000),          # comma-grouped, symbol
        ("السعر 1200000 §", 1_200_000),        # ungrouped, symbol — still works
        ("السعر 2,500,000 ريال", 2_500_000),   # comma-grouped + «ريال» (starts with ر) — kept
        ("السعر 850,000 ﷼", 850_000),          # comma-grouped, riyal sign
    ]
    for text, expected in cases:
        assert _first_price(text, BUY_PATTERNS) == expected, text


def test_per_meter_and_small_numbers_still_rejected():
    """The >= 50,000 floor still rules out per-meter figures sitting next to a currency mark."""
    assert _first_price("سعر المتر 1,200 §", BUY_PATTERNS) is None


if __name__ == "__main__":
    test_licence_number_is_not_a_price()
    test_the_bug_was_real()
    test_genuine_prices_still_parse()
    test_per_meter_and_small_numbers_still_rejected()
    print("✓ aqar Buy price never captures a REGA licence number; genuine formats still parse")
