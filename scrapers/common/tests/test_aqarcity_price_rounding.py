"""Regression test for scrapers/aqarcity/run.py's price rounding (2026-07-28).

The bug: ad AC29489's JSON-LD `offers.price` is 380021.85. aqarcity's own price badge on the live
page rounds this to "380,022" — but the shared `normalize.to_int()` (used via the local `_int()`
wrapper) deliberately TRUNCATES fractional prices (a documented, intentional choice for DealApp's
own floor-display convention), so the DB stored 380,021 — 1 SAR less than what the source shows.

Fix: a local `_price_round()` that rounds instead of truncates, used ONLY for aqarcity's price
field. The shared `normalize.to_int()` is untouched — it's relied on elsewhere (including by other
platforms) for its documented truncating behavior.

Run: python -m pytest scrapers/common/tests/test_aqarcity_price_rounding.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.aqarcity.run import _price_round  # noqa: E402


def test_real_repro_fractional_price_rounds_up():
    # ad AC29489, live 2026-07-28.
    assert _price_round(380021.85) == 380022


def test_fractional_price_rounds_down_when_below_half():
    assert _price_round(380021.30) == 380021


def test_plain_int_unaffected():
    assert _price_round(750000) == 750000


def test_plain_float_with_no_fraction_unaffected():
    assert _price_round(42000.0) == 42000


def test_formatted_string_falls_back_to_int_parse():
    assert _price_round("SAR 69,000") == 69000


def test_none_returns_none():
    assert _price_round(None) is None


if __name__ == "__main__":
    test_real_repro_fractional_price_rounds_up()
    test_fractional_price_rounds_down_when_below_half()
    test_plain_int_unaffected()
    test_plain_float_with_no_fraction_unaffected()
    test_formatted_string_falls_back_to_int_parse()
    test_none_returns_none()
    print("OK — aqarcity price-rounding regression tests pass")
