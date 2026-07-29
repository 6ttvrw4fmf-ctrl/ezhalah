"""Regression test for scrapers/sadin/run.py's price extraction (2026-07-28).

The bug: ad SDX3ZNP's description reads "المطلوب: 2.600.000 \\n المتر: 4000 ريال" — the real asking
total is 2,600,000 SAR, "4000 ريال" is the per-meter rate. Two independent gaps let the wrong number
through:

1. The labeled-total regex required a trailing "ريال" — "2.600.000" has none (period-grouped, no
   currency word), so it was invisible to every price pattern.
2. `_is_per_meter()` only checked text AFTER a number for a per-meter marker ("...ريال للمتر") — here
   the label ("المتر:") sits BEFORE the number, so the guard never fired and the per-meter rate
   (4,000) was stored as the total price — a 650x understatement.

A third, compounding bug: `_num()` didn't strip periods, so even a correctly-captured "2.600.000"
would have parsed as just "2" (stops at the first non-digit).

Fix: (1) make "ريال" optional for the labeled-total patterns — the label itself is already a strong
price signal; (2) make `_is_per_meter()` check both sides of the number; (3) make `_num()` recognize
period-grouped (and comma-grouped) thousands, mirroring the grouped-digit fix already applied to
aqar's area parser.

Also fixes a stale CSS selector (`class="text"` → `class="property-description"`, the site's current
markup) that would otherwise cause price extraction to silently return None on every fresh crawl.

Run: python -m pytest scrapers/common/tests/test_sadin_price_fidelity.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.sadin.run import _extract_price, _num  # noqa: E402


def test_real_repro_period_grouped_total_no_riyal_suffix():
    # ad SDX3ZNP, live 2026-07-28.
    desc = "شقة جميلة \n المطلوب: 2.600.000 \n المتر: 4000 ريال"
    assert _extract_price(desc) == 2600000


def test_labeled_total_with_riyal_suffix_still_works():
    desc = "أرض للبيع السعر الإجمالي: 2,647,750 ريال والسعر: 4,250 ريال للمتر"
    assert _extract_price(desc) == 2647750


def test_bare_price_fallback_no_competing_per_meter_figure():
    desc = "فيلا فخمة بسعر 950,000 ريال تفاوض بسيط"
    assert _extract_price(desc) == 950000


def test_per_meter_only_label_after_number_stays_none():
    desc = "أرض تجارية السعر 4,000 ريال للمتر"
    assert _extract_price(desc) is None


def test_per_meter_only_label_before_number_stays_none():
    desc = "أرض تجارية سعر المتر: 4,000 ريال بدون سعر اجمالي"
    assert _extract_price(desc) is None


def test_rental_income_figure_skipped_real_price_found():
    desc = "عمارة للبيع العائد السنوي 120,000 ريال والسعر 3,200,000 ريال"
    assert _extract_price(desc) == 3200000


def test_no_description_returns_none():
    assert _extract_price(None) is None
    assert _extract_price("") is None


def test_num_period_grouped_thousands():
    assert _num("2.600.000") == 2600000


def test_num_comma_grouped_thousands_unchanged():
    assert _num("2,647,750") == 2647750


def test_num_plain_decimal_unaffected():
    # Only 1 trailing digit after the period — doesn't match the 3-digit grouped pattern, falls
    # through to the original plain-digit behavior (stops at the decimal point, same as before).
    assert _num("125.5") == 125


if __name__ == "__main__":
    test_real_repro_period_grouped_total_no_riyal_suffix()
    test_labeled_total_with_riyal_suffix_still_works()
    test_bare_price_fallback_no_competing_per_meter_figure()
    test_per_meter_only_label_after_number_stays_none()
    test_per_meter_only_label_before_number_stays_none()
    test_rental_income_figure_skipped_real_price_found()
    test_no_description_returns_none()
    test_num_period_grouped_thousands()
    test_num_comma_grouped_thousands_unchanged()
    test_num_plain_decimal_unaffected()
    print("OK — sadin price-fidelity regression tests pass")
