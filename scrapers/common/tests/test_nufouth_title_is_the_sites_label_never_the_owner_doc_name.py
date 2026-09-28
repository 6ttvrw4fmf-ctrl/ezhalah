"""PDPL: a nufouth title never carries the owner's name.

The API's `unit.name` / `property.name` are Frappe doc names that embed the owner's personal name —
after the dash on H codes («… - <owner> - 2 F-H257»), after the dash on N/R codes, and INSIDE the
asset label itself («فيلا <person>», «عمارة <person>»). They were stored as the card title: on
2026-09-28, 117 of 295 stored titles named an individual. The site itself never displays them; its
modal labels a unit «<unit_type> <unit_no>» and a whole-property offer by its property_type, and
that label is now the title.

Names below are placeholders («فلان»), never a real person. Runs the SHIPPING run.map_listing; only
the DB-backed location helpers are stubbed.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.nufouth import run as R  # noqa: E402

OWNER = "فلان بن علان الفلاني"
PERSON_IN_LABEL = "فلانة"
MSG = {"property": {"code": "H999", "property_type": "عمارة تجارية", "city": "الرياض",
                    "district": "حي الملقا",
                    "name": f"عمارة {PERSON_IN_LABEL} - {OWNER} - 2 F-H999"}}
AD = {"name": "ADV-00001", "ad_type": "ايجار", "status": "نشط", "annual_rent": 90000.0}
UNIT = {"name": f"(4-معرض)-عمارة {PERSON_IN_LABEL} - {OWNER} - 2 F-H999", "unit_type": "معرض",
        "unit_no": "4", "space": 120.0, "annual_rent": "90,000", "details": ""}


def _offline(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (1, 1), raising=False)
    monkeypatch.setattr(R, "resolve", lambda city_ar, **_: {"city_id": 1, "region_id": 1},
                        raising=False)
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: text)


def test_title_is_the_sites_label_and_no_name_is_stored_anywhere(monkeypatch):
    _offline(monkeypatch)
    unit_row, _, why = R.map_listing(MSG, AD, UNIT, "https://nufouth.com/latest-offers?ads-H999=1")
    whole_row, _, why2 = R.map_listing(MSG, dict(AD, custom_sell_property=1), None, "u")
    assert (why, why2) == ("", "")
    assert unit_row["title"] == "معرض 4"            # the site's own tab label for this unit
    assert whole_row["title"] == "عمارة تجارية"      # a whole-property offer: its property_type
    for row in (unit_row, whole_row):
        stored = json.dumps(row, ensure_ascii=False)
        assert OWNER not in stored and PERSON_IN_LABEL not in stored
    # The raw name still feeds the ad identity (hashed, never stored) — so no ad_number changes.
    assert unit_row["ad_number"].endswith(hashlib.sha1(UNIT["name"].encode()).hexdigest()[:8])
