"""An untouched room block on the aldarim SaaS is SILENCE, not «no» (🔬 AF engineer, 2026-10-05).

aldarim / abwbna / alobid / bahadhabab publish room counts that default to 0 when the advertiser never
fills the block. aldarim 53104 (aldarim_residential_listings:10440427) is a 21M-SAR villa whose block reads
bedrooms 0, bathrooms 0, kitchens 0, maid_rooms 0, driver_rooms 0, while its own description lists
«2 غرفة خادمة», «2غرفة سائق», «مطبخ» (source-reread run 37291383002). We stored kitchen / maid / driver =
FALSE: a customer filtering for a maid room could never find it. A block with ANY non-zero count was
filled in, and its zeros stay real negatives (test_aldarim_kitchen_absence_is_not_false.py is unchanged).

Run: python -m pytest scrapers/common/tests/test_aldarim_saas_unfilled_room_block_is_silence.py -v
"""
from __future__ import annotations

import importlib
import sys

import pytest

sys.path.insert(0, ".")

from scrapers.common import arabic_location as al  # noqa: E402
from scrapers.common import normalize as N  # noqa: E402

COLS = ("kitchen", "maid_room", "driver_room", "balcony_terrace")


@pytest.fixture(autouse=True)
def no_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    monkeypatch.setattr(al, "_CITY", {})
    monkeypatch.setattr(al, "_CID_AR", {})
    monkeypatch.setattr(al, "_REGION_NORM", {})


def _L(**rooms):
    base = {"id": 1, "type": "villa", "purpose": "sale", "category": "residential", "selling_price": 21000000,
            "area": 1500, "city": {"name_ar": "الرياض", "name_en": "Riyadh"}, "district": {"name_ar": "الملقا"},
            "url_path": "x", "bedrooms": 0, "bathrooms": 0, "living_rooms": 0, "kitchens": 0,
            "is_kitchen_installed": 0, "maid_rooms": 0, "driver_rooms": 0, "balconies": 0}
    return {**base, **rooms}


@pytest.mark.parametrize("site", ["aldarim", "abwbna", "alobid", "bahadhabab"])
def test_untouched_block_is_unknown(site):
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(_L())
    assert row is not None
    for c in COLS:
        assert row[c] is None, f"{site}.{c}: an unfilled block said «no»"


@pytest.mark.parametrize("site", ["aldarim", "abwbna", "alobid", "bahadhabab"])
def test_filled_block_keeps_its_real_zeros(site):
    row, _ = importlib.import_module(f"scrapers.{site}.run").map_listing(_L(bedrooms=5, bathrooms=4))
    assert row["maid_room"] is False and row["driver_room"] is False and row["balcony_terrace"] is False


def test_helper_reads_null_as_untouched_and_any_count_as_filled():
    assert N.room_block_unfilled({}) is True
    assert N.room_block_unfilled({"bedrooms": "0", "bathrooms": 0}) is True
    assert N.room_block_unfilled({"bedrooms": 0, "bathrooms": 2}) is False
