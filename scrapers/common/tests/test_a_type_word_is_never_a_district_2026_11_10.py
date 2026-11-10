"""A bare property-type word is the ad's TYPE, never its district (🔧 2026-11-10).

albdah 85UOh / 36wFU-shaped ads: the page's location line names Buraydah only, and the title fallback read
«شقة للإيجار في بريدة» as Buraydah's catalogued «حي الشقة» (norm_district_tok() drops «ال»). Read live by
source-reread run 42903635386: the page states no district. Three live cards carried it. No network/DB.
"""
from __future__ import annotations

import pytest

from scrapers.common import arabic_location as al
from scrapers.common import db

BURAYDAH = 50


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    monkeypatch.setattr(al, "_load", lambda: None)
    k = al.norm_district_tok
    monkeypatch.setattr(al, "_DISTRICT_BY_CITY", {BURAYDAH: {k("حي الشقة"), k("حي الصفراء")}})
    monkeypatch.setattr(al, "_DISTRICT_AR_BY_NORM", {k("حي الشقة"): "حي الشقة", k("حي الصفراء"): "حي الصفراء"})
    monkeypatch.setattr(al, "_SQUEEZED", {})
    yield


def test_the_type_word_in_a_title_is_not_the_district():
    assert al.find_district_in_text("شقة للإيجار في بريدة", BURAYDAH) is None
    assert al.find_district_in_text("شقه مفروشة للايجار", BURAYDAH) is None


def test_the_district_itself_still_matches_when_the_ad_names_it():
    assert al.find_district_in_text("شقة للإيجار في حي الشقة", BURAYDAH) == "حي الشقة"
    assert al.find_district_in_text("شقة للإيجار بالشقة", BURAYDAH) == "حي الشقة"
    assert al.find_district_in_text("الشقة", BURAYDAH) == "حي الشقة"
    assert al.find_district_in_text("شقة للإيجار في الصفراء", BURAYDAH) == "حي الصفراء"


def test_albdah_clears_a_district_its_page_does_not_state(monkeypatch):
    from scrapers.albdah import run as ab
    monkeypatch.setattr(ab, "to_catalog", lambda c, region_hint=None: (BURAYDAH, 4) if c == "بريدة" else (None, None))
    d = {"deal": "للإيجار", "loc_parts": ["بريدة"], "title": "شقة للإيجار في بريدة", "facts": {}, "rows": [],
         "price": None, "period_text": None, "photo_urls": None, "description": None, "chips": []}
    row, _, why = ab.map_listing("apartment", {**d, "id": "85UOh"})
    assert row, why
    assert row["district_ar"] is db.AUTHORITATIVE_NULL
    # a place the catalogue does not hold (48Ckn «العليا») is no district either — never the title's «شقة»
    row, _, _ = ab.map_listing("apartment", {**d, "id": "48Ckn", "loc_parts": ["بريدة", "العليا"],
                                             "title": "شقة للإيجار في بريدة في العليا"})
    assert row["district_ar"] is db.AUTHORITATIVE_NULL and row["neighborhood"] == "العليا"
    # a page that DOES name a district keeps it
    row, _, _ = ab.map_listing("apartment", {**d, "id": "36wFU", "loc_parts": ["بريدة", "الصفراء"]})
    assert row["district_ar"] == "حي الصفراء"

