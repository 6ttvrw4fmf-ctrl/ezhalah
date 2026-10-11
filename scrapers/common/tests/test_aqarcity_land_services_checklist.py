"""Backlog 325 (owner 2026-10-09): aqarcity's «خدمات العقار» is a structured checklist; on a LAND
«لايوجد خدمات» means electricity/water/sanitation = False, and an unticked utility is False.
Run: python -m pytest scrapers/common/tests/test_aqarcity_land_services_checklist.py -q
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
_sb = types.ModuleType("supabase"); _sb.Client = type("Client", (), {}); _sb.create_client = lambda u, k: None
sys.modules.setdefault("supabase", _sb)

from scrapers.aqarcity.run import land_utilities  # noqa: E402

NONE = {"electricity": False, "water_supply": False, "sanitation": False}


def test_no_services_is_an_explicit_no():
    assert land_utilities("Residential Land", "لايوجد خدمات") == NONE


def test_unticked_is_false_ticked_is_true():
    assert land_utilities("Residential Land", "كهرباء") == {"electricity": True, "water_supply": False, "sanitation": False}
    assert land_utilities("Commercial Land", "كهرباء,مياه,صرف صحي,هاتف") == {
        "electricity": True, "water_supply": True, "sanitation": True}


def test_contradictory_checklist_keeps_what_is_ticked():
    assert land_utilities("Residential Land", "هاتف,كهرباء,صرف صحي,لايوجد خدمات,مياه")["water_supply"] is True


def test_silence_and_non_land_write_nothing():
    assert land_utilities("Residential Land", "") == {}
    assert land_utilities("Residential Land", None) == {}
    assert land_utilities("Apartment", "لايوجد خدمات") == {}
    assert land_utilities(None, "كهرباء") == {}


def test_map_listing_applies_it():
    src = (ROOT / "scrapers" / "aqarcity" / "run.py").read_text(encoding="utf-8")
    assert "amenities.update(land_utilities(mapped_type, checklist))" in src
