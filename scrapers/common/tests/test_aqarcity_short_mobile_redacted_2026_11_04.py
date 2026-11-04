"""aqarcity: a mobile written one digit short («05» + 7 digits) is a contact number (backlog 1096, PDPL).

3 active ads kept one in the served description on 2026-11-04 because `0?5\\d{8}` needs 8 digits after the
5. Shapes below are those ads' own (digits replaced). Licence / CR numbers and prices must survive.
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = object
_supabase_mod.create_client = lambda url, key: object()
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import pytest  # noqa: E402

from scrapers.aqarcity.run import _redact  # noqa: E402


@pytest.mark.parametrize("text", [
    "رقم الإعلان / 7200123456. للتواصل والاستفسار : 055123456.",
    "للتواصل والاستفسار: ريماز العقارية. 053987654.",
    "موظف بنك الراجحي: خالد 050111222.",
    "للتواصل ٠٥٥١٢٣٤٥٦",
])
def test_a_short_mobile_is_removed(text):
    out = _redact(text)
    assert not any(n in out for n in ("055123456", "053987654", "050111222", "٠٥٥١٢٣٤٥٦")), out


@pytest.mark.parametrize("text, keep", [
    ("رخصة فال رقم: 1100012345. سجل تجاري: 7001234567.", "1100012345"),
    ("رخصة فال رقم: 1100012345. سجل تجاري: 7001234567.", "7001234567"),
    ("السعر 950000 ريال", "950000"),
    ("رقم الترخيص الإعلاني 7105123456", "7105123456"),   # «05» inside a longer number is not a phone
])
def test_licences_cr_numbers_and_prices_survive(text, keep):
    assert keep in _redact(text)
