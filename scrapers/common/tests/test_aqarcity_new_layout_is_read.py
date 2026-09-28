"""Aqar City's 2026-09-25 redesign must be READ, and an unreadable spec table must write NOTHING.

The page moved its spec table to Tailwind cards before the 2026-09-25 18:02 UTC crawl. The old
`pi-item` regex then matched nothing on every page, and the crawl kept upserting: all 1,800 active
rows became property_type 'unknown', lost every spec key in additional_info (licence dates, use,
plan, parcel…), 1,450 had rega_location_verified flipped to false, and the 198 commercial ads were
retired as "superseded" by their own 'unknown' residential copies.

Fixture: the spec cards of /property/27370 exactly as served on 2026-09-28 (the advertiser name and
phone cards removed), with its JSON-LD (the seller's prose replaced — this test is not about prose).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqarcity import run as R  # noqa: E402

_FX = json.loads((Path(__file__).with_name("aqarcity_27370_new_layout.json")).read_text(encoding="utf-8"))


def _page(cards: str) -> str:
    return (f'<html><script type="application/ld+json">{json.dumps(_FX["ld"], ensure_ascii=False)}</script>'
            f"{cards}</html>")


def test_the_new_card_layout_is_read_and_an_unreadable_one_writes_nothing():
    row, cat = R.map_listing(_page(_FX["cards"]), "https://www.aqarcity.net/property/27370")
    ai = row["additional_info"]
    assert (row["property_type"], cat) == ("Showroom", "commercial")             # «نوع العقار: معرض»
    assert ai["rega_license_expiry_date"] == "08/10/2026"                         # «تاريخ انتهاء رخصة الإعلان»
    assert ai["rega_license_issue_date"] == "08/10/2025"
    assert (ai["rega_ad_license_number"], ai["broker_fal_license"]) == (7200708876, 1200007456)
    assert row["rega_location_verified"] is True
    assert (row["area_m2"], row["street_width_m"], row["direction"]) == (1110, 64, "جنوبية")
    assert ai["deed_location_text"].startswith("حي السلام") and ai["plan_number"] == "710 / ت / 1415"
    assert row["date_added"] == "2025-10-14T05:10:15.000Z"                        # JSON-LD datePosted
    # A live page whose spec table reads as nothing is new markup, not a listing without specs.
    assert R.map_listing(_page(""), "https://www.aqarcity.net/property/27370")[0] is None
