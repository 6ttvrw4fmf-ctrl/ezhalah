"""Regression test for scrapers/fursaghyr/run.py's price_total resolution (2026-07-28).

fursaghyr.com never displays `rea.total_price` anywhere on its own listing pages — only a per-m²
rate. When `total_price` genuinely IS populated, it already matches rate×area (REGA's own payload
pre-computes it), so no code change was needed for that case. But when `total_price` was missing
entirely, the old code left price_total NULL even for a listing with a real, live, displayed price.

Live-confirmed: ad FG26842 (the platform's only active Rent listing at audit time) has
total_price=null and meter_price=55000 — but the live page shows "55000 SAR" as THE price for this
listing, not a per-m² rate (55,000 SAR/m² also fails the existing <50,000 rate-plausibility gate,
consistent with it being a raw total sitting in the wrong field, not a genuine rate).

Owner decision (2026-07-28): when total_price is missing, use rate×area when the rate is plausible
(<50,000, mirroring what REGA's own payload computes when total_price IS present); when the rate is
implausible (>=50,000), treat it as an already-raw total and use it directly, unmultiplied.

Run: python -m pytest scrapers/common/tests/test_fursaghyr_total_price_fallback.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.fursaghyr.run import _resolve_total  # noqa: E402


def test_total_price_present_used_verbatim_unchanged():
    # ad FG24982-shape: total_price already populated, matches meter*area — no change from before.
    assert _resolve_total(369720, 1185, 312) == 369720


def test_real_repro_missing_total_implausible_rate_used_directly():
    # ad FG26842, live 2026-07-28.
    assert _resolve_total(None, 55000, 149) == 55000


def test_missing_total_plausible_rate_multiplied_by_area():
    assert _resolve_total(None, 1185, 312) == 369720


def test_missing_total_no_meter_stays_none():
    assert _resolve_total(None, None, 312) is None


def test_missing_total_plausible_rate_but_no_area_stays_none():
    assert _resolve_total(None, 1185, None) is None


def test_missing_total_implausible_rate_no_area_still_used_directly():
    # The >=50,000 branch doesn't need area since it never multiplies.
    assert _resolve_total(None, 55000, None) == 55000


def test_total_present_zero_meter_and_area_still_used_verbatim():
    assert _resolve_total(0, None, None) == 0


if __name__ == "__main__":
    test_total_price_present_used_verbatim_unchanged()
    test_real_repro_missing_total_implausible_rate_used_directly()
    test_missing_total_plausible_rate_multiplied_by_area()
    test_missing_total_no_meter_stays_none()
    test_missing_total_plausible_rate_but_no_area_stays_none()
    test_missing_total_implausible_rate_no_area_still_used_directly()
    test_total_present_zero_meter_and_area_still_used_verbatim()
    print("OK — fursaghyr total-price fallback regression tests pass")
