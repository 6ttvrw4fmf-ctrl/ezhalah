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
    mod = importlib.import_module(f"scrapers.{site}.run")
    row, _ = mod.map_listing(_L())
    assert row is not None
    for c in COLS:
        # unknown — since 2026-10-09 the AUTHORITATIVE kind, so the crawl also clears a stored «no»
        assert row[c] is mod.db.AUTHORITATIVE_NULL, f"{site}.{c}: an unfilled block said «no»"


@pytest.mark.parametrize("site", ["aldarim", "abwbna", "alobid", "bahadhabab"])
def test_filled_block_zeros_are_silence_too(site):
    # REPOINTED 2026-10-09 (🔬, backlog 246). This test pinned «a filled block keeps its zeros as real NO». The
    # ad page never prints a 0 (re-read abwbna 36968, aldarim 54267, alobid 40615, bahadhabab 38743, run
    # 37931268959: «مصعد» appears once, in the label dictionary, never as a row; the goldendeal ruling on the same
    # SaaS, 2026-09-23, measured the visible DOM). A 0 the customer never sees is not a statement: it now writes
    # AUTHORITATIVE_NULL, which clears the stored False, and a positive count is still a yes.
    mod = importlib.import_module(f"scrapers.{site}.run")
    row, _ = mod.map_listing(_L(bedrooms=5, bathrooms=4, maid_rooms=1))
    assert row["maid_room"] is True
    for c in ("driver_room", "balcony_terrace"):
        assert row[c] is mod.db.AUTHORITATIVE_NULL, c
    assert False not in [row.get(c) for c in ("kitchen", "maid_room", "driver_room", "balcony_terrace",
                                              "elevator", "parking", "air_conditioner")]


def test_helper_reads_null_as_untouched_and_any_count_as_filled():
    assert N.room_block_unfilled({}) is True
    assert N.room_block_unfilled({"bedrooms": "0", "bathrooms": 0}) is True
    assert N.room_block_unfilled({"bedrooms": 0, "bathrooms": 2}) is False
