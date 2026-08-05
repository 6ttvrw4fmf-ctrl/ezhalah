"""Regression tests for the 2026-08-04 catalog-fallback fix.

Root cause: mizlaj/fursaghyr/souq24/aqaratikom resolved `city` via `normalize.map_city()`
ONLY — a small private English-name dict — with NO fallback to the full catalog resolver
(`scrapers.common.arabic_location.to_catalog`), unlike aldarim/alhoshan/aqargate/sanadak/hajer.
Real catalog cities absent from that private dict (e.g. mizlaj's «ضمد», fursaghyr's «بلجرشي»,
souq24's «الجله»/«العارضه», aqaratikom's twin-region «الحسى») were dropped as an honest-but-
avoidable None.

Fix: when `normalize.map_city()` returns None, each scraper now calls `to_catalog(city_ar,
region_hint=<the scraper's own already-resolved region signal>)` — the SAME never-guess resolver
aldarim/alhoshan/aqargate/sanadak/hajer already use — and, when it resolves, stores
`catalog_city_id`/`catalog_region_id` in `additional_info` (these 4 tables have no city_id/
region_id COLUMN, unlike the six platforms above, so the result is captured additively for a
future location-resolution pass; the existing city/region/neighborhood columns the card renders
from are untouched).

Hermetic: `to_catalog` is monkeypatched on each scraper module (same pattern as
test_aldarim_age_year_built.py) so these tests never hit the network/DB.

Run: python -m pytest scrapers/common/tests/test_catalog_fallback_mizlaj_fursaghyr_souq24_aqaratikom_2026_08_04.py -v
"""
from __future__ import annotations

import sys

import pytest

sys.path.insert(0, ".")

import scrapers.aqaratikom.run as aqaratikom_run  # noqa: E402
import scrapers.fursaghyr.run as fursaghyr_run  # noqa: E402
import scrapers.mizlaj.run as mizlaj_run  # noqa: E402
import scrapers.souq24.run as souq24_run  # noqa: E402


def _never_called(*a, **kw):
    raise AssertionError("to_catalog() must not be called when map_city() already resolved the city")


# ── mizlaj ───────────────────────────────────────────────────────────────────────────────────────
def test_mizlaj_uses_catalog_fallback_when_map_city_fails(monkeypatch):
    monkeypatch.setattr(mizlaj_run, "to_catalog",
                         lambda city_ar, region_hint=None: (3499, 10) if city_ar == "ضمد" else (None, None))
    md = {"id": 74, "slug": "x", "name": "شقة - ضمد", "total_price": 500000, "space": 300,
          "advertisement_type": "Sell", "location": {"city": "ضمد", "region": "منطقة جازان"}}
    row, _ = mizlaj_run.map_listing(md, None)
    assert row["city"] is None  # card-facing column untouched — still an honest None
    assert row["additional_info"]["catalog_city_id"] == 3499
    assert row["additional_info"]["catalog_region_id"] == 10


def test_mizlaj_no_pollution_when_fallback_also_unresolved(monkeypatch):
    monkeypatch.setattr(mizlaj_run, "to_catalog", lambda city_ar, region_hint=None: (None, None))
    md = {"id": 1, "slug": "x", "name": "شقة - نوفمبر", "total_price": 500000,
          "location": {"city": "نوفمبر"}}
    row, _ = mizlaj_run.map_listing(md, None)
    assert "catalog_city_id" not in row["additional_info"]
    assert "catalog_region_id" not in row["additional_info"]


def test_mizlaj_fallback_skipped_when_city_already_resolved(monkeypatch):
    monkeypatch.setattr(mizlaj_run, "to_catalog", _never_called)
    md = {"id": 2, "slug": "x", "name": "شقة - الرياض", "total_price": 500000,
          "location": {"city": "الرياض"}}
    row, _ = mizlaj_run.map_listing(md, None)
    assert row["city"] == "Riyadh"


# ── fursaghyr ────────────────────────────────────────────────────────────────────────────────────
def test_fursaghyr_uses_catalog_fallback_when_map_city_fails(monkeypatch):
    monkeypatch.setattr(fursaghyr_run, "to_catalog",
                         lambda city_ar, region_hint=None: (1531, 12) if city_ar == "بلجرشي" else (None, None))
    item = {"id": 27232, "rea": {"property_type": "فيلا", "purpose": "بيع",
                                   "city": "بلجرشي", "region": "منطقة الباحة", "total_price": 800000}}
    row, _ = fursaghyr_run.map_listing(item)
    assert row["city"] is None
    assert row["additional_info"]["catalog_city_id"] == 1531
    assert row["additional_info"]["catalog_region_id"] == 12


def test_fursaghyr_no_pollution_when_fallback_also_unresolved(monkeypatch):
    monkeypatch.setattr(fursaghyr_run, "to_catalog", lambda city_ar, region_hint=None: (None, None))
    item = {"id": 1, "rea": {"property_type": "فيلا", "purpose": "بيع", "city": "لا يوجد",
                              "total_price": 800000}}
    row, _ = fursaghyr_run.map_listing(item)
    assert "catalog_city_id" not in row["additional_info"]


# ── souq24 ───────────────────────────────────────────────────────────────────────────────────────
def test_souq24_uses_catalog_fallback_when_map_city_fails(monkeypatch):
    monkeypatch.setattr(souq24_run, "to_catalog",
                         lambda city_ar, region_hint=None: (889, 1) if city_ar == "الجله" else (None, None))
    body = 'var realestate_name = "أرض";\nمعلومات الإعلان\nمدينة : الجله\n'
    row, _ = souq24_run.map_listing(1127, body)
    assert row["city"] is None
    assert row["additional_info"]["catalog_city_id"] == 889
    assert row["additional_info"]["catalog_region_id"] == 1


def test_souq24_no_pollution_when_fallback_also_unresolved(monkeypatch):
    monkeypatch.setattr(souq24_run, "to_catalog", lambda city_ar, region_hint=None: (None, None))
    body = 'var realestate_name = "أرض";\nمعلومات الإعلان\nمدينة : لا يوجد\n'
    row, _ = souq24_run.map_listing(2, body)
    assert "catalog_city_id" not in row["additional_info"]


# ── aqaratikom ───────────────────────────────────────────────────────────────────────────────────
def test_aqaratikom_uses_region_hint_to_disambiguate_twin_city(monkeypatch):
    """«الحسى» is a twin catalog city across Riyadh and Eastern Province — proves the region_hint
    this scraper already derives from its own source (authority_details' المنطقة) is threaded
    through to to_catalog(), exactly like aldarim/alhoshan already do."""
    seen = {}

    def _fake(city_ar, region_hint=None):
        seen["city_ar"], seen["region_hint"] = city_ar, region_hint
        return (447, 1) if city_ar == "الحسى" and region_hint == "Riyadh" else (None, None)

    monkeypatch.setattr(aqaratikom_run, "to_catalog", _fake)
    ad = {"id": "uuid1", "type": "sell", "price": "500000",
          "estate": {"category": "فيلا", "city": "الحسى", "area": "300"}}
    detail = {"authority_details": [{"name": "المنطقة/رقم المنطقة", "value": "منطقة الرياض"}]}
    row, _, _ = aqaratikom_run.map_listing(ad, detail)
    assert seen == {"city_ar": "الحسى", "region_hint": "Riyadh"}
    assert row["city"] is None
    assert row["additional_info"]["catalog_city_id"] == 447
    assert row["additional_info"]["catalog_region_id"] == 1


def test_aqaratikom_no_pollution_when_fallback_also_unresolved(monkeypatch):
    monkeypatch.setattr(aqaratikom_run, "to_catalog", lambda city_ar, region_hint=None: (None, None))
    ad = {"id": "uuid2", "type": "sell", "price": "500000",
          "estate": {"category": "فيلا", "city": "مشروع مخطط استراحات", "area": "300"}}
    row, _, _ = aqaratikom_run.map_listing(ad, None)
    assert "catalog_city_id" not in row["additional_info"]


def test_aqaratikom_fallback_skipped_when_city_already_resolved(monkeypatch):
    monkeypatch.setattr(aqaratikom_run, "to_catalog", _never_called)
    ad = {"id": "uuid3", "type": "sell", "price": "500000",
          "estate": {"category": "فيلا", "city": "الرياض", "area": "300"}}
    row, _, _ = aqaratikom_run.map_listing(ad, None)
    assert row["city"] == "Riyadh"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
