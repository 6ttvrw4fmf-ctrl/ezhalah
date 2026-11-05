"""Contract G (owner 2026-10-17): a spelling of a catalogued district is MAPPED in the site's scraper, never added.

🆕 2026-11-05 unknown_named_districts(3) listed four Property Finder names (19 ads). Three are the same place as a
catalogued district of that city, judged by the ads' own pins against that district's served pins:
  الرياض (3) «مطار الملك خالد الدولي» ×7 → «مطار الملك خالد»
  مكة (6) «ريع اذاخر» ×3 → «حي ريع زاخر» · «الهجلة الجديد» ×3 → «حي الهجلة»
The fourth, جدة «درة العروس», is a real place admitted to the catalog (migration, same night).

Executed against the REAL location() over an injected catalog; nothing touches the network.
Mutation: delete any one _DISTRICT_SPELLING entry and its case fails; an unknown word stays None.

Run: python -m pytest scrapers/common/tests/test_propertyfinder_district_spellings_1105.py -q
"""
from __future__ import annotations

import pytest

import scrapers.common.arabic_location as L
from scrapers.propertyfinder import run as R

CITIES = {"الرياض": 3, "مكة المكرمة": 6}
CATALOG = {3: ["مطار الملك خالد", "حي العليا"], 6: ["حي ريع زاخر", "حي الهجلة", "حي العزيزية"]}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "resolve", lambda city, district=None, region_hint=None:
                        {"city_id": CITIES.get(city), "city_ar": city, "region_id": 1})
    monkeypatch.setattr(L, "_CITY", {"_loaded": [(0, 0)]})        # _load() is a no-op once _CITY is set
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {c: {L.norm_district_tok(d) for d in ds} for c, ds in CATALOG.items()})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_CITY",
                        {(c, L.norm_district_tok(d)): d for c, ds in CATALOG.items() for d in ds})


def _rec(city: str, district: str) -> dict:
    return {"location_tree": [{"type": "REGION", "name": "x"}, {"type": "CITY", "name": city},
                              {"type": "DISTRICT", "name": district}],
            "location": {"coordinates": {"lat": 24.95, "lon": 46.63}}}


@pytest.mark.parametrize("city,district,want", [
    ("الرياض", "مطار الملك خالد الدولي", "مطار الملك خالد"),
    ("مكة المكرمة", "ريع اذاخر", "حي ريع زاخر"),
    ("مكة المكرمة", "الهجلة الجديد", "حي الهجلة"),
])
def test_pf_spelling_maps_to_the_catalogued_district(city, district, want):
    loc = R.location(_rec(city, district))
    assert loc["district_ar"] == want
    assert loc["neighborhood"] == district          # the source's own word is kept beside it


def test_catalogued_name_still_matches_directly():
    assert R.location(_rec("مكة المكرمة", "العزيزية"))["district_ar"] == "حي العزيزية"


def test_unknown_word_and_wrong_city_stay_none():
    assert R.location(_rec("مكة المكرمة", "حي لا وجود له"))["district_ar"] is None
    # the Riyadh spelling is scoped to Riyadh: the same words in Makkah are never mapped
    assert R.location(_rec("مكة المكرمة", "مطار الملك خالد الدولي"))["district_ar"] is None
