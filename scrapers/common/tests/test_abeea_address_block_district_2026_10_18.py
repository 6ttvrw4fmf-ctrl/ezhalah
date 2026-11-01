"""abeea: the district is the page's OWN address-block «Area», in Arabic from the page's Arabic twin (2026-10-18).

Rendered that day: /en/property/villa-for-sale-in-qasr-al-khaleej-district/ prints a Houzez address block
«Address: 47/1/3 Street No. 4 · City: Al Dammam · Area: Qasr Al Khaleej», and its hreflang="ar" twin
/ar/property/…/ the same block in Arabic: «المدينة: الدمام · الحي: قصر الخليج». The scraper read the district from
the slug/title only, so ads titled after a compound («Apartment For Rent In 14 Rawas Al Bahar Compound», 70 live
rows) had none, and 30 English names had no Arabic the index could serve. Markup below is the recorded block.
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)

from scrapers.abeea import run as abeea  # noqa: E402


def _block(city, state, area, ar=False):
    lab = ("العنوان:", "المدينة:", "المطقة/الولاية", "الحي:") if ar else ("Address:", "City:", "State/county:", "Area:")
    return ('<div class="property-address-wrap property-section-wrap" id="property-address-wrap" role="region">'
            f'<li class="col-md-6 d-flex justify-content-between"> <strong id="address-label">{lab[0]}</strong> '
            '<span aria-labelledby="address-label">47/1/3 Street No. 4</span> </li>'
            f'<li class="col-md-6 d-flex justify-content-between"> <strong id="city-label">{lab[1]}</strong> '
            f'<span aria-labelledby="city-label">{city}</span> </li>'
            f'<li class="col-md-6 d-flex justify-content-between"> <strong id="state-label">{lab[2]}</strong> '
            f'<span aria-labelledby="state-label">{state}</span> </li>'
            f'<li class="col-md-6 d-flex justify-content-between"> <strong id="area-label">{lab[3]}</strong> '
            f'<span aria-labelledby="area-label">{area}</span> </li></div>')


def _page(name, locality, block, slug_twin="villa-for-sale-in-qasr-al-khaleej-district"):
    return ('<html><head><link rel="alternate" hreflang="ar" '
            f'href="https://abeea.com.sa/ar/property/{slug_twin}/" /></head><body>' + 'x' * 3000 +
            '<script type="application/ld+json">{"@type":"House","name":"' + name + '","address":{"addressLocality":"'
            + locality + '","addressRegion":"Eastern Province"}}</script><ul class="detail-wrap">'
            '<li><strong>Property Status</strong> <span>For Sale</span></li>'
            '<li><strong>Property Type</strong> <span>Villa, Residential</span></li>'
            '<li><strong>Price</strong> <span>SAR 2,500,000</span></li></ul>' + block + '</body></html>')


EN = _page("Villa For Sale In Qasr Al Khaleej District", "Al Dammam", _block("Al Dammam", "Eastern Province", "Qasr Al Khaleej"))
AR = _page("فيلا للبيع في الدمام، حي قصر الخليج", "Al Dammam", _block("الدمام", "الشرقية", "قصر الخليج", ar=True))
URL = "https://abeea.com.sa/en/property/villa-for-sale-in-qasr-al-khaleej-district/"


def test_the_arabic_twin_and_its_area_are_read():
    assert abeea.arabic_twin_url(EN) == "https://abeea.com.sa/ar/property/villa-for-sale-in-qasr-al-khaleej-district/"
    row, _cat, _gone = abeea.map_listing(EN, URL, None, ar_body=AR)
    assert row["neighborhood"] == "قصر الخليج"
    assert row["additional_info"]["district_source"] == "area_label_ar"
    assert row["additional_info"]["district_en"] == "Qasr Al Khaleej"


def test_without_the_twin_the_english_area_then_the_title():
    row, _c, _g = abeea.map_listing(EN, URL, None, ar_body=None)
    assert row["neighborhood"] == "Qasr Al Khaleej" and row["additional_info"]["district_source"] == "area_label"
    compound = _page("Apartment For Rent In 14 Rawas Al Bahar Compound", "Al Khobar",
                     _block("Al Khobar", "Eastern Province", "Al Bahar"))
    row, _c, _g = abeea.map_listing(compound, "https://abeea.com.sa/en/property/apartment-for-rent-in-14-rawas-al-bahar-compound/")
    assert row["neighborhood"] == "Al Bahar"                                # the title names a compound only


def test_the_area_field_holding_the_city_is_not_a_district_and_the_twin_gives_a_missing_city():
    city_only = _page("Residential Land For Sale In Al Qatif", "Al Qatif", _block("Al Qatif", "Eastern Province", "Al Qatif"))
    row, _c, _g = abeea.map_listing(city_only, "https://abeea.com.sa/en/property/residential-land-for-sale-in-al-qatif/")
    assert row["neighborhood"] is None
    typo = _page("Appartment For Rent In Al Qusour District, Al Dharan", "Al Dharan", _block("Al Dharan", "Eastern Province", "Al Qusour"))
    twin = _page("شقة للإيجار في الظهران", "Al Dharan", _block("الظهران", "الشرقية", "القصور", ar=True))
    row, _c, _g = abeea.map_listing(typo, "https://abeea.com.sa/en/property/appartment-for-rent-in-al-qusour-district-al-dharan/", None, ar_body=twin)
    assert row["city"] == "Dhahran" and row["neighborhood"] == "القصور"


def test_the_crawl_fetches_each_pages_arabic_twin_and_hands_it_over(monkeypatch):
    seen, handed = [], []
    monkeypatch.setattr(sys, "argv", ["run"])
    monkeypatch.setattr(abeea.time, "sleep", lambda *_: None)
    monkeypatch.setattr(abeea, "discover_urls", lambda _s: ([URL], {}))
    monkeypatch.setattr(abeea, "fetch_one", lambda u: seen.append(u) or ((AR if "/ar/" in u else EN), u))
    monkeypatch.setattr(abeea, "map_listing", lambda b, u, f, ar_body=None: handed.append(ar_body) or (None, "residential", False))
    monkeypatch.setattr(abeea.db, "begin_run", lambda _slug: 1)
    monkeypatch.setattr(abeea.db, "end_run", lambda _id, **k: True)
    monkeypatch.setattr(abeea.db, "prune_unseen", lambda *a, **k: 0)
    monkeypatch.setattr(abeea.db, "retire_superseded_siblings", lambda **_k: 0)
    monkeypatch.setattr(abeea, "_pin_sold_inactive", lambda *a, **k: None)
    abeea.main()
    assert "https://abeea.com.sa/ar/property/villa-for-sale-in-qasr-al-khaleej-district/" in seen
    assert handed == [AR]
