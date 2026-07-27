"""Regression test for eastabha's stored_property_type fallback (2026-07-27).

Guards a bug where a cat_name that's PURELY a deal/status word (e.g. "إيجار") was stored as
stored_property_type, duplicating transaction_type with zero new type signal (found live:
4 listings stored property_type="إيجار"). The fallback must only use a raw cat_name that still
has real residual signal after stripping deal words — never a bare deal word.

Run: python -m pytest scrapers/common/tests/test_eastabha_type_fallback.py -v
"""
from scrapers.eastabha.run import _residual


def test_pure_deal_word_has_no_residual_signal():
    assert _residual("إيجار") == ""
    assert _residual("للبيع") == ""
    assert _residual("للايجار") == ""


def test_type_word_survives_residual_strip():
    assert _residual("شقة للإيجار") == "شقة"
    assert _residual("أرض سكنية للبيع") == "أرض"


def test_raw_fallback_formula_skips_bare_deal_words():
    # mirrors map_listing's: raw_fallback = next((c.strip() for c in cat_names if _residual(c)), None)
    cat_names = ["إيجار"]
    raw_fallback = next((c.strip() for c in cat_names if _residual(c)), None)
    assert raw_fallback is None  # must fall through to "unknown", never store "إيجار" as a type


def test_raw_fallback_formula_keeps_real_signal():
    cat_names = ["فيلا للإيجار"]
    raw_fallback = next((c.strip() for c in cat_names if _residual(c)), None)
    assert raw_fallback == "فيلا للإيجار"  # raw cat_name preserved verbatim, just gated by residual check


if __name__ == "__main__":
    test_pure_deal_word_has_no_residual_signal()
    test_type_word_survives_residual_strip()
    test_raw_fallback_formula_skips_bare_deal_words()
    test_raw_fallback_formula_keeps_real_signal()
    print("OK — eastabha type-fallback regression tests pass")
