"""Price-fidelity regression tests (2026-07-13).

Guards the two confirmed display bugs:
  BUG 1 — normalize.to_int() stripped the decimal point, inflating decimal prices ×10^(#decimals)
          (DealApp offers.price "150588.72" → 15,058,872 instead of 150,588).
  BUG 2 — eaqartabuk/aqarcity/mustqr/satel stored the source MONTHLY rent into price_annual without
          ×12, so the app's round(price_annual/12) card showed 1/12 of the real rent.

Run: python -m pytest scrapers/common/tests/test_price_fidelity.py -v   (also runs in the Common location tests CI job)
"""
from scrapers.common.normalize import to_int, annualize_rent


def _card_monthly(price_annual: int) -> int:
    """Mirror of the app's monthly display (src/data/remote.ts finalize): round(price_annual/12)."""
    return round(price_annual / 12)


def test_to_int_decimal_fidelity():
    cases = {
        # BUG 1 — decimals must NOT inflate; truncate to whole riyals (sources display the floored int)
        "150588.72": 150588,   # DealApp: was 15,058,872 (×100)
        "150588.7": 150588,    # 1 decimal: was ×10
        "2946.17": 2946,       # mizlaj per-m² decimal
        "١٥٠٥٨٨٫٧٢": 150588,   # Arabic digits + Arabic decimal separator ٫
        150588.72: 150588,     # float input
        "﷼ 150588.72": 150588, # currency symbol prefix
        # Preserved behaviour (must be unchanged)
        "69,000": 69000, "69000": 69000, "٦٩٠٠٠": 69000, "SAR 69,000": 69000,
        "15,058,872": 15058872, "1,234,567.89": 1234567,
        "1.234.567": 1234567,  # European grouping → integer
        "1.234": 1234,         # single dot, 3 frac digits → treated as grouping (legacy behaviour)
        "150,588": 150588, "3": 3, "0": 0, "١٧٠٠": 1700,
        None: None, "": None, "abc": None, "السعر حسب النشاط": None,
    }
    for raw, expected in cases.items():
        assert to_int(raw) == expected, f"to_int({raw!r}) = {to_int(raw)!r}, expected {expected!r}"


def test_monthly_rent_roundtrip():
    # Source monthly → scraper stores annualize_rent(m,'monthly')=m×12 → app shows round(/12)=m.
    for monthly in (1700, 2500, 1000, 750, 417, 6500):
        price_annual = annualize_rent(monthly, "monthly")
        assert price_annual == monthly * 12
        assert _card_monthly(price_annual) == monthly, (
            f"round-trip broke: {monthly}/mo → price_annual {price_annual} → card {_card_monthly(price_annual)}")


if __name__ == "__main__":
    test_to_int_decimal_fidelity()
    test_monthly_rent_roundtrip()
    print("OK — price-fidelity regression tests pass (to_int decimals + monthly ×12 round-trip)")
