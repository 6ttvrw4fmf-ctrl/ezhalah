"""Regression test for the Gathern `_num()` Arabic-decimal-separator bug (2026-08-12, GH #503,
field_integrity_extreme_magnitude).

msapi.gathern.co sometimes formats a price with the ARABIC decimal separator ٫ (U+066B) instead of
'.', e.g. "990٫00" meaning 990.00 SAR. The old `_num()` stripped ٫ out via `[^\\d.]` instead of
normalizing it, concatenating the integer and fraction digits into a number ~100x too large
("990٫00" → "99000"). Confirmed live in production on 204 rows (repaired directly; see
supabase/migrations for the DB-side repair — this test guards the parser only).

    python -m pytest scrapers/common/tests/test_gathern_num_arabic_decimal.py -q
"""
from __future__ import annotations

import sys
import types

# Hermetic import chain (same pattern as test_gathern_amenities_bathrooms.py) — stub supabase +
# dotenv so importing scrapers.gathern.run never touches network/credentials. `_num` is pure.
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.gathern.run import _num  # noqa: E402


def test_arabic_decimal_separator_parsed_as_decimal_point():
    # The bug: "990٫00" used to become 99000 (digits concatenated). Must now be 990.
    assert _num("990٫00") == 990
    assert _num("28215٫00") == 28215
    assert _num("29700٫00") == 29700


def test_arabic_thousands_separator_stripped():
    assert _num("15٬500٬000٫00") == 15500000


def test_ascii_forms_unchanged():
    # Pre-existing behavior must not regress.
    assert _num("9,935.40") == 9935
    assert _num("14915") == 14915
    assert _num(9935.4) == 9935
    assert _num(None) is None
    assert _num("") is None
    assert _num(0) is None


def test_arabic_indic_digits_normalized():
    assert _num("٩٩٠٫٠٠") == 990


if __name__ == "__main__":
    test_arabic_decimal_separator_parsed_as_decimal_point()
    test_arabic_thousands_separator_stripped()
    test_ascii_forms_unchanged()
    test_arabic_indic_digits_normalized()
    print("ok")
