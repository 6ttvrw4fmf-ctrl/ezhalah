"""The Nuzul SaaS tenants store the ad's own text in `description` (🔬 AF engineer, 2026-10-27).

The Rule B word checker (scrapers/facts/words.py → public.text_facts_todo) reads ONLY the `description`
column. aldarim / abwbna / alobid / bahadhabab kept the seller's sentence in source_capture.description_ar
and left `description` NULL, so these four sites had ZERO text facts (listing_text_facts_af) while the
fleet had 301,552. bahadhabab_residential_listings:10777784 says «ومتاح مصعد» in its own text and was
missed by the 10-27 08:00 af-score on an elevator ask (bahadhabab 2 of 5 found, the worst site).

Run: python -m pytest scrapers/common/tests/test_nuzul_tenants_store_ad_text_for_rule_b.py -v
"""
from __future__ import annotations

import importlib
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import arabic_location as al  # noqa: E402

SITES = ["aldarim", "abwbna", "alobid", "bahadhabab"]


@pytest.fixture(autouse=True)
def no_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {})
    monkeypatch.setattr(al, "_CID_AR", {})
    monkeypatch.setattr(al, "_REGION_NORM", {})


def _L(**kw):
    base = {"id": 1, "type": "building_apartment", "purpose": "rent", "category": "residential",
            "rent_price_annually": 25000, "area": 150, "city": {"name_ar": "الرياض", "name_en": "Riyadh"},
            "district": {"name_ar": "الملقا"}, "url_path": "x", "bedrooms": 3, "bathrooms": 2,
            "living_rooms": 1, "kitchens": 1, "is_kitchen_installed": 0, "elevators": 0}
    return {**base, **kw}


@pytest.mark.parametrize("site", SITES)
def test_ad_text_reaches_description(site):
    mod = importlib.import_module(f"scrapers.{site}.run")
    row, _ = mod.map_listing(_L(description_ar="شقة من 5غرفة ومطبخ و4حمام وصالة ومتاح مصعد"))
    assert row is not None
    assert row.get("description") and "مصعد" in row["description"], f"{site}: the ad text never reached description"


@pytest.mark.parametrize("site", SITES)
def test_description_is_pii_redacted(site):
    mod = importlib.import_module(f"scrapers.{site}.run")
    row, _ = mod.map_listing(_L(description_ar="شقة فاخرة للتواصل 0551234567 ومتاح مصعد"))
    assert row is not None
    assert "0551234567" not in (row.get("description") or ""), f"{site}: a phone number reached description"


@pytest.mark.parametrize("site", SITES)
def test_no_text_is_null_not_empty(site):
    mod = importlib.import_module(f"scrapers.{site}.run")
    row, _ = mod.map_listing(_L(description_ar=None))
    assert row is not None
    assert row.get("description") is None
