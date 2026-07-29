"""Regression test for scrapers/aqargate/run.py's rent-period detection (2026-07-28).

The bug: `rent_period` was hardcoded to "annual" unconditionally for every Rent row, even though the
scraper's own `propertyPrice` fallback (used whenever the source's explicit `landTotalAnnualRent`
field is absent) carries no period info of its own — while the WordPress listing title, already
being read for the `title` DB column, frequently states the true period.

Live-confirmed: ad AG51935's title reads "...للإيجار الشهري..." (for monthly rent) with
landTotalAnnualRent=None and propertyPrice=16,000 — the DB stored price_annual=16,000,
rent_period='annual', understating the true annual cost (~192,000) by ~12x. A DB check
(`title ilike '%شهري%' and rent_period='annual'`) found 2 currently-active rows with this exact
signature, confirming it's not a one-off.

Fix: when the source's explicit annual-rate field is absent AND the title contains "شهري", treat
the propertyPrice fallback as monthly and annualize (×12). The explicit annual field, when present,
is always trusted as-is (it's a genuine annual-rate field, not a period-ambiguous fallback).

Run: python -m pytest scrapers/common/tests/test_aqargate_rent_period.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.aqargate.run import _rent_annualize  # noqa: E402


def test_real_repro_monthly_title_no_annual_field():
    # ad AG51935, live 2026-07-28.
    assert _rent_annualize(16000, False, "غرف واجنحة مفروشة للإيجار الشهري بمكة") == (192000, "monthly")


def test_explicit_annual_field_trusted_even_with_no_monthly_word():
    assert _rent_annualize(400000, True, "عمارة للإيجار السنوي") == (400000, "annual")


def test_explicit_annual_field_trusted_even_if_title_happened_to_say_monthly():
    # landTotalAnnualRent is a genuine annual-rate field — never second-guessed by title text.
    assert _rent_annualize(400000, True, "شقة للإيجار الشهري") == (400000, "annual")


def test_no_annual_field_and_no_monthly_word_defaults_to_annual():
    assert _rent_annualize(400000, False, "عمارة للإيجار السنوي") == (400000, "annual")


def test_no_annual_field_no_period_word_at_all_defaults_to_annual():
    assert _rent_annualize(400000, False, "عمارة للإيجار") == (400000, "annual")


def test_none_rent_returns_none_none():
    assert _rent_annualize(None, False, "للإيجار الشهري") == (None, None)


if __name__ == "__main__":
    test_real_repro_monthly_title_no_annual_field()
    test_explicit_annual_field_trusted_even_with_no_monthly_word()
    test_explicit_annual_field_trusted_even_if_title_happened_to_say_monthly()
    test_no_annual_field_and_no_monthly_word_defaults_to_annual()
    test_no_annual_field_no_period_word_at_all_defaults_to_annual()
    test_none_rent_returns_none_none()
    print("OK — aqargate rent-period regression tests pass")
