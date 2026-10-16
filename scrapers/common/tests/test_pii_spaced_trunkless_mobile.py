"""PDPL, 🦅 Falcon 2026-10-16: a mobile WITHOUT its trunk zero, written in spoken groups «5X XXX XXXX» /
«5X-XXX-XX-XX», was served on 54 aqar + 1 rightcompound descriptions (behind «للتواصل» / «للحجز والاستفسار»,
often wrapped in direction marks). Digits below are invented; the SHAPES are the live ones."""
import pytest

from scrapers.common.pii import redact_pii


@pytest.mark.parametrize("text", [
    "للحجز والاستفسار ‎ 55 123 4567 ـــ",
    "للتواصل: 59-123-45-67",
    "‭58 765 4321‬",
    "٥٥ ١٢٣ ٤٥٦٧ للتواصل",
    "[redacted] 56 111 2222 للتواصل",
])
def test_the_spaced_trunkless_mobile_is_redacted_idempotently(text):
    once = redact_pii(text)
    assert "[redacted]" in once and not any(ch.isdigit() for ch in once.replace("[redacted]", ""))
    assert redact_pii(once) == once


@pytest.mark.parametrize("text", [
    "مستودع 5 120 25 25 25",          # a list of sizes: the wider first try caught this
    "السعر 550 000 000 ريال",         # a price grouped in threes
    "المساحة 55 1234 م",
    "رقم المخطط 54 123",
    "ترخيص 7100261149",
])
def test_numbers_that_are_not_phones_survive(text):
    assert redact_pii(text) == text
