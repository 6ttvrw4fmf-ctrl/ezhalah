"""Regression test for scrapers/mustqr/run.py's price_type fallback (2026-07-28).

The bug: `is_monthly = (p.get("price_type") == "شهري")` treated any missing/null `price_type` as
annual, storing the raw (un-annualized) figure — even though ~22% of active Rent rows (23/104) have
a null `price_type`. Live-confirmed: both sampled null-price_type rows (MQ4571, MQ4542) are
explicitly monthly per the site's own "الايجار الشهري" label, magnitudes 2,000/2,500 SAR — the DB
understated their true annual cost by ~12x.

Fix: when `price_type` is explicitly "شهري" or "سنوي", trust it. Otherwise fall back to the
magnitude heuristic already established for exactly this ambiguity elsewhere in this codebase
(eaqartabuk/run.py:_price) — a SAR figure under 10,000 is implausible as a real annual lease and is
treated as monthly.

Run: python -m pytest scrapers/common/tests/test_mustqr_price_type_fallback.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.mustqr.run import _price_fields  # noqa: E402


def test_real_repro_null_price_type_small_figure_treated_as_monthly():
    # MQ4571, live 2026-07-28: price_type=None, price=2000, page says "الايجار الشهري".
    assert _price_fields({"price": 2000, "price_type": None}, True) == {
        "price_annual": 24000, "rent_period": "monthly",
    }


def test_explicit_annual_trusted():
    assert _price_fields({"price": 40000, "price_type": "سنوي"}, True) == {
        "price_annual": 40000, "rent_period": "annual",
    }


def test_explicit_monthly_trusted():
    assert _price_fields({"price": 3000, "price_type": "شهري"}, True) == {
        "price_annual": 36000, "rent_period": "monthly",
    }


def test_null_price_type_large_figure_treated_as_annual():
    # A missing price_type with a plausible annual-lease-sized figure keeps the old default.
    assert _price_fields({"price": 40000, "price_type": None}, True) == {
        "price_annual": 40000, "rent_period": "annual",
    }


def test_explicit_annual_trusted_even_for_a_small_figure():
    # Explicit signal always wins over the magnitude heuristic.
    assert _price_fields({"price": 2000, "price_type": "سنوي"}, True) == {
        "price_annual": 2000, "rent_period": "annual",
    }


def test_buy_listing_unaffected():
    assert _price_fields({"price": 500000}, False) == {"price_total": 500000}


def test_price_below_1000_is_KEPT_not_rejected():
    """Inverted 2026-08-09. This used to assert the `n < 1000` rejection; that gate was a
    plausibility judgement on a source-published figure, which the standing PRICE = SOURCE rule
    (2026-08-03) forbids — and it was disproven directly: all 204 live sub-1000 Buy rows were
    fetched from their source pages and 204/204 matched the published price exactly.
    A published price is kept at ANY magnitude; only an ABSENT/zero price yields no fields."""
    assert _price_fields({"price": 500, "price_type": "شهري"}, True) == {
        "price_annual": 500 * 12, "rent_period": "monthly"}
    assert _price_fields({"price": 500}, False) == {"price_total": 500}


def test_absent_or_zero_price_still_yields_nothing():
    assert _price_fields({}, False) == {}
    assert _price_fields({"price": 0}, False) == {}


if __name__ == "__main__":
    test_real_repro_null_price_type_small_figure_treated_as_monthly()
    test_explicit_annual_trusted()
    test_explicit_monthly_trusted()
    test_null_price_type_large_figure_treated_as_annual()
    test_explicit_annual_trusted_even_for_a_small_figure()
    test_buy_listing_unaffected()
    test_price_below_1000_is_KEPT_not_rejected()
    test_absent_or_zero_price_still_yields_nothing()
    print("OK — mustqr price_type fallback regression tests pass")
