"""Regression test for aqarcity's rent-period classifier (2026-07-14).

Guards a double-annualization bug: an ANNUAL lease described with a monthly PAYMENT-INSTALLMENT
figure (e.g. "الايجار الشهري :3000ريال ... السنوي: دفعة 38,000") was misclassified rent_period=
'monthly' by a bare شهري keyword match. Combined with the price-fidelity fix (PR #68) that
annualizes genuinely-monthly rents (×12), this double-annualized an ALREADY-annual offers.price,
inflating the stored price ×144 vs the true rent (proven live: aqarcity ids 2292823/593790/593771).

Run: python -m pytest scrapers/common/tests/test_aqarcity_rent_classifier.py -v
"""
from scrapers.aqarcity.run import is_monthly_rental


def test_installment_annual_leases_are_not_monthly():
    # offers.price == body-stated-monthly x12 exactly (already annualized) -> must NOT be 'monthly'
    assert is_monthly_rental(
        "دور علوي \"للإيجار\"الرياض - حي بدر...💰الايجار الشهري :3000ريال ___", "YEAR", 36000) is False
    assert is_monthly_rental(
        "شقة للايجار بالثقبه...تصلح لطلبه او مهندسين الإيجار الشهري ٢٥٠٠", "YEAR", 30000) is False
    assert is_monthly_rental(
        "للايجار ملحق في مروج السجن 5 غرف...الايجار 1500 ريال شهريوسيلة التواصل", "YEAR", 18000) is False


def test_genuine_monthly_rentals_stay_monthly():
    # offers.price == body-stated-monthly directly (raw monthly) -> must stay 'monthly'
    assert is_monthly_rental(
        "🏡 شقة للإيجار - حي التيسير...السعر: 1700 ريال شهري شامل: كهرباء", "YEAR", 1700) is True
    assert is_monthly_rental(
        "جدة حي البوادي شقق للايجار مفروش...للايجار الشهري او السنوي ايجار شهري ب2500", "YEAR", 2500) is True


def test_structured_unit_month_wins_outright():
    assert is_monthly_rental("شقة مفروشة", "MONTH", 3500) is True


def test_no_monthly_keyword_stays_annual():
    assert is_monthly_rental("شقة للبيع فخمة في الرياض 500 متر مربع", "YEAR", 800000) is False


def test_ambiguous_multi_unit_ad_falls_back_unchanged():
    # No single unambiguous candidate to numerically verify against -> unchanged keyword fallback,
    # never force-guess a specific number for an ambiguous multi-unit ad.
    assert is_monthly_rental(
        "للايجار 3 شقق عزاب في ملحق سلطانة...الايجار الشهري : 1100 ريالالمعلن", "YEAR", 14400) is True


if __name__ == "__main__":
    test_installment_annual_leases_are_not_monthly()
    test_genuine_monthly_rentals_stay_monthly()
    test_structured_unit_month_wins_outright()
    test_no_monthly_keyword_stays_annual()
    test_ambiguous_multi_unit_ad_falls_back_unchanged()
    print("OK — aqarcity rent-period classifier regression tests pass")


# ── a page that states NO period: judge by the price (owner rule 2026-09-28; 348 rows were «annual») ──
from scrapers.aqarcity.run import rent_period_for  # noqa: E402


def test_a_silent_page_with_a_monthly_looking_price_is_monthly():
    body = "مكاتب مجهزة - جيران محترمين - نظافة وصيانة دورية المطلوب: 2000 ريال رقم ترخيص الإعلان: 7100293228"
    assert rent_period_for(body, "", 2000, "شقة للإيجار في جدة حي البوادي") == "monthly"
    assert rent_period_for("مكتب صغير المطلوب 595 ريال", "", 595, "مكتب للإيجار") == "monthly"


def test_a_silent_page_with_a_yearly_looking_price_stays_annual():
    assert rent_period_for("فيلا للإيجار المطلوب 85000 ريال", "", 85000, "فيلا للإيجار") == "annual"


def test_a_page_that_names_a_period_keeps_the_existing_decision():
    assert rent_period_for("محل للإيجار سنوي 8000 ريال", "", 8000, "محل للإيجار") == "annual"
    assert rent_period_for("شقة للإيجار 1700 ريال شهري", "YEAR", 1700, "شقة للإيجار") == "monthly"
    # the installment shape: «شهري» names the payment, offers.price is already the annual total
    assert rent_period_for("الايجار الشهري :3000ريال السنوي: 36000", "YEAR", 36000, "شقة للإيجار") == "annual"


def test_a_structured_year_unit_is_not_overruled_by_the_price():
    assert rent_period_for("المطلوب 2000 ريال", "YEAR", 2000, "شقة للإيجار") == "annual"
