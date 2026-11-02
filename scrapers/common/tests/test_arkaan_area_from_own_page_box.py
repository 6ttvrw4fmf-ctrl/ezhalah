"""Arkaan sale duplexes: the area is read from the ad page's own «المساحة» row when the index table omits it.

Backlog 1183 (2026-11-02): AK2440 / AK2438 / AK2432 stored area_m2 NULL. The index table's «المساحة» cell is
absent for them, but their own page labels it in «تفاصيل العقار» — measured on /property/2440 the same day:
  <span class="property-detail-label">المساحة</span> <span class="fw-bold text-dark">230 م<sup>2</sup></span>
A labelled field is read from that box, never from the title's «| 230 م²».
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = object
_supabase_mod.create_client = lambda url, key: object()
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.arkaan.run as R  # noqa: E402

R.to_catalog = lambda city_ar, region_hint=None: ((3677, 5) if city_ar else (None, None))
R.catalog_district = lambda *a, **k: None   # the district catalog is live-DB infrastructure with its own tests

# Trimmed from the real /property/2440 page (2026-11-02); the title also says «| 230 م²», which is NOT the source used.
PAGE = """<html><head><title>شقة دبلكسية للبيع في حي الدانة بالهفوف | 230 م² | مكتب أركان العقار</title></head><body>
<div><span class="property-detail-label">نوع العقار</span> <span class="fw-bold text-dark">شقة دبلكسية للبيع</span></div>
<div><span><i class="bi bi-aspect-ratio"></i></span> <span class="property-detail-label">المساحة</span> <span class="fw-bold text-dark">230 م<sup>2</sup></span> </div>
<div><span class="property-detail-label">الشارع</span> <span class="fw-bold text-dark">15 م</span></div>
</body></html>"""


def _detail_from(page: str) -> dict:
    orig = R._get
    R._get = lambda s, url: (200, page)
    try:
        return R.fetch_detail(None, "2440")
    finally:
        R._get = orig


def test_the_own_page_box_area_is_captured():
    assert R._leading_int(_detail_from(PAGE)["area_text"]) == 230


def test_no_box_means_no_area_never_the_title():
    page = PAGE.replace('<span class="property-detail-label">المساحة</span> <span class="fw-bold text-dark">230 م<sup>2</sup></span>', "")
    assert _detail_from(page)["area_text"] is None


def _item(specs):
    return {"id": "2440", "landno": "", "hood": "الدانة بالهفوف", "ptype": "شقة دبلكسية", "deal": "للبيع",
            "status": "active", "specs": specs, "price_text": "490,000",
            "title_text": "شقة دبلكسية للبيع في حي الدانة بالهفوف | 230 م²", "last_updated": "قبل يومين",
            "index_image": None}


def _map(specs, area_text):
    detail = {"http_status": 200, "type_text": "شقة دبلكسية للبيع", "area_text": area_text, "lat": None, "lng": None,
              "ad_text": "للبيع شقة دبلكسية في حي الدانة بالهفوف", "price_card": "السعر 490,000",
              "ld": {"@type": "RealEstateListing", "name": "شقة دبلكسية للبيع", "offers": None, "image": [],
                     "contentLocation": {"address": {"addressLocality": "الأحساء"}}}}
    got = R.map_listing(_item(specs), detail)
    assert got is not None
    return got[0]


def test_map_listing_falls_back_to_the_own_page_area():
    assert _map({"الحي": "الدانة بالهفوف"}, "230 م 2")["area_m2"] == 230


def test_the_index_cell_still_wins_when_present():
    assert _map({"الحي": "الدانة بالهفوف", "المساحة": "250 م²"}, "230 م 2")["area_m2"] == 250


def test_neither_source_leaves_area_null():
    assert _map({"الحي": "الدانة بالهفوف"}, None)["area_m2"] is None
