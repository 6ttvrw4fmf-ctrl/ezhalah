"""ibaax's API publishes the AD's `latitude`/`longitude` on every row and the scraper dropped them («the
listing tables carry no coordinate columns», written before pins lived in additional_info) — 0 of 151
served ads had a pin, and the weekly border-ads check (run 40176694485, 2026-10-25) drew 5 of them as a
border while the source published the pin. Pins live in additional_info for every site
(source_pin.pin_dict); the poster's OFFICE pin under `user` is never the ad's (🔧 2026-10-26).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.common.tests.test_ibaax_pagination_price_period_and_pdpl as T  # noqa: E402
from scrapers.common.tests.test_ibaax_pagination_price_period_and_pdpl import _no_catalog_network  # noqa: E402,F401

R = T.R


def test_the_ads_own_pin_is_stored():
    row, _ = T._row(dict(T.LAND_SALE_CLEAN, latitude="24.9088", longitude="46.6104"))
    assert row["additional_info"]["latitude"] == 24.9088
    assert row["additional_info"]["longitude"] == 46.6104


def test_the_fixture_rows_all_carry_their_published_pin():
    for rec in (T.RENT_SILENT_PII_RICH, T.LAND_SALE_CLEAN, T.STUDIO_TASHKEEL):
        row, _ = T._row(rec)
        assert row["additional_info"].get("latitude") == float(rec["latitude"]), rec["id"]
        assert row["additional_info"].get("longitude") == float(rec["longitude"]), rec["id"]


def test_the_posters_office_pin_is_never_the_ads():
    rec = dict(T.RENT_SILENT_PII_RICH, latitude=None, longitude=None)
    rec["features"] = [f for f in rec.get("features") or [] if f.get("name") not in ("Latitude", "Longitude")]
    row, _ = T._row(rec)
    assert "latitude" not in row["additional_info"], "the agent's office pin under `user` leaked into the ad"


def test_a_zero_or_foreign_pin_is_not_a_pin():
    for la, lo in (("0", "0"), ("51.5", "-0.12")):
        rec = dict(T.LAND_SALE_CLEAN, latitude=la, longitude=lo)
        rec["features"] = [f for f in rec.get("features") or [] if f.get("name") not in ("Latitude", "Longitude")]
        row, _ = T._row(rec)
        assert "latitude" not in row["additional_info"], (la, lo)
