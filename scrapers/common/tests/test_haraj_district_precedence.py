"""Haraj: the district is the deed's «الحي:», else Haraj's OWN neighbourhood field — never the seller's prose,
never the category tag chain — and the word is kept as the source wrote it (owner 2026-10-18).

544 live rows had no district on 10-18. 11189987502 names THREE places: the tag chain / BreadcrumbList «شقق
للايجار في حي عين الخيف في المدينة», the seller's text «حي البدراني», and REGA's deed «الحي: مذينب» — and Haraj's
own post-neighborhood field says مذينب too. The row was blank only because «مذينب» is not in the catalogue and
the mapper dropped an unattested word. 11189932617 has no deed lines; its tag chain says «حرة الوبرة», Haraj's
field «شوران» (its own title: «شقة للبيع شوران العالية»). Both pages were recorded on 2026-10-18 with every
person / contact line and advertiser number removed (PDPL). Every assertion runs the SHIPPING parser + mapper.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from scrapers.haraj import parse as P
from scrapers.haraj import run as R
from scrapers.haraj.classify import classify

_TD = Path(__file__).resolve().parents[2] / "haraj" / "testdata"
PAGE_DEED = (_TD / "11189987502.excerpt.html").read_text(encoding="utf-8")     # deed «الحي: مذينب»
PAGE_FIELD = (_TD / "11189932617.excerpt.html").read_text(encoding="utf-8")    # no deed; field «شوران»
TODAY = date(2026, 10, 18)
MADINAH, BURAIDAH = 3, 4
CATALOG = {(MADINAH, "شوران")}          # a declared mini-catalogue: «مذينب» is deliberately NOT attested


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    def resolve(city_ar, district_ar=None, region_hint=None):
        cid = {"المدينة": MADINAH, "المدينة المنورة": MADINAH, "بريدة": BURAIDAH}.get(city_ar or "")
        return {"city_id": cid, "region_id": 3 if cid else None}
    monkeypatch.setattr(R, "resolve", resolve)
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: d if (cid, d) in CATALOG else None)


def _ld(name, desc, city="بريدة"):
    return {"@type": "RealEstateListing", "name": name, "description": desc,
            "url": "https://haraj.com.sa/1/x/", "datePosted": "2026-10-10T05:38:40.000Z",
            "address": {"addressLocality": city}, "image": ["https://img4cdn.haraj.com.sa/a.jpg"]}


def _mapped(pid, ld, page):
    v, why = classify(ld.get("name"), P.strip_person_lines(ld.get("description") or ""))
    return R.map_post(pid, ld, page, v, why, today=TODAY)


ANCHOR = '<a data-testid="post-neighborhood" href="/tags/عقار حي {d} في {c}" data-discover="true"><span class="city">{d}</span></a>'
DEED = ("معلومات العقار حسب الرخصة\nغرض الإعلان: بيع\nسعر الوحدة: 1300000\nنوع العقار: فيلا\nمساحة العقار: 418\n"
        "تاريخ انتهاء رخصة الإعلان : 2027-08-31\n-----\nوصف موقع العقار حسب الصك\nالمدينة: بريدة\nالحي: {d}\n")


def test_recorded_11189987502_keeps_the_deeds_own_word_though_the_catalogue_lacks_it():
    ld = P.ld_listing(PAGE_DEED)
    row, _, skip, facts = _mapped("11189987502", ld, PAGE_DEED)
    assert skip == "" and row is not None
    assert (row["neighborhood"], row["district_ar"]) == ("مذينب", "مذينب")
    info = row["additional_info"]
    assert info["district_source"] == "deed" and info["haraj_neighbourhood_ar"] == "مذينب"
    assert "district_catalog_ar" not in info and facts["district_resolved"] is False   # kept, not invented
    assert row["city_ar"] == "المدينة" and row["license_number"] == "7201162767"


def test_recorded_11189932617_without_deed_lines_takes_harajs_own_field():
    ld = P.ld_listing(PAGE_FIELD)
    row, _, skip, facts = _mapped("11189932617", ld, PAGE_FIELD)
    assert skip == "" and row is not None
    assert (row["neighborhood"], row["district_ar"]) == ("شوران", "شوران")
    assert row["additional_info"]["district_source"] == "post_neighbourhood"
    assert row["additional_info"]["district_catalog_ar"] == "شوران" and facts["district_resolved"] is True


@pytest.mark.parametrize("page, chain_word", [(PAGE_DEED, "عين الخيف"), (PAGE_FIELD, "حرة الوبرة")])
def test_mutation_the_category_tag_chain_never_names_the_district(page, chain_word):
    assert chain_word in page                                   # the BreadcrumbList really says it
    row, *_ = _mapped("1", P.ld_listing(page), page)
    assert chain_word not in (row["neighborhood"], row["district_ar"])
    assert P.post_neighbourhood_ar(page) != chain_word


def test_mutation_the_sellers_prose_never_names_the_district():
    # 11189987502's text says «حي البدراني»; an unlicensed post with the same words and NO Haraj field → NULL.
    ld = _ld("شقه للايجار", "شقة للإيجار بريدة - حي البدراني خمس غرف صالة مطبخ\nالحي: البدراني\nالسعر 3500")
    assert P.parse_post(ld, "")["district_ar"] is None
    assert P.parse_post(ld, "")["post_text_district_ar"] == "البدراني"          # captured, never a district
    row, _, skip, _ = _mapped("2", ld, "<html></html>")
    assert skip == "" and row["neighborhood"] is None and row["district_ar"] is None
    assert "district_source" not in row["additional_info"]
    # …and Haraj's own field fills it, as written, with its provenance.
    row, _, skip, _ = _mapped("2", ld, ANCHOR.format(d="الروضة", c="بريدة"))
    assert skip == "" and row["neighborhood"] == "الروضة"
    assert row["additional_info"]["district_source"] == "post_neighbourhood"


def test_the_deed_beats_harajs_own_field_when_they_differ():
    ld = _ld("فيلا للبيع في حي العاصمة", DEED.format(d="العاصمة"))
    p = P.parse_post(ld, ANCHOR.format(d="الروضة", c="بريدة"))
    assert (p["district_ar"], p["district_source"], p["haraj_neighbourhood_ar"]) == ("العاصمة", "deed", "الروضة")


@pytest.mark.parametrize("page, want", [
    (ANCHOR.format(d="مذينب", c="المدينة"), "مذينب"),
    ('<a href="/tags/%D8%B9%D9%82%D8%A7%D8%B1%20%D8%AD%D9%8A%20%D8%B4%D9%88%D8%B1%D8%A7%D9%86%20%D9%81%D9%8A%20'
     '%D8%A7%D9%84%D9%85%D8%AF%D9%8A%D9%86%D8%A9" data-testid="post-neighborhood">شوران</a>', "شوران"),
    ('<a href="/tags/شقق للايجار في حي عين الخيف في المدينة" data-discover="true">x</a>', None),   # the tag chain
    ("", None),
])
def test_post_neighbourhood_reads_only_harajs_own_anchor(page, want):
    assert P.post_neighbourhood_ar(page) == want
