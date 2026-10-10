"""Backlog 326 (owner, 2026-10-09): a wasalt LAND's electricityMeter / waterMeter are its
electricity / water_supply. Before this, both columns were NULL on all ~8,300 live wasalt lands
although ~6,300 publish the meters, so a land search for «كهرباء» / «ماء» could not find them.

Pins both producing paths (run.py's row builder and enrich.py's detail update) and the LAND-ONLY
rule: an apartment's «No» is a shared meter, not a home without electricity.

Run: python -m pytest scrapers/common/tests/test_wasalt_land_meters_are_services.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.wasalt.run import land_service_fields, is_land_type  # noqa: E402

_ENRICH_PY = Path(__file__).resolve().parents[1].parent / "wasalt" / "enrich.py"
_RUN_PY = Path(__file__).resolve().parents[1].parent / "wasalt" / "run.py"


def _deep(e, w):
    out = []
    if e is not None:
        out.append({"key": "electricityMeter", "label": "Electricity Meter", "value": e})
    if w is not None:
        out.append({"key": "waterMeter", "label": "Water Meter", "value": w})
    return out


def test_land_yes_yes():
    assert land_service_fields("Residential Land", _deep("Yes", "Yes")) == {"electricity": True, "water_supply": True}


def test_land_no_no_is_an_explicit_no():
    assert land_service_fields("Residential Land", _deep("No", "No")) == {"electricity": False, "water_supply": False}


def test_land_mixed():
    assert land_service_fields("Farming Land", _deep("No", "Yes")) == {"electricity": False, "water_supply": True}


def test_land_silent_is_omitted_not_none():
    assert land_service_fields("Residential Land", []) == {}
    assert land_service_fields("Residential Land", _deep("Yes", None)) == {"electricity": True}
    assert land_service_fields("Residential Land", _deep("maybe", "")) == {}


def test_non_land_never_mapped():
    for t in ("Apartment", "Villa", "Floor", "Building", None, ""):
        assert land_service_fields(t, _deep("No", "No")) == {}
        assert land_service_fields(t, _deep("Yes", "Yes")) == {}


def test_land_type_detection():
    assert is_land_type("Residential Land") and is_land_type("Commercial Land") and is_land_type("Farming Land")
    assert not is_land_type("Landmark Tower") and not is_land_type("Apartment")


def test_both_producing_paths_use_it():
    enrich = _ENRICH_PY.read_text(encoding="utf-8")
    assert 'land_service_fields(row.get("property_type"), deep)' in enrich
    assert "property_type" in enrich.split('.select("ad_number,listing_url')[1].split(")")[0]
    run = _RUN_PY.read_text(encoding="utf-8")
    assert "**land_service_fields(property_type, addl_info)" in run
