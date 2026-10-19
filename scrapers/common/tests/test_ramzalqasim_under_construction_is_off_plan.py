"""ramzalqasim: `avalible = under_construction` is the office saying the unit is not built yet —
off-plan, which Ezhalah excludes (owner 2026-09-13). GONE_AVAL named it in its comment but held
only "sold", so RQ95/RQ173/RQ174 sat active (coverage audit 2026-09-28).

The marker is VERBATIM from ramzalqasim.com/maps (updateMapMarkers, id 174, 2026-09-28), with the
PII keys (owner_name/owner_phone) left out and the description/media trimmed.
"""
from __future__ import annotations

import json
import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.ramzalqasim.run import map_marker  # noqa: E402

RQ174 = json.loads(r'''{"id": 174, "type": "villa", "status": "sell", "avalible": "under_construction", "area": 200, "price": "680000.00", "city": "عنيزة", "district": "الفرسان", "bedrooms": 1, "bathroom": 1, "master_room": 3, "real_estate_age": "جديد", "width_street": "15", "interface": "west", "license_number": null, "latitude": 26.060464501794, "longitude": 43.991507792798, "content": "[\"A\",\"B\",\"C\",\"D\",\"E\",\"F\",\"G\",\"H\",\"I\",\"K\",\"L\",\"M\",\"N\"]", "created_at": "2025-10-12T10:58:09.000000Z", "updated_at": "2025-11-09T00:11:05.000000Z", "description": "<p>🏡 رمز القصيم العقاري🏡</p><p>   لـلـبـيـع دبلوكسات فاخرة من مشروع الفرسان</p><p>  🚨الدبلوكسات تـحـت الـانـشـاء 🚨</p>", "media": [{"mime_type": "image/png", "original_url": "https://ramzalqasim.com/storage/1214/1762646879-ZI0TynTvCR.png"}]}''')


def test_under_construction_is_marked_gone_and_inactive():
    row, _, gone = map_marker(RQ174)
    assert gone is True and row["active"] is False and row["ad_number"] == "RQ174"


def test_the_same_unit_once_available_is_live():
    row, _, gone = map_marker({**RQ174, "avalible": "available"})           # documented edit
    assert gone is False and row["active"] is True
