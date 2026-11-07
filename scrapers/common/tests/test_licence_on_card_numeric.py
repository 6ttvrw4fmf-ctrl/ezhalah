"""A numeric REGA ad licence reaches the card (🔧 2026-11-07).

rawaf's API sends `adLicenseNumber` as a JSON number. `_licence_on_card` accepted only a str, so the
11-07 08:17 crawl rewrote additional_info on all 19 active rawaf ads without «رقم رخصة الإعلان»
(alert licence_not_on_card:rawaf_residential_listings, 19 of 19). Runs the REAL writer.

Run: python -m pytest scrapers/common/tests/test_licence_on_card_numeric.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db  # noqa: E402


def test_numeric_licence_reaches_the_card():
    row = {"license_number": 7200423552, "additional_info": {"project_id": 114}}
    db._licence_on_card(row)
    assert row["additional_info"]["rega_ad_license_number"] == "7200423552"
    assert row["license_number"] == "7200423552", "the text column must get the same digits"
    assert row["additional_info"]["project_id"] == 114, "the stored panel must survive"


def test_string_licence_still_reaches_the_card():
    row = {"license_number": " 7201026528 ", "additional_info": {}}
    db._licence_on_card(row)
    assert row["additional_info"]["rega_ad_license_number"] == "7201026528"


def test_not_a_licence_is_never_copied():
    for bad in (True, 12345, 72004235521, "N/A", None):
        row = {"license_number": bad, "additional_info": {}}
        db._licence_on_card(row)
        assert "rega_ad_license_number" not in row["additional_info"], bad


def test_a_row_without_additional_info_is_left_alone():
    row = {"license_number": 7200423552}
    db._licence_on_card(row)
    assert "additional_info" not in row, "an upsert replaces the column; inventing one erases the panel"
