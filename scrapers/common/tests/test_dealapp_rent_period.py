"""Regression test for scrapers/dealapp/run.py's rent-period detection (2026-07-28).

The bug: `rent_period` was hardcoded to "annual" unconditionally for every Rent listing — dealapp
has no structured period field, so a genuinely daily/weekly/monthly rate was stored verbatim into
`price_annual` with no annualization at all.

Live-confirmed: ad DA468049 is priced "500 ريال" on the page, and the page's own visible text reads
"إيجار يومي" (daily rent) — but the DB stored price_annual=500, understating the true annual cost by
~365x. A DB check found 160 active Rent rows with price_annual < 3,000 SAR — implausible for a real
annual residential lease in Saudi Arabia, consistent with the same daily/weekly-rate-stored-as-annual
pattern.

Fix: scan a window around each "إيجار" occurrence in the raw page text for a period word
(يومي/أسبوعي/شهري) and annualize accordingly (×365/×52/×12); default to "annual" (unchanged
behavior) only when no period word is found nearby.

Run: python -m pytest scrapers/common/tests/test_dealapp_rent_period.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import _rent_annualize, _rent_period_window  # noqa: E402


def test_real_repro_daily_rate_annualized():
    # ad DA468049, live 2026-07-28: "500 ريال" + "إيجار يومي قابل للتفاوض" nearby.
    html = "<div>السعر 500 ريال</div><span>إيجار يومي قابل للتفاوض</span>"
    assert _rent_annualize(500, html) == (500 * 365, "monthly")


def test_weekly_rate_annualized():
    html = "<div>1000 ريال</div><span>إيجار أسبوعي</span>"
    assert _rent_annualize(1000, html) == (1000 * 52, "monthly")


def test_monthly_rate_annualized():
    html = "<div>3000 ريال شهري</div><span>إيجار شهري</span>"
    assert _rent_annualize(3000, html) == (3000 * 12, "monthly")


def test_annual_rate_unchanged_default():
    html = "<div>عمارة للإيجار السنوي</div><span>50000 ريال</span>"
    assert _rent_annualize(50000, html) == (50000, "annual")


def test_no_period_word_at_all_defaults_to_annual():
    html = "<div>شقة للإيجار</div><span>80000 ريال</span>"
    assert _rent_annualize(80000, html) == (80000, "annual")


def test_none_price_returns_none_none():
    assert _rent_annualize(None, "<div>إيجار يومي</div>") == (None, None)


def test_period_word_far_from_ijar_does_not_false_positive():
    # A "شهري" mention 40+ chars away from any "إيجار" occurrence (outside the scan window) must
    # not be picked up — avoids an unrelated page element (e.g. a newsletter signup) flipping the period.
    html = "<div>إيجار</div>" + ("x" * 40) + "<span>نشرة شهرية</span><div>50000 ريال سنوي</div>"
    assert _rent_period_window(html) == "annual"


if __name__ == "__main__":
    test_real_repro_daily_rate_annualized()
    test_weekly_rate_annualized()
    test_monthly_rate_annualized()
    test_annual_rate_unchanged_default()
    test_no_period_word_at_all_defaults_to_annual()
    test_none_price_returns_none_none()
    test_period_word_far_from_ijar_does_not_false_positive()
    print("OK — dealapp rent-period regression tests pass")
