"""razre (www.razre.sa) after the 2026-10-20 rebuild — the things that would silently break it.

The fixture is the raz-55 project page as CI read it on 2026-10-23 (probe job 120413670468), trimmed
to its three machine-readable blocks: the units JSON, the site config and the LD-JSON graph. Every
assertion executes the SHIPPING functions in scrapers.razre.run — never a copy of them.

Guarded, and why each is a real defect on this site:
1. Only an AVAILABLE unit of a SELLING project is published; sold / reserved units and soon /
   sold_out projects skip with their own counted reason (raz-55 lists 29 sold units beside 17 free).
2. The price is the source's own figure, never computed; a null price is an AUTHORITATIVE_NULL.
3. No rent: rent_period / price_annual are never written.
4. rooms is TOTAL rooms, never bedrooms; «الجهة» never becomes a compass direction.
5. The city comes from the project's own LD addressLocality, never from the district.
6. The removal oracle: absence kills only when the page's unit list is COMPLETE against its own
   LD numberOfAccommodationUnits; a Wix-era redirect shell is UNKNOWN, never a kill.
7. PDPL: the page's phone / WhatsApp never reach a row; a phone planted in a unit field is redacted.

Run: python -m pytest scrapers/common/tests/test_razre_price_status_identity_and_pdpl.py -v
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.common.arabic_location as _al  # noqa: E402
from scrapers.common import db  # noqa: E402
from scrapers.razre import run as R  # noqa: E402

_JEDDAH, _REGION = 18, 2          # loc_catalog_city, read from production 2026-09-24
_DISTRICTS = ["حي السلامة", "حي المنار", "حي النسيم", "حي النخيل", "حي النهضة"]


@pytest.fixture(autouse=True)
def _seed(monkeypatch):
    """The real catalog rows for Jeddah, so to_catalog / find_district_in_text run for real."""
    monkeypatch.setitem(_al._CITY, _al.norm_ar("جدة"), [(_JEDDAH, _REGION)])
    monkeypatch.setitem(_al._REGION_NORM, _al.norm_ar("مكة المكرمة"), _REGION)
    monkeypatch.setitem(_al._CID_AR, _JEDDAH, "جدة")
    monkeypatch.setitem(_al._DISTRICT_BY_CITY, _JEDDAH,
                        {_al.norm_district_tok(d) for d in _DISTRICTS})
    for d in _DISTRICTS:
        monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
        monkeypatch.setitem(_al._DISTRICT_AR_BY_CITY, (_JEDDAH, _al.norm_district_tok(d)), d)
    monkeypatch.setattr(_al, "_load", lambda: None)

URL = "https://www.razre.sa/projects/raz-55/"

UNITS = [
    ["u23", "55", 1, "الأول", "B1", "apartment", 106, 3, 3, 1, "أمامية", None, "B", "available", 583000],
    ["u24", "55", 1, "الأول", "C1", "apartment", 80, 2, 2, 1, "خلفية", None, "C", "sold", None],
    ["u26", "55", 1, "الأول", "E1", "apartment", 85, 2, 2, 1, "خلفية", None, "E", "available", 445000],
    ["u90", "55", 7, "السابع", "R1", "annex", 120, 3, 2, 1, "أمامية", None, "R", "reserved", None],
]
PROJECT = {"slug": "raz-55", "name_ar": "راز 55", "name_latin": "RAZ 55", "district": "حي السلامة",
           "path": "/projects/raz-55/", "tour": None}
CONFIG = {"env": "production", "base": "https://www.razre.sa", "page": "project", "phone": "920031661",
          "whatsapp": "966920031661",
          "lead": {"endpoint": "/api/lead", "projects": [
              {"s": "raz-55", "n": "راز 55", "d": "حي السلامة", "st": "selling"},
              {"s": "raz-35", "n": "راز 35", "d": "حي الروضة", "st": "soon"},
              {"s": "raz-10", "n": "راز 10", "d": "حي المنار", "st": "sold_out"}]}}
LD = [{"@context": "https://schema.org", "@graph": [
    {"@type": "RealEstateListing", "@id": URL + "#webpage", "url": URL},
    {"@type": "ApartmentComplex", "@id": URL + "#place", "name": "راز 55", "url": URL,
     "image": ["https://www.razre.sa/media/gemigbpkafeclfgj/1200.jndiihldda.webp",
               "https://www.razre.sa/media/pndndkeimhjaedgp/1200.kbhoedbhon.webp"],
     "address": {"@type": "PostalAddress", "addressLocality": "جدة",
                 "addressRegion": "منطقة مكة المكرمة", "addressCountry": "SA"},
     "geo": {"@type": "GeoCoordinates", "latitude": 21.582453, "longitude": 39.153981},
     "hasMap": "https://maps.app.goo.gl/D8XFbn92Ko8gnuPP9",
     "numberOfAccommodationUnits": {"@type": "QuantitativeValue", "value": 4},
     "amenityFeature": [{"@type": "LocationFeatureSpecification", "name": "مصعد", "value": True}]},
    {"@type": "Place", "@id": "https://www.razre.sa/districts/al-salamah/#place",
     "geo": {"@type": "GeoCoordinates", "latitude": 21.59955, "longitude": 39.15261}}]}]


def page_html(units=None, project=None, config=None, ld=None) -> str:
    data = {"project": project or PROJECT, "units": UNITS if units is None else units}
    return ("<!doctype html><html><head>"
            f'<script type="application/ld+json">{json.dumps(ld or LD, ensure_ascii=False)}</script>'
            "<script>document.documentElement.className='js'</script>"
            f'<script type="application/json" id="site-config">{json.dumps(config or CONFIG, ensure_ascii=False)}</script>'
            "</head><body><a href=\"tel:920031661\">اتصل</a>"
            f'<script type="application/json" id="pj-data">{json.dumps(data, ensure_ascii=False)}</script>'
            "</body></html>")


def mapped(html=None):
    page = R.parse_project_page(html or page_html())
    out = [R.map_listing(u, page, URL) for u in page["units"]]
    return page, out


def test_the_page_parses_into_project_units_status_and_complex():
    page = R.parse_project_page(page_html())
    assert page["project"]["slug"] == "raz-55" and len(page["units"]) == 4
    assert page["status"] == "selling"
    assert page["complex"]["@type"] == "ApartmentComplex"
    assert R.declared_units(page) == 4 and R.page_lists_every_unit(page)


def test_only_available_units_are_published_and_each_skip_names_its_reason():
    _, out = mapped()
    rows = [r for r, _, _ in out if r]
    assert [r["ad_number"] for r in rows] == ["RAZ-raz-55-u23", "RAZ-raz-55-u26"]
    assert [why for r, _, why in out if not r] == ["unit_sold", "unit_reserved"]


@pytest.mark.parametrize("st, reason", [("soon", "off_plan_project"), ("sold_out", "project_sold_out"),
                                        ("paused", "project_status_unknown_paused")])
def test_a_project_that_is_not_selling_publishes_nothing(st, reason):
    cfg = copy.deepcopy(CONFIG)
    cfg["lead"]["projects"][0]["st"] = st
    _, out = mapped(page_html(config=cfg))
    assert all(r is None for r, _, _ in out)
    assert {why for _, _, why in out} == {reason}


def test_a_page_without_the_config_never_reads_a_project_as_selling():
    cfg = copy.deepcopy(CONFIG)
    cfg["lead"]["projects"] = []
    _, out = mapped(page_html(config=cfg))
    assert {why for _, _, why in out} == {"project_status_unknown_blank"}


def test_the_price_is_the_sources_figure_and_a_null_is_authoritative():
    _, out = mapped()
    r = out[0][0]
    assert r["price_total"] == 583000 and r["price_evidence"]["raw"] == 583000
    units = copy.deepcopy(UNITS)
    units[0][14] = None
    _, out = mapped(page_html(units=units))
    r = out[0][0]
    assert r["price_total"] is db.AUTHORITATIVE_NULL
    assert r["price_evidence"]["authoritative_absent"] is True
    assert "price_annual" not in r and "rent_period" not in r and r["transaction_type"] == "Buy"


def test_rooms_is_total_rooms_and_the_facing_word_is_not_a_direction():
    _, out = mapped()
    r = out[0][0]
    assert "bedrooms" not in r and "direction" not in r
    assert r["additional_info"]["total_rooms"] == 3 and r["bathrooms"] == 3
    assert r["additional_info"]["facing_ar"] == "أمامية"
    assert r["area_m2"] == 106 and r["floor_number"] == 1


def test_the_annex_type_is_the_fleets_floor_mapping_and_an_unknown_type_skips():
    units = copy.deepcopy(UNITS)
    units[0][5] = "annex"
    units[2][5] = "villa"
    _, out = mapped(page_html(units=units))
    assert out[0][0]["property_type"] == "Floor"
    assert out[2] == (None, "residential", "type_unmapped_villa")


def test_the_city_comes_from_the_projects_own_address_never_from_the_district():
    r = mapped()[1][0][0]
    assert r["city_ar"] == "جدة" and r["city_id"] and r["neighborhood"] == "حي السلامة"
    ld = copy.deepcopy(LD)
    del ld[0]["@graph"][1]["address"]
    _, out = mapped(page_html(ld=ld))
    assert out[0] == (None, "residential", "city_unstated")
    ld[0]["@graph"][1]["address"] = {"addressLocality": "الرياض"}
    _, out = mapped(page_html(ld=ld))
    assert out[0] == (None, "residential", "city_unmapped_الرياض")


def test_the_pin_is_the_projects_never_the_district_centre_and_photos_are_its_own():
    r = mapped()[1][0][0]
    assert (r["additional_info"]["latitude"], r["additional_info"]["longitude"]) == (21.582453, 39.153981)
    assert r["photo_urls"] == LD[0]["@graph"][1]["image"]
    assert r["listing_url"] == URL


def test_a_changed_unit_shape_skips_and_a_whole_crawl_of_them_fails_loudly():
    _, out = mapped(page_html(units=[["u1", "55", 1]]))
    assert out == [(None, "residential", "unit_shape_changed")]


def test_a_poisoned_unit_leaks_no_contact_detail_anywhere():
    units = copy.deepcopy(UNITS)
    units[0][4] = "B1 0551234567"
    units[0][10] = "أمامية wa.me/966551234567"
    r = mapped(page_html(units=units))[1][0][0]
    blob = json.dumps(r, ensure_ascii=False, default=str)
    assert "0551234567" not in blob and "966551234567" not in blob
    assert "920031661" not in blob        # the developer's own number printed on the page


def test_sitemap_reads_only_arabic_project_pages():
    xml = ("<urlset><url><loc>https://www.razre.sa/</loc></url>"
           "<url><loc>https://www.razre.sa/projects/</loc></url>"
           "<url><loc>https://www.razre.sa/projects/raz-55/</loc></url>"
           "<url><loc>https://www.razre.sa/en/projects/raz-55/</loc></url>"
           "<url><loc>https://www.razre.sa/districts/al-salamah/</loc></url>"
           "<url><loc>https://www.razre.sa/projects/haven-1/</loc></url>"
           "<url><loc>https://www.razre.sa/projects/raz-55/</loc></url></urlset>")
    assert R.project_urls(xml) == ["https://www.razre.sa/projects/raz-55/",
                                   "https://www.razre.sa/projects/haven-1/"]


# ── the removal oracle ───────────────────────────────────────────────────────────────────────────
def _verdict(uid, status, body):
    return R._signal(uid)(status, body, False)


def test_the_pages_own_unit_status_decides():
    html = page_html()
    assert _verdict("u23", 200, html) == "live"
    assert _verdict("u24", 200, html) == "gone"
    assert _verdict("u90", 200, html) == "gone"


def test_absence_kills_only_on_a_complete_unit_list():
    assert _verdict("u999", 200, page_html()) == "gone"
    ld = copy.deepcopy(LD)
    ld[0]["@graph"][1]["numberOfAccommodationUnits"]["value"] = 46
    assert _verdict("u999", 200, page_html(ld=ld)) is None
    del ld[0]["@graph"][1]["numberOfAccommodationUnits"]
    assert _verdict("u999", 200, page_html(ld=ld)) is None


def test_a_wix_era_redirect_shell_and_an_error_are_unknown_and_a_404_is_gone():
    shell = '<html><head><link rel="canonical" href="https://www.razre.sa/projects/"></head></html>'
    assert _verdict("u23", 200, shell) is None
    assert _verdict("u23", 503, "") is None and _verdict("u23", 403, "") is None
    assert _verdict("u23", 404, "") == "gone"


def test_a_wix_era_ad_number_is_never_probed_into_a_kill():
    assert R._uid("RAZ00e25e19-b39c-40c9-a67f-8b33a709ee1e") == ""
    assert R._uid("RAZ-raz-55-u23") == "u23" and R._uid("RAZ-haven-1-u684") == "u684"
