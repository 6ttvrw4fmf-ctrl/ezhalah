"""abaad's API publishes `latitude`/`longitude` on every listing and the scraper dropped them («the listing
tables carry no coordinate columns») — 0 of 458 served ads had a pin. Pins live in additional_info for every
site (source_pin.pin_dict), so they are stored now; 0,0 / outside Saudi Arabia is refused (owner #819, 2026-10-24).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.common.tests.test_abaad_land_ppm_rent_period_and_pdpl as T  # noqa: E402
from scrapers.common.tests.test_abaad_land_ppm_rent_period_and_pdpl import _no_catalog_network  # noqa: E402,F401

R = T.R


def test_the_api_pin_is_stored():
    row, _ = T._row(dict(T.LAND_SALE, latitude="24.7743", longitude="46.6214"))
    assert row["additional_info"]["latitude"] == 24.7743
    assert row["additional_info"]["longitude"] == 46.6214


def test_a_zero_or_foreign_pin_is_not_a_pin():
    for la, lo in (("0", "0"), ("51.5", "-0.12"), (None, None)):
        row, _ = T._row(dict(T.LAND_SALE, latitude=la, longitude=lo))
        assert "latitude" not in row["additional_info"], (la, lo)
