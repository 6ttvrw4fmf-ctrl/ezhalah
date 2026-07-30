"""Regression tests for the 2026-07-30 aldarim property_age fix.

Root cause: aldarim's public API field `year_built` is seller free-entry rendered as «العمر» (Age)
on aldarim.sa, and the API sends the STRING "0" as its not-provided sentinel. The old mapping
`str(L.get("year_built")) if L.get("year_built") else None` let the truthy "0" through, fabricating
property_age=0 («جديد») for 133 of 167 active rows whose live pages show no age at all. The real
values mix TWO semantics: build years ("2000".."2026", 23 rows) and directly-typed ages ("1", "24",
3 rows — live-verified /en/properties/43143 renders «العمر:24 سنة»).

Fix, three parts:
  1. `_age_from_year_built()`: "0"/negative → None (never fabricate new-construction); 1900..now+2 →
     age = scrape-year − year (floored at 0 for under-construction); small ints → the shared
     `normalize.parse_property_age` bounds gate; anything else → None.
  2. AGELESS_TYPES guard (Residential Land, Commercial Land, Gas Station) — mizlaj PR#265 precedent;
     live case: a Residential Land row carried year_built="2025".
  3. Verbatim provenance unchanged: additional_info keeps the raw ("year_built", "Age") KV and
     source_capture keeps the raw payload value.

Run: python -m pytest scrapers/common/tests/test_aldarim_age_year_built.py -v
"""
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, ".")

import scrapers.aldarim.run as _run  # noqa: E402
from scrapers.aldarim.run import AGELESS_TYPES, _age_from_year_built, map_listing  # noqa: E402

YEAR_NOW = datetime.now(timezone.utc).year


@pytest.fixture(autouse=True)
def _stub_catalog(monkeypatch):
    """Hermetic: to_catalog loads the live location catalog — stub it (test_arabic_location pattern)."""
    monkeypatch.setattr(_run, "to_catalog", lambda city_ar, region_hint=None: (None, None))


def _payload(**over):
    """Minimal API item shaped like aldarim.nzl-backend.com/api/public/properties entries."""
    base = {
        "id": 43143,
        "category": "residential",
        "purpose": "sell",
        "type": "villa",
        "selling_price": 6000000,
        "area": 750,
        "city": {"name_en": "Riyadh", "name_ar": "الرياض"},
        "district": {"name_en": "Al Olaya", "name_ar": "العليا"},
    }
    base.update(over)
    return base


# ── the sentinel: "0" must NEVER become age 0 («جديد») ────────────────────────────────────────────
def test_zero_string_sentinel_is_none():
    assert _age_from_year_built("0") is None


def test_zero_int_and_negative_are_none():
    assert _age_from_year_built(0) is None
    assert _age_from_year_built(-3) is None


def test_missing_and_garbage_are_none():
    assert _age_from_year_built(None) is None
    assert _age_from_year_built("") is None
    assert _age_from_year_built("new") is None


# ── build years → age ─────────────────────────────────────────────────────────────────────────────
def test_build_year_becomes_age():
    assert _age_from_year_built("2013") == YEAR_NOW - 2013
    assert _age_from_year_built("2000") == YEAR_NOW - 2000


def test_current_and_future_year_floor_to_zero():
    assert _age_from_year_built(str(YEAR_NOW)) == 0
    assert _age_from_year_built(str(YEAR_NOW + 2)) == 0  # under construction


def test_far_future_year_is_none():
    assert _age_from_year_built(str(YEAR_NOW + 3)) is None


# ── directly-typed ages (live-verified: «العمر:24 سنة») ───────────────────────────────────────────
def test_direct_age_passes_bounds_gate():
    assert _age_from_year_built("24") == 24
    assert _age_from_year_built("1") == 1


def test_between_bounds_and_year_is_none():
    assert _age_from_year_built("500") is None  # not an age (>100), not a year (<1900)


# ── end-to-end through map_listing ────────────────────────────────────────────────────────────────
def test_map_listing_zero_sentinel_stores_null():
    row, _ = map_listing(_payload(year_built="0"))
    assert row["property_age"] is None


def test_map_listing_year_and_age_shapes():
    row, _ = map_listing(_payload(year_built="2013"))
    assert row["property_age"] == YEAR_NOW - 2013
    row, _ = map_listing(_payload(year_built="24"))
    assert row["property_age"] == 24


def test_map_listing_land_is_ageless_even_with_year():
    # Live case: Residential Land row carried year_built="2025".
    row, _ = map_listing(_payload(type="land", year_built="2025"))
    assert row["property_type"] in AGELESS_TYPES
    assert row["property_age"] is None


def test_provenance_kv_still_verbatim():
    row, _ = map_listing(_payload(year_built="2013"))
    kv = [e for e in row["additional_info"] if e.get("key") == "year_built"]
    assert kv and kv[0]["value"] == "2013"
    assert row["source_capture"]["year_built"] == "2013"
