"""rawaf: the REGA ad licence its API sends as a JSON NUMBER reaches the card (🔧 2026-11-07).

rawaf.ai/api/deals sends adLicenseNumber as a number (7200155702, read live 11-07). db._licence_on_card copies only
a 10-digit STRING onto the card key, so the 11-07 08:17 crawl left all 19 rawaf cards without «رقم رخصة الإعلان».
Runs the REAL map_unit and the REAL card copy. CI runs this file as a script.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db  # noqa: E402
import scrapers.rawaf.run as R  # noqa: E402

# The location catalogue reads the database; this test is about the licence, so pin the city lookup.
R.to_catalog = lambda city_ar, *a, **k: (3, 1)
R.find_district_in_text = lambda *a, **k: None
map_unit = R.map_unit

PROJ = {"projectId": 114, "city": "الرياض", "title": "مساكن أجواء", "district": {"arabicName": "المونسية"},
        "adLicenseNumber": 7200423552}
UNIT = {"type": "APARTMENT", "propertyId": 1114, "price": 1470000, "contractType": "SALE", "area": 178}

got = map_unit(PROJ, UNIT)
assert got, "the unit did not map"
row, _ = got
assert row["license_number"] == "7200423552", f"licence stored as {row['license_number']!r}"
db._licence_on_card(row)
assert row["additional_info"]["rega_ad_license_number"] == "7200423552", "the card would not show it"
for silent in (None, "", False):
    r2, _ = map_unit({**PROJ, "adLicenseNumber": silent}, UNIT)
    assert r2["license_number"] is None, silent
print("✓ rawaf: a numeric ad licence reaches the card")
