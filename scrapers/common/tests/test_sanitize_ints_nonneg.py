"""Batch 5 (2026-07-16): _sanitize_ints() must NULL impossible-by-definition NEGATIVE values
(sign-flip/parse artifacts) so one bad field can never fail its whole upsert batch against the
new `>= 0 OR NULL` CHECK constraints (20260716_batch5_integrity_checks.sql) — same philosophy
as the existing overflow/bad-cast protection. Zero must stay legal: 0 is a known faithful
placeholder (price-fidelity rule; the 2026-07-15 repair clearance kept them).

Hermetic: stubs supabase/dotenv like test_end_run_honesty.py — no network, no credentials.
"""
from __future__ import annotations

import sys
import types

# ── Stub supabase + dotenv (db.py imports both at module load) ───────────────────────────────────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db  # noqa: E402


def test_negative_counts_and_prices_are_nulled():
    r = {"bedrooms": -1, "bathrooms": -3, "area_m2": -250,
         "price_total": -500000, "price_annual": -1}
    db._sanitize_ints(r)
    assert r == {"bedrooms": None, "bathrooms": None, "area_m2": None,
                 "price_total": None, "price_annual": None}


def test_negative_numeric_strings_are_nulled_too():
    r = {"bedrooms": "-2", "price_total": "-100"}
    db._sanitize_ints(r)
    assert r["bedrooms"] is None and r["price_total"] is None


def test_zero_is_a_legal_faithful_placeholder():
    # 0 is NOT garbage: aqar_res carries faithful price_annual=0 placeholders (kept by the
    # 2026-07-15 price-repair clearance) and the DB CHECKs are >= 0, not > 0.
    r = {"bedrooms": 0, "price_annual": 0, "area_m2": 0}
    db._sanitize_ints(r)
    assert r == {"bedrooms": 0, "price_annual": 0, "area_m2": 0}


def test_ordinary_positive_values_untouched():
    r = {"bedrooms": 3, "bathrooms": 2, "area_m2": 180, "price_total": 850000}
    db._sanitize_ints(r)
    assert r == {"bedrooms": 3, "bathrooms": 2, "area_m2": 180, "price_total": 850000}


def test_overflow_protection_still_intact():
    r = {"price_per_meter": 90_533_352_829}  # the original 22003 incident value (int4 col)
    db._sanitize_ints(r)
    assert r["price_per_meter"] is None
