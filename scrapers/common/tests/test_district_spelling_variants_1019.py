"""A spelling of a catalogued district is MAPPED in the site's scraper, never added to the catalog
(contract G, owner 2026-10-17; ops_district_name_decision 'variant', migration batch 10-19).

Measured 2026-10-19 07:35 UTC, ads with NO district although their own district field names a catalogued one:
  · muhaysini  المدينة «أبوكبير» 7 / «أبوبريقاء» 6   → catalog «حي ابو كبير» / «حي ابو بريقاء» (the space)
  · ashab 9 + sadiqeltajer 3  بريدة «المريدسية»   → catalog «حي المريديسية» (the missing ي)

Executed against the REAL mappers (muhaysini map_listing on a captured record, ashab map_page on its page
fixture, sadiqeltajer resolve_district_words) over an injected catalog; nothing touches the network.
Mutation: deleting any one _DISTRICT_SPELLING entry fails its test; an unknown word still stays None.

Run: python -m pytest scrapers/common/tests/test_district_spelling_variants_1019.py -q
"""
from __future__ import annotations

import copy

import pytest

import scrapers.common.tests.test_muhaysini_price_period_and_pdpl as MT   # stubs supabase/dotenv, RECORDS
import scrapers.common.tests.test_ashab_limit_units_and_skips as AT
import scrapers.common.arabic_location as L
import scrapers.ashab.run as A
import scrapers.muhaysini.run as M
import scrapers.sadiqeltajer.run as S

MADINAH, BURAIDAH = 14, 11
CATALOG = {MADINAH: ["حي ابو كبير", "حي ابو بريقاء", "حي شظاة"], BURAIDAH: ["حي المريديسية", "حي الرمال"]}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(L, "_CITY", {"المدينه المنوره": [(MADINAH, 3)], "بريده": [(BURAIDAH, 4)]})
    monkeypatch.setattr(L, "_CID_AR", {MADINAH: "المدينه المنوره", BURAIDAH: "بريده"})
    monkeypatch.setattr(L, "_REGION_NORM", {L.norm_ar("منطقة المدينة المنورة"): 3, L.norm_ar("منطقة القصيم"): 4})
    monkeypatch.setattr(L, "_REGION_AR_FOR", {3: "منطقة المدينة المنورة", 4: "منطقة القصيم"})
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {c: {L.norm_district_tok(d) for d in ds} for c, ds in CATALOG.items()})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_NORM", {L.norm_district_tok(d): d for ds in CATALOG.values() for d in ds})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_CITY",
                        {(c, L.norm_district_tok(d)): d for c, ds in CATALOG.items() for d in ds})
    # Other test modules stub the scrapers' imported resolvers at import time: run the REAL ones here.
    for mod in (A, M, S):
        monkeypatch.setattr(mod, "find_district_in_text", L.find_district_in_text)
    monkeypatch.setattr(A, "to_catalog", L.to_catalog)
    monkeypatch.setattr(M, "to_catalog", L.to_catalog)


def _muhaysini(neighbourhood: str):
    rec = copy.deepcopy(MT.RECORDS["SHOWROOM_RENT_ANNUAL_IN_PROSE"])    # المدينة المنورة, «حي شظاة»
    rec["Neighborhood"]["name"] = neighbourhood
    row, _category, why = M.map_listing(rec)
    assert row is not None, why
    return row["district_ar"], row["neighborhood"]


@pytest.mark.parametrize("word, district", [("أبوكبير", "حي ابو كبير"), ("أبوبريقاء", "حي ابو بريقاء")])
def test_muhaysini_maps_a_glued_abu_spelling(word, district):
    assert _muhaysini(word) == (district, word)          # the card keeps the source's own words


def test_muhaysini_catalogued_and_unknown_words_are_unchanged():
    assert _muhaysini("حي شظاة")[0] == "حي شظاة"
    assert _muhaysini("أبوعروة")[0] is None             # not a mapped spelling: stays unknown, never guessed


def _ashab(loc: str):
    got, why = A.map_page(A.parse_page(AT._page(loc=loc)), "637943", "https://ashab.sa/properties/637943")
    assert got is not None, why
    return got[0]["district_ar"], got[0]["neighborhood"]


def test_ashab_maps_almuraydisiyah():
    assert _ashab("بريدة،المريدسية") == ("حي المريديسية", "المريدسية")
    assert _ashab("بريدة،الرمال")[0] == "حي الرمال"
    assert _ashab("بريدة،الهدية")[0] is None


def test_sadiqeltajer_maps_almuraydisiyah():
    text = "الموقع حسب الصك القصيم - بريدة - المريدسية اعلانات مشابهة"
    assert S.resolve_district_words(text, BURAIDAH) == ("حي المريديسية", "المريدسية")
