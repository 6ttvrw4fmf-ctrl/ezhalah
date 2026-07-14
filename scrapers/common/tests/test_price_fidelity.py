"""Price-fidelity regression tests (2026-07-13, extended 2026-07-14).

Guards the confirmed display bugs:
  BUG 1 — normalize.to_int() stripped the decimal point, inflating decimal prices ×10^(#decimals)
          (DealApp offers.price "150588.72" → 15,058,872 instead of 150,588).
  BUG 2 — eaqartabuk/aqarcity/mustqr/satel stored the source MONTHLY rent into price_annual without
          ×12, so the app's round(price_annual/12) card showed 1/12 of the real rent.
  BUG 3 (2026-07-14) — eaqartabuk: some listings have NO real price at all (description literally
          says "السعر حسب النشاط ومدة العقد" — price depends on the tenant's business activity /
          contract term), but meta.price still carries a non-zero placeholder digit ("150" for
          ET7917/id 7917, "150000" for ET8092/id 8092 — live-verified 2026-07-14) that the
          magnitude heuristic in eaqartabuk/run.py::_price() happily turned into a fabricated
          real-looking price (1,800/yr and 150,000/yr respectively). Fixed by run.py::_price_on_request()
          nulling the price whenever the source description contains "السعر حسب" — see
          eaqartabuk_on_request_price tests below, which import the real fixed functions.

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


def test_eaqartabuk_bug2_still_fixed():
    """BUG 2 regression, eaqartabuk-specific: _price() must annualize a small rent figure, never
    store it raw. Live-verified 2026-07-14: id 8950 (ET8950/row 598426) meta.price="2700" → the
    live DB row shows price_annual=32400, rent_period="monthly" (32400/12=2700 ✓ card shows real rent)."""
    from scrapers.eaqartabuk.run import _price
    assert _price("2700", True) == (None, 32400, "monthly")
    # Buy-side magnitude heuristic must be untouched by this fix.
    assert _price("580", False) == (580_000, None, None)
    assert _price("1350000", False) == (1350000, None, None)


def test_eaqartabuk_bug3_on_request_price_not_fabricated():
    """BUG 3 regression (2026-07-14): a source description containing "السعر حسب النشاط" (or any
    "السعر حسب ..." phrasing) means there is NO real price — meta.price is a junk placeholder.
    Live-verified against eaqartabuk.com today:
      id 7917  (ET7917 / row 598548) meta.price="150"    + content "...السعر حسب النشاط ومدة العقد"
      id 8092  (ET8092 / row 598534) meta.price="150000" + content "...السعر حسب النشاط ومدة العقد رقم 121"
      id 7327  (ET7327 / row 598631) meta.price="0"      + content "...السعر حسب مدة العقد" (already
                                                              null via the v<=0 guard; kept for parity)
    Before the fix, _price() alone would have produced (None, 1800, 'monthly') and
    (None, 150000, 'annual') for the first two — a fabricated real-looking price for a
    listing that has none. map_listing() must null it once the on-request text is detected."""
    from scrapers.eaqartabuk.run import _price, _price_on_request, _strip_tags, map_listing

    content_7917 = "<p>ارض بحي الريان مساحة 593م شارعين السعر حسب النشاط ومدة العقد</p>\n"
    content_8092 = ("<p>ارض بحي ملحق الرابية تجاري للاستثمار مساحة 910م شارعين واجهة 42م "
                    "السعر حسب النشاط ومدة العقد رقم 121</p>\n")
    content_7327 = "<p>السعر حسب مدة العقد</p>"

    # The raw numeric heuristic alone would still fabricate a price (proves the bug existed / could
    # regress if _price_on_request's call-site in map_listing were ever removed).
    assert _price("150", True) == (None, 1800, "monthly")
    assert _price("150000", True) == (None, 150000, "annual")

    # The text-based signal must fire for all three live-observed phrasings.
    assert _price_on_request(_strip_tags(content_7917)) is True
    assert _price_on_request(_strip_tags(content_8092)) is True
    assert _price_on_request(_strip_tags(content_7327)) is True
    # ...and must NOT fire on an unrelated, normal description (no false positives).
    assert _price_on_request(_strip_tags("<p>شقة فاخرة حي المروج مساحة 200م</p>")) is False

    # End-to-end through map_listing(): price must come out fully null, not fabricated.
    item = {"id": 7917, "title": "ارض تجاري للاستثمار", "link": "https://eaqartabuk.com/property/x/",
            "date": "2026-01-27T20:43:38+03:00", "excerpt": None, "featured_image": None,
            "meta": {"price": "150", "bedrooms": "0", "bathrooms": "0", "area": ""}}
    mp = {"usage": "", "type": "العقارات التجارية", "operation": "", "status": "إيجار",
          "city": "", "district": "", "lat": 28.47, "lng": 36.56}
    row, _cat = map_listing(item, mp, content_7917)
    assert row["price_total"] is None and row["price_annual"] is None and row["rent_period"] is None, row


if __name__ == "__main__":
    test_to_int_decimal_fidelity()
    test_monthly_rent_roundtrip()
    test_eaqartabuk_bug2_still_fixed()
    test_eaqartabuk_bug3_on_request_price_not_fabricated()
    print("OK — price-fidelity regression tests pass (to_int decimals + monthly ×12 round-trip)")
