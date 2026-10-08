"""dwelleo moved its listing pages on 2026-10-07 (owner session, 8/8 old URLs 404):
/ar/properties/<slug> → /ar/properties/for-{rent|sale}/{type}/{city}/{district}/<slug>.
The card must open the page the site's own sitemap names, and a record with no public page is
never published (its card would open a 404)."""
import pytest

from scrapers.dwelleo import run


@pytest.fixture(autouse=True)
def _offline_catalog(monkeypatch):
    # to_catalog / find_district_in_text read the DB catalog; this test is about the URL only.
    monkeypatch.setattr(run, "to_catalog", lambda *a, **k: (2, 4))
    monkeypatch.setattr(run, "find_district_in_text", lambda *a, **k: "حي البحر")

NEW = ("https://www.dwelleo.sa/ar/properties/for-rent/apartment/khobar/al-bahar/"
       "3-bedroom-apartment-for-rent-in-al-bahar-dist-khobar-48")
SITEMAP = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.dwelleo.sa/en/properties/for-rent/apartment/khobar/al-bahar/3-bedroom-apartment-for-rent-in-al-bahar-dist-khobar-48</loc></url>
  <url><loc> {NEW} </loc></url>
  <url><loc>https://www.dwelleo.sa/ar/projects/some-project</loc></url>
</urlset>"""

REC = {
    "id": 19351, "slug": "3-bedroom-apartment-for-rent-in-al-bahar-dist-khobar-48",
    "status": "publish", "availability": "available", "title": "شقة 3 غرف للإيجار سنوي",
    "listing_type": {"key": "for-rent", "label": "إيجار"}, "property_type": {"name": "شقة"},
    "city": {"name": "الخبر"}, "area": {"name": "حي البحر"}, "price": 70000, "area_sqm": 160,
}


def test_sitemap_maps_slug_to_the_arabic_page():
    urls, children = run.parse_sitemap(SITEMAP)
    assert children == []
    assert urls == {REC["slug"]: NEW}


def test_sitemap_index_yields_children():
    idx = "<sitemapindex><sitemap><loc>https://www.dwelleo.sa/sitemaps/p1.xml</loc></sitemap></sitemapindex>"
    assert run.parse_sitemap(idx) == ({}, ["https://www.dwelleo.sa/sitemaps/p1.xml"])


def test_listing_url_is_the_sitemap_page_never_the_dead_old_shape():
    row, _cat, why = run.map_listing(REC, public_urls=run.parse_sitemap(SITEMAP)[0])
    assert why == "" and row is not None
    assert row["listing_url"] == NEW
    assert row["listing_url"] != f"{run.BASE}/ar/properties/{REC['slug']}"


def test_record_without_a_public_page_is_not_published():
    row, _cat, why = run.map_listing({**REC, "slug": "gone-from-the-site"},
                                     public_urls=run.parse_sitemap(SITEMAP)[0])
    assert row is None and why == "no_public_page"
