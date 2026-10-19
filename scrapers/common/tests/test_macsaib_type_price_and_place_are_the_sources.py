"""Macsaib (Taearif feed): the traps measured at onboarding (2026-09-26), on the REAL scraper functions.

  · price "0" is what the site prints for "not published" → NULL, never a 0-riyal listing.
  · `property_type` is a USAGE class; the TYPE is the category the agency filed it under. No category → skip.
  · a plot is Commercial Land only when the source's own usage says commercial.
  · a district name is never a city: «حي الخضر» must not become the TOWN الخضر (Makkah region).
"""
import pytest

import scrapers.macsaib.run as R

_TOWNS = {"بريدة": (11, 4), "الخضر": (1919, 2)}      # الخضر IS a catalog town — that is the trap


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    import scrapers.common.arabic_location as al
    monkeypatch.setattr(al, "_load", lambda: None)
    lookup = lambda c, region_hint=None: _TOWNS.get((c or "").strip(), (None, None))
    monkeypatch.setattr(al, "to_catalog", lookup)
    monkeypatch.setattr(R, "to_catalog", lookup)
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _p(**kw):
    p = {"id": "1640", "slug": "ard", "title": "ارض سكنية حي السويلميه . مــدينة بريــدة",
         "status": "available", "transactionType_en": "sale", "listing_purpose": None,
         "property_type_en": None, "price": "0", "area": "565", "district": "",
         "location": {"address": "حي السويلمية", "lat": 24.766317}, "images": ["https://x/1.jpg"]}
    p.update(kw)
    return p


def test_a_zero_price_is_unpublished_not_free():
    (row, _), why = R.map_listing(_p(), {}, "أرض")
    assert why == "" and row["price_total"] is None


def test_the_printed_price_is_stored_as_published():
    (row, _), _ = R.map_listing(_p(price="750"), {}, "أرض")
    assert row["price_total"] == 750                      # the page prints 750; no plausibility gate


def test_usage_commercial_makes_commercial_land():
    (row, cat), _ = R.map_listing(_p(property_type_en="commercial"), {}, "أرض")
    assert row["property_type"] == "Commercial Land" and cat == "commercial"


def test_no_category_is_skipped_not_typed_from_the_title():
    got, why = R.map_listing(_p(), {}, None)
    assert got is None and why == "type_unstated_no_category"


def test_a_district_is_never_read_as_a_town():
    assert R.city_of("", "حي الخضر", "أراض للبيع بحي الخضر")[0] is None
    assert R.city_of("", "حي السويلمية", "ارض سكنية حي السويلميه . مــدينة بريــدة")[0] == "بريدة"


def test_the_form_default_pin_is_not_stored():
    (row, _), _ = R.map_listing(_p(), {}, "أرض")
    assert "latitude" not in row["additional_info"]
