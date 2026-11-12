"""Offline barrier for scrapers/senan/run.py — سنان العقارية's NEW static site (rebuilt 2026-11-12).

The old Nuzul catalogue is gone (all 57 served units 404 on page AND API, measured 2026-11-12). The new site
has nine project pages; the owner decided (2026-11-12) that the six «متاح» projects show, with no price, and
the pre-booking / coming-soon ones do not. Fixtures are the VERBATIM parts of the nine live pages the code
reads (og:image, the #property JSON-LD, the «بيانات المشروع» box), captured 2026-11-12. Every test executes
the REAL parse_project()/map_listing()/_make_signal(); only to_catalog and find_district_in_text are stubbed.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

_sb = types.ModuleType("supabase")
_sb.Client = object
_sb.create_client = lambda *a, **k: None
sys.modules.setdefault("supabase", _sb)
_dv = types.ModuleType("dotenv")
_dv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dv)

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402
from scrapers.senan import run as R  # noqa: E402

FIX = json.loads((Path(__file__).parent / "fixtures" / "senan_projects_2026_11_12.json").read_text(encoding="utf-8"))
PAGES: dict[str, str] = FIX["pages"]
_CATALOG = {"أبها": (15, 6), "أحد رفيدة": (65, 6), "خميس مشيط": (62, 6)}
AVAILABLE = {"apartments-abha", "apartments-rufaidah", "apartments-shifa", "apartments-siyari",
             "ghaim-house", "villas-al-mahala"}
NOT_AVAILABLE = {"upper-mousa", "upper-rooms-raqi", "upper-rufaidah"}


@pytest.fixture(autouse=True)
def _stub_catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, *_a, **_k: _CATALOG.get(c, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: None)


def _map(href: str):
    d = R.parse_project(PAGES[href])
    assert d is not None, href
    return R.map_listing(href, d)


def test_exactly_the_six_available_projects_become_listings():
    rows = {}
    skips = {}
    for href in PAGES:
        row, _cat, why = _map(href)
        slug = href.rsplit("/", 1)[-1][:-5]
        if row:
            rows[slug] = row
        else:
            skips[slug] = why
    assert set(rows) == AVAILABLE
    assert set(skips) == NOT_AVAILABLE
    # pre-booking and coming-soon are off-plan: skipped with the page's own words, never shown
    assert skips["upper-rooms-raqi"] == "status_حجز مسبق_PreOrder"
    assert skips["upper-rufaidah"] == "status_قريباً_PreOrder"


def test_every_row_is_a_sale_with_the_sources_own_silence_as_price():
    for href in PAGES:
        row, cat, _ = _map(href)
        if not row:
            continue
        assert cat == "residential"
        assert row["transaction_type"] == "Buy"
        assert row["price_total"] is db.AUTHORITATIVE_NULL, "no number is ever invented"
        assert "مستشار المبيعات" in (row["additional_info"]["printed_price_note"] or "")
        assert row["listing_url"] == f"{R.BASE}/{href}"
        assert row["ad_number"] == f"SNN-{href.rsplit('/', 1)[-1][:-5]}"


def test_type_city_area_and_photo_come_from_the_page():
    abha, _, _ = _map("projects/apartments-abha.html")
    assert (abha["property_type"], abha["city_ar"], abha["neighborhood"], abha["area_m2"]) == \
        ("Apartment", "أبها", "وسط المدينة", 225)
    assert abha["photo_urls"] == ["https://senanrealestate.sa/assets/img/p09.jpg"]
    villas, _, _ = _map("projects/villas-al-mahala.html")
    assert (villas["property_type"], villas["area_m2"]) == ("Villa", 430)
    # «وحدات سكنية» is generic: the page's own JSON-LD @type (Apartment) decides
    ghaim, _, _ = _map("projects/ghaim-house.html")
    assert ghaim["property_type"] == "Apartment"
    assert ghaim["additional_info"]["type_ar"] == "وحدات سكنية"
    rufaidah, _, _ = _map("projects/apartments-rufaidah.html")
    assert (rufaidah["city_ar"], rufaidah["city_id"]) == ("أحد رفيدة", 65)


def test_status_and_availability_must_both_say_available():
    page = PAGES["projects/apartments-abha.html"]
    assert _map("projects/apartments-abha.html")[0] is not None
    # visible «متاح» but the offer says PreOrder → skipped
    d = R.parse_project(page.replace("https://schema.org/InStock", "https://schema.org/PreOrder"))
    assert R.map_listing("projects/apartments-abha.html", d)[0] is None
    # offer InStock but the visible status changed → skipped
    d = R.parse_project(page.replace("<b>متاح</b>", "<b>مباع</b>"))
    assert R.map_listing("projects/apartments-abha.html", d)[0] is None


def test_a_page_that_does_not_say_for_sale_is_not_guessed():
    page = PAGES["projects/apartments-abha.html"].replace("عقار للبيع", "عقار")
    row, _, why = R.map_listing("projects/apartments-abha.html", R.parse_project(page))
    assert row is None and why == "purpose_unstated"


def test_removal_signal():
    href = "projects/apartments-abha.html"
    url = f"{R.BASE}/{href}"
    sig = R._make_signal(url)
    page = PAGES[href]
    assert sig(404, "<html>This Page Does Not Exist</html>", False) == "gone"
    assert sig(200, page, False) == "live"
    assert sig(200, page.replace("<b>متاح</b>", "<b>حجز مسبق</b>"), False) == "gone"
    assert sig(200, page.replace("https://schema.org/InStock", "https://schema.org/SoldOut"), False) == "gone"
    # a 200 for another project, or with no property JSON-LD, says nothing about THIS page
    assert sig(200, PAGES["projects/villas-al-mahala.html"], False) is None
    assert sig(200, "<html><title>سنان العقارية</title></html>", False) is None
    assert sig(500, "", False) is None
    assert sig(403, "", False) is None


def test_index_is_complete_only_when_the_sitemap_agrees():
    hrefs = R.project_hrefs(FIX["projects_html_links"])
    assert len(hrefs) == 9
    assert R.sitemap_projects(FIX["sitemap_locs"]) == set(hrefs)
    assert R.sitemap_projects(FIX["sitemap_locs"].replace("ghaim-house", "x")) != set(hrefs)


def test_the_more_projects_cards_never_leak_into_this_page():
    # the specs box is read only above «MORE PROJECTS», where other projects' cards repeat their own facts
    page = PAGES["projects/apartments-abha.html"] + '<div><span>الحالة</span><b>حجز مسبق</b></div>'
    d = R.parse_project(page)
    assert d["specs"]["الحالة"] == "متاح"
