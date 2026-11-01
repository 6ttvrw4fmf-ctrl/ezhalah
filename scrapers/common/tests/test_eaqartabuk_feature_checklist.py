"""eaqartabuk's structured feature checklist reaches the Advanced Filter (🔬 AF engineer, 2026-10-12).

The candles-map «features» list («مصعد», «مطبخ», «مداخل خاصة», «كراج», «غرفة غسيل») was kept in
additional_info only: 90 lifts, 36 kitchens, 176 private entrances, 12 garages and 154 laundry rooms listed
on active ads were NULL to every amenity question (backlog 461). Listed = yes; unlisted = unknown, never no.

Run: python -m pytest scrapers/common/tests/test_eaqartabuk_feature_checklist.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.eaqartabuk.run import feature_answers, map_listing  # noqa: E402


def test_listed_features_are_yes_and_unlisted_stay_unknown():
    got = feature_answers(["مداخل خاصة", "غرفة غسيل", "مصعد", "بجانب الطريق المزدحم", "سطح خاص"])
    assert got == {"private_entrance": True, "laundry_room": True, "elevator": True}
    assert feature_answers([]) == {} and feature_answers(None) == {}


def test_map_listing_carries_the_checklist():
    """The wiring: a real-shaped candles-map record through map_listing()."""
    item = {"id": 598537, "title": "فيلا بحي المصيف", "link": "https://eaqartabuk.com/?p=598537",
            "date": "2026-08-01", "meta": {}, "featured_image": None, "excerpt": ""}
    mp = {"usage": "residential", "operation": "sale", "status": "بيع", "city": "تبوك", "district": "المصيف",
          "features": ["مصعد", "مطبخ", "كراج", "سطح خاص"]}
    row, _cat = map_listing(item, mp, None)
    assert row["elevator"] is True and row["kitchen"] is True and row["parking"] is True
    assert "private_entrance" not in row and "laundry_room" not in row     # unlisted → unknown
