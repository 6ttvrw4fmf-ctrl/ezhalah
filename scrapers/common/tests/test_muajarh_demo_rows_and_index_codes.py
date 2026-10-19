"""Muajarh: 7 of 18 feed rows are the platform's own demo records; dropdown index codes are unknown."""
import pytest

import scrapers.muajarh.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي العارض" if t else None)


def _p(name, value):
    return {"value": value, "facility": {"name_ar": name}}


def _x(**kw):
    x = {"id": 87, "slug": "v", "adv_license": "7201010468", "listing_type": "rent", "title": "فيلا",
         "price": "138000.00", "rent_duration_label_ar": "سنوي", "city": "الرياض", "district": "العارض",
         "category": {"nameEn": "villas", "nameAr": "فلل"},
         "parameters": [_p("المساحة", "255"), _p("المصعد", "1"), _p("الأثاث", "غير مؤثث")]}
    x.update(kw)
    return x


def test_a_row_without_a_rega_licence_is_a_demo_row():
    assert R.map_listing(_x(adv_license=None), {}) == (None, "no_rega_licence_demo_row")


def test_category_is_the_type_and_parameters_are_the_area():
    (row, _), why = R.map_listing(_x(), {})
    assert why == "" and row["property_type"] == "Villa" and row["area_m2"] == 255.0
    assert (row["rent_period"], row["price_annual"]) == ("annual", 138000)


def test_a_bare_index_code_is_unknown_and_a_label_is_read():
    (row, _), _ = R.map_listing(_x(), {})
    assert "elevator" not in row and row["furnished"] is False
