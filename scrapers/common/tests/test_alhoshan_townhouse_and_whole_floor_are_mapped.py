"""alhoshan: the source's `townhouse` and `whole_floor` slugs were missing from TYPE_MAP, so
map_listing() skipped AH1041 (تاون هاوس, Riyadh, 630k) and AH1039 (دور كامل, Al-Mudhnib, 650k)
— 32 of 34 served (coverage audit 2026-09-28).

townhouse → Villa is the fleet's existing fold (taxonomy.source.json Villa rawTypes carry «تاون
هاوس»; normalize maps the slug townhouse → Villa). whole_floor → Floor is the site's own label
«دور كامل». AH1039's office title says «فيلا دورين»; the structured slug decides (the page's spec
grid and SEO title both say «دور كامل»), the title stays verbatim on the card.

Items are the live /properties/search records of 2026-09-28, trimmed to what map_listing reads.

    python -m pytest scrapers/common/tests/test_alhoshan_townhouse_and_whole_floor_are_mapped.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

from scrapers.alhoshan import run as R  # noqa: E402

AH1041 = {"publicId": 1041, "purpose": "sale", "currentPrice": 630000,
          "title": "تاون هاوس أرضي للبيع حي بدر الرياض | 630 ألف ريال",
          "specs": {"city": "الرياض", "district": None, "area": 300, "bedrooms": 3, "bathrooms": 3,
                    "floors": 1, "propertyType": "townhouse"}}
AH1039 = {"publicId": 1039, "purpose": "sale", "currentPrice": 650000,
          "title": "فيلا دورين للبيع في المذنب – حي المنتزة | 317م²",
          "specs": {"city": "محافظة المذنب", "district": "القاع", "area": 317, "bedrooms": 6,
                    "bathrooms": 3, "floors": 2, "direction": "south", "propertyType": "whole_floor"}}


@pytest.mark.parametrize("item,ptype", [(AH1041, "Villa"), (AH1039, "Floor")])
def test_townhouse_and_whole_floor_are_served_under_existing_types(monkeypatch, item, ptype):
    monkeypatch.setattr(R, "to_catalog", lambda city, region_hint=None: (1, 1))
    row, category = R.map_listing(item, [])
    assert row is not None, f"AH{item['publicId']} ({item['specs']['propertyType']}) was skipped"
    assert (row["property_type"], category) == (ptype, "residential")
    assert row["price_total"] == item["currentPrice"] and row["title"] == item["title"]
