"""8Floor: only listed properties — a unit attached to a (off-plan) project is skipped (owner 2026-09-27)."""
import pytest

import scrapers.eightfloor.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي النرجس" if t else None)


def _d(**kw):
    d = {"id": 37238, "availability_status": "available", "projects": [], "purpose": "rent",
         "type": "building_apartment", "rent_price_annually": 70000, "area": 150, "bedrooms": 3,
         "city": {"name_ar": "الرياض"}, "district": {"name_ar": "حي النرجس"}, "has_electricity": True,
         "has_water": False, "whatsapp_number": "+966559240240"}
    d.update(kw)
    return d


def test_the_annual_price_field_is_the_period():
    (row, _), why = R.map_property(_d())
    assert why == "" and (row["rent_period"], row["price_annual"]) == ("annual", 70000)


def test_a_project_unit_is_off_plan_and_skipped():
    assert R.map_property(_d(projects=[{"id": 300833}])) == (None, "project_unit_off_plan")


def test_a_false_flag_is_a_form_default_not_a_no_and_the_phone_is_never_stored():
    (row, _), _ = R.map_property(_d())
    assert row["electricity"] is True and "water_supply" not in row
    assert "559240240" not in str(row)
