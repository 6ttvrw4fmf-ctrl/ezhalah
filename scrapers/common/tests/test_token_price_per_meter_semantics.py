"""Token-price fixes, non-aqar platforms (senior audit run #3 continuation, 2026-08-03).

!! THE COPY-THE-DISPLAY RULE WAS REVERSED ON 2026-08-09 — read this before "fixing" a failure here.

Original convention (owner, 2026-08-03): when the source PAGE displays a per-meter rate as the
listing's price, price_total keeps the displayed figure VERBATIM and price_per_meter records the
same figure, so the rate semantic is honest and queryable rather than silently read as a total.

REVERSED (owner, 2026-08-09): "I never want total price confused with price/m²." Keeping the rate in
price_total IS that confusion, whatever the platform's own badge says — aqargate AG55663 made a
1,740 m² plot searchable at 2,817 SAR, hajer HJ3107 a 458 m² plot at 1,050 SAR. Live re-verification
that day showed the badge is not the contract: the REGA table labels the number «سعر الوحدة» and the
sellers write «N ريال للمتر». So a rate-priced ad now stores price_per_meter and leaves price_total
UNKNOWN. We do NOT multiply by the area to manufacture a total, and we do not adopt the platform's
own product either (aqargate's landTotalPrice = propertyPrice × propertyArea exactly on 30/31 rows —
that is its arithmetic, not a published price).

The assertions below were rewritten, not deleted, so the reversal stays visible.
  • still true: a per-meter-qualified figure must never be stored as a bare total with the qualifier
    dropped (the aqar precedent) — it is now enforced by NULLing the total, not by duplicating it.

Fixes pinned here (each independently adversarially verified against live source pages):
  1. eastabha: WP Residence renders «ريال للمتر» beside the price on land ads (8/8 token rows,
     e.g. 3,000 «للمتر» on a 5,505 m² plot searchable as a 3,000-SAR total); parse_detail now
     records price_per_meter when the displayed price carries the qualifier, and map_listing
     threads it through (the old hardcoded ppm=None is gone).
  2. aqargate: REGA publishes landTotalPrice = propertyPrice × propertyArea exactly on Buy land
     ads (31/31 live) — propertyPrice is the unit rate («سعر الوحدة»); the row now records it in
     price_per_meter when the unit-rate signature (landTotalPrice present) holds.
  3. dealapp: round(ppm) collapsed sub-0.5 source rates («0.39 ريال») to a stored 0 — now an
     honest NULL, matching the file's own _int convention.
  4. hajer: rem_fields()'s lazy (.*?)</span> stopped at the FIRST nested close, truncating range
     maxes + الف magnitude words from source_capture (live: HJ1435 «550.00 ر.س - 600 الف ر.س»).

Run: python -m pytest scrapers/common/tests/test_token_price_per_meter_semantics.py -v
"""
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, ".")

for name in ("supabase", "dotenv"):
    if name not in sys.modules:
        stub = mock.MagicMock()
        if name == "dotenv":
            stub.load_dotenv = lambda *a, **k: None
        sys.modules[name] = stub

SCRAPERS = Path(__file__).resolve().parents[2]


# ── 1. eastabha ────────────────────────────────────────────────────────────────
def test_eastabha_per_meter_display_records_ppm_and_no_total():
    """Shape B: the qualifier carries no number of its own, so the DISPLAYED figure is the rate."""
    src = (SCRAPERS / "eastabha" / "run.py").read_text(encoding="utf-8")
    assert 'out["price_per_meter"] = out["price"]' in src, "the rate must still be recorded"
    assert 'out["price_is_rate"] = True' in src, (
        "and the row must carry the rate-only signal so price_total can be left UNKNOWN")


def test_eastabha_qualifier_with_its_own_rate_keeps_the_total():
    """Shape A, live 2026-08-09 on EA23034: data-price is
    «<span class='infocur infocur_first'>سعر المتر 1000 ريال</span>920,000 ريال», area 920 m².
    The rate is 1,000 and 920,000 is the real TOTAL — we used to store 920,000 in both columns."""
    src = (SCRAPERS / "eastabha" / "run.py").read_text(encoding="utf-8")
    assert "infocur_first" in src, "the qualifier span must be parsed separately from the main price"
    assert 'out["price_per_meter"] = qual_rate' in src, (
        "when the qualifier states its own rate, THAT is the rate — not the total beside it")


def test_eastabha_threads_the_rate_through_to_the_row():
    src = (SCRAPERS / "eastabha" / "run.py").read_text(encoding="utf-8")
    assert 'ppm = detail.get("price_per_meter")' in src, "map_listing must thread the detected rate"
    assert 'detail.get("price_is_rate")' in src, "and must honour the rate-only signal"


# ── 2. aqargate ────────────────────────────────────────────────────────────────
def test_aqargate_unit_rate_signature_records_ppm():
    src = (SCRAPERS / "aqargate" / "run.py").read_text(encoding="utf-8")
    assert '"price_per_meter": _price_int(ar.get("propertyPrice"))' in src
    assert 'ar.get("landTotalPrice") is not None' in src, (
        "ppm only under the unit-rate signature (landTotalPrice present on Buy)")


# ── 3. dealapp ─────────────────────────────────────────────────────────────────
def test_dealapp_subhalf_rate_is_null_not_zero():
    src = (SCRAPERS / "dealapp" / "run.py").read_text(encoding="utf-8")
    assert "price_per_meter = (round(ppm) or None) if ppm else None" in src
    assert (round(0.39) or None) is None  # the exact live case: «سعر المتر: 0.39 ريال»
    assert (round(1.6) or None) == 2      # real rates unaffected


# ── 4. hajer ───────────────────────────────────────────────────────────────────
def test_hajer_rem_fields_keeps_nested_range_and_magnitude():
    from scrapers.hajer.run import rem_fields
    html = ('<strong class="rem-single-field-title">السعر</strong>'
            '<span class="rem-single-field-value"><span class="rem-price-amount">550.00 '
            '<span class="rem-currency-symbol">ر.س</span></span> - <span class="rem-price-amount">'
            '600</span> <span>الف</span> <span class="rem-currency-symbol">ر.س</span></span>'
            '<strong class="rem-single-field-title">عمر العقار</strong>'
            '<span class="rem-single-field-value">جديد</span>')
    f = rem_fields(html)
    assert "550.00" in f["السعر"] and "600" in f["السعر"] and "الف" in f["السعر"], (
        "the range max + الف magnitude must survive into source_capture")
    assert f["عمر العقار"] == "جديد"


if __name__ == "__main__":
    test_eastabha_per_meter_display_records_ppm()
    test_eastabha_plain_price_has_no_ppm()
    test_aqargate_unit_rate_signature_records_ppm()
    test_dealapp_subhalf_rate_is_null_not_zero()
    test_hajer_rem_fields_keeps_nested_range_and_magnitude()
    print("OK — token-price per-meter semantics regression tests pass")
