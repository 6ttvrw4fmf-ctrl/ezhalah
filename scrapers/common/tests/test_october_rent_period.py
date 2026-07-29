"""Regression test for scrapers/october/run.py's rent annualization (2026-07-28).

The bug: this scraper had NO period concept at all — every Rent price went straight into
price_annual un-annualized, regardless of the actual billing period. Live-confirmed: ad OCT44471 is
priced 4,000 SAR with the source's own JSON-LD `offers.priceSpecification.unitCode: "MON"` (i.e.
4,000 SAR **per month**), but was stored as price_annual=4,000 — understating the true ~48,000
SAR/year rent by ~12x. This was 100% of october's currently-priced Rent catalog (its only priced
Rent row), not an edge case.

An early draft of the fix had an inverted formula (treating "ANN" as 12 periods/year instead of 1,
which would have 12x'd already-correct annual prices) — caught by these tests before shipping.

Fix: read `offers.priceSpecification.unitCode` from the detail page's JSON-LD and annualize by the
correct periods-per-year for DAY/WEE/MON/ANN. No unit code (or an unrecognized one) leaves the price
unchanged — matches this scraper's pre-existing behavior for the (presumably annual) common case.

Run: python -m pytest scrapers/common/tests/test_october_rent_period.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.october.run import _rent_annualize  # noqa: E402


def test_real_repro_monthly_unit_code():
    # ad OCT44471, live 2026-07-28.
    assert _rent_annualize(4000, "MON") == 48000


def test_annual_unit_code_unchanged():
    assert _rent_annualize(40000, "ANN") == 40000


def test_daily_unit_code():
    assert _rent_annualize(500, "DAY") == 182500


def test_weekly_unit_code():
    assert _rent_annualize(1000, "WEE") == 52000


def test_no_unit_code_leaves_price_unchanged():
    assert _rent_annualize(40000, "") == 40000


def test_unrecognized_unit_code_leaves_price_unchanged():
    assert _rent_annualize(40000, "XYZ") == 40000


def test_none_price_returns_none():
    assert _rent_annualize(None, "MON") is None


if __name__ == "__main__":
    test_real_repro_monthly_unit_code()
    test_annual_unit_code_unchanged()
    test_daily_unit_code()
    test_weekly_unit_code()
    test_no_unit_code_leaves_price_unchanged()
    test_unrecognized_unit_code_leaves_price_unchanged()
    test_none_price_returns_none()
    print("OK — october rent-period regression tests pass")
