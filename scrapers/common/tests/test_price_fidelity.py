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


# ── No price column may be DERIVED from an area (2026-07-26) ───────────────────────────────────
# A price column must hold what the source published. Both directions are the same violation:
#   price_total      = price_per_meter * area   → fabricates a total the ad never printed
#   price_per_meter  = price_total   / area     → fabricates a rate  the ad never printed
# Precedent: aqar PR#216, where trg_aqar_parse() derived ppm as round(price_total/area_m2) and put
# 42,758 fabricated + 3,479 contradicting values into production. These four scrapers did the same
# in Python; this guard fails the build if any of them starts doing it again.
import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
# Widened 2026-07-27 (audit item 4): the original pattern required a BARE-NAME target at line start
# and a literal `area` divisor, so mustqr's dict-style
#   row["price_per_meter"] = round(row["price_total"] / row["area_m2"])
# sailed straight past it (621 fabricated live values). Now the target may be bare OR row["…"]-style,
# anywhere on the line, and the arithmetic operand matches area/land_area/area_m2 in bare or
# bracketed form.
_DERIVE_RE = re.compile(
    r"""^\s*(?:\w+\[["'])?(?:price_total|price_per_meter|price_annual|total|meter)(?:["']\])?"""
    r"""\s*=(?!=).*[*/].*\b(?:area|land_area|area_m2)\b"""
)

def _scraper_sources():
    """Every scraper module that could write a price column — NO allowlist.

    An enumerated list is what let this bug sit in 17 scrapers at once: each was fixed or reviewed
    in isolation while the rest kept fabricating. Scanning the whole tree means a NEW scraper is
    covered the day it lands, without anyone remembering to add it here.
    """
    root = _REPO_ROOT / "scrapers"
    for path in sorted(root.glob("*/run.py")) + sorted(root.glob("*/enrich*.py")):
        yield path.relative_to(root).as_posix(), path


def test_no_price_column_is_derived_from_area_ANYWHERE():
    bad = []
    for rel, path in _scraper_sources():
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if _DERIVE_RE.match(line):
                bad.append(f"{rel}:{i}: {line.strip()}")
    assert not bad, (
        "a price column is being DERIVED from an area — it must hold what the source published:\n  "
        + "\n  ".join(bad)
    )


def test_the_guard_actually_catches_the_shapes_it_must():
    """A guard that cannot fail is worthless — pin it against the exact lines just removed."""
    for line in (
        "        price_total = round(raw_price * area)",
        "                price_per_meter = round(raw_price / area)",
        "        price_total = int(round(price_per_meter * area))",
        "        total = meter * area",
        "        price_total = round(price * area)",
        # mustqr's exact dict-style derivation (missed by the pre-2026-07-27 bare-name anchor; 621 live rows)
        '        row["price_per_meter"] = round(row["price_total"] / row["area_m2"])',
    ):
        assert _DERIVE_RE.match(line), f"guard missed a real derivation: {line!r}"
    for line in (
        # fursaghyr's magnitude probe: computed for a threshold test, never stored → allowed
        "    price_for_check = total or (meter * area if (meter and area and meter < 50000) else meter)",
        "    area = _int(rea.get('land_area'))",
        "            price_per_meter = raw_price",
        "        # We do NOT compute total = rate * area, nor rate = total / area",
    ):
        assert not _DERIVE_RE.match(line), f"guard false-positived on: {line!r}"


def test_fursaghyr_micro_price_gate_still_judges_magnitude_not_the_bare_rate():
    """Removing the total synthesis must not silently DROP listings.

    The gate at fursaghyr/run.py returns None (discards the row). It used to test the synthesized
    total; if it were left testing whichever field is populated, an honest cheap land ad with only
    a per-m² rate would be judged as `meter < 1000` and thrown away. Real shape: FG24914
    (meter 33 / area 620 → magnitude 20,460, must be KEPT).
    """
    from scrapers.fursaghyr.run import map_listing

    def item(i, **rea):
        return {"id": i, "rea": {"property_type": "أرض", "purpose": "بيع", **rea}}

    # source total present → stored verbatim, never recomputed (1052 * 437.5 = 460,250 coincidence)
    row, _ = map_listing(item(1, land_area=437.5, meter_price=1052, total_price=460250))
    assert row["price_total"] == 460250

    # rate only, no source total → row KEPT, and no total invented
    row, _ = map_listing(item(2, land_area=620, meter_price=33))
    assert row is not None, "honest cheap-land row was dropped by the micro-price gate"
    assert row["price_total"] is None, "a total was fabricated from the per-m² rate"

    # genuinely implausible magnitude → still dropped
    row, _ = map_listing(item(3, land_area=1, meter_price=500))
    assert row is None
