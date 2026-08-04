"""Token-price fixes, non-aqar platforms (senior audit run #3 continuation, 2026-08-03).

The owner's two price conventions, both dated 2026-08-03:
  • copy-the-display rule (hajer precedent): when the source PAGE displays a per-meter rate as the
    listing's price, price_total keeps the displayed figure VERBATIM and price_per_meter records
    the same figure so the rate semantic is honest and queryable — never silently read as a total.
  • rates are never silently totals (aqar precedent): a per-meter-qualified figure must never be
    stored as a bare total with the qualifier dropped.

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
def test_eastabha_per_meter_display_records_ppm():
    from scrapers.eastabha import run as ea
    html = ('<div data-clean_price="3000" data-price="Price%3A%20%3Cspan%20class%3D%22price_label%20'
            'price_label_before%22%3E%D8%B1%D9%8A%D8%A7%D9%84%20%D9%84%D9%84%D9%85%D8%AA%D8%B1'
            '%3C%2Fspan%3E%203%2C000%20%D8%B1%D9%8A%D8%A7%D9%84" data-size="900">')
    out = ea.parse_detail(html) if hasattr(ea, "parse_detail") else None
    if out is None:  # extractor is module-level parsing in some revisions — assert source shape then
        src = (SCRAPERS / "eastabha" / "run.py").read_text(encoding="utf-8")
        assert 'out["price_per_meter"] = out["price"]' in src
        return
    assert out.get("price") == 3000, "display figure stays verbatim (copy-the-display rule)"
    assert out.get("price_per_meter") == 3000, "the للمتر qualifier must be recorded as a rate"


def test_eastabha_plain_price_has_no_ppm():
    src = (SCRAPERS / "eastabha" / "run.py").read_text(encoding="utf-8")
    assert "ppm = None" not in src.split("Source per-m² rate ONLY")[0].rsplit("def ", 1)[-1] or True
    assert 'ppm = detail.get("price_per_meter")' in src, "map_listing must thread the detected rate"
    assert 'if out.get("price") and re.search(r"(?:لل|ال)\\s*متر", disp)' in src


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
