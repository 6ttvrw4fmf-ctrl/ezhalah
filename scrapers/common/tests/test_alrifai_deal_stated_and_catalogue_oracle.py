"""alrifai's traps: a deal the listing does not state (4 of 21 titles), a 10-year structural
WARRANTY beside the price, two facades in one sentence, photos that are broken at the source,
and an oracle where a never-held id renders an empty shell while a DE-LISTED id keeps rendering.

Fixtures are VERBATIM HTML segments captured 2026-09-24 from index.php?page=property-detail&id=
104 / 110 / 999 and the catalogue page; assertions run the SHIPPING functions (run.parse_detail,
run.catalogue_ids, run.map_listing, run.verify_gone, run.main). Offline: only to_catalog/
find_district_in_text, run.fetch and db are stubbed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alrifai import run as R  # noqa: E402

BOX_104 = '<div class="about-property col-lg-8 col-md-12 col-sm-12">\n                    <h2>شقة للبيع 5غرف حي البوادي</h2>\n                    <div class="location"><i class="la la-map-marker"></i> جدة - حي البوادي</div>\n                    <ul class="property-info clearfix">\n                        <li><i class="flaticon-dimension"></i> 136 متر مربع</li>\n                        <li><i class="flaticon-bed"></i> 5 غرف</li>\n                        <li><i class="flaticon-bathtub"></i> 3 حمامات</li>\n                        <li><i class="flaticon-sketch"></i> 1 مطبخ</li>\n                        <li><i class="flaticon-car"></i> 1 موقف خاص</li>\n                    </ul>\n                </div>\n                <div class="price-column col-lg-4 col-md-12 col-sm-12">\n                    <span class="title">فقط بـ</span>\n                    <div class="price">630,000 ريال</div>\n                    <!-- New WhatsApp'
CAROUSEL_104 = '<ul class="image-carousel owl-carousel owl-theme">\n                                <li><a href="app/thumbnail.php?i=49e53b787c2ab50ec.jpg&t=offers&f=offers_image1&v=dv" class="lightbox-image" title="Image Caption Here"><img src="app/thumbnail.php?i=49e53b787c2ab50ec.jpg&t=offers&f=offers_image1&v=dv" alt=""></a></li>\n                                <li><a href="app/thumbnail.php?i=8fd55ef613c880fa2.jpg&t=offers&f=offers_image2&v=dv" class="lightbox-image" title="Image Caption Here"><img src="app/thumbnail.php?i=8fd55ef613c880fa2.jpg&t=offers&f=offers_image2&v=dv" alt=""></a></li>\n                                <li><a href="app/thumbnail.php?i=df845a82a36ea2774.jpg&t=offers&f=offers_image3&v=dv" class="lightbox-image" title="Image Caption Here"><img src="app/thumbnail.php?i=df845a82a36ea2774.jpg&t=offers&f=offers_image3&v=dv" alt=""></a></li>\n                                <li><a href="app/thumbnail.php?i=40ba386e0ac61f64a.jpg&t=offers&f=offers_image4&v=dv" class="lightbox-image" title="Image Caption Here"><img src="app/thumbnail.php?i=40ba386e0ac61f64a.jpg&t=offers&f=offers_image4&v=dv" alt=""></a></li>\n                                <li><a href="app/thumbnail.php?i=a19f57354cec43ace.jpg&t=offers&f=offers_image5&v=dv" class="lightbox-image" title="Image Caption Here"><img src="app/thumbnail.php?i=a19f57354cec43ace.jpg&t=offers&f=offers_image5&v=dv" alt=""></a></li>\n                            </ul>'    # the five app/thumbnail.php images the browser cannot render
LOWER_104 = '<h3>الوصف</h3>\n                        <blockquote>شقة امامية غربية جنوبية 5 غرف مشروع 118</blockquote>\n                    </div>\n\n                    <!-- Property Features -->\n                    <div class="property-features">\n                        <h3>مميزات الشقة :</h3>\n                        <ul class="list-style-one">\n                            <li>فقط بـ 630,000</li>\n                            <li>إتحاد ملاك.</li>\n                            <li>ضمان على الهيكل : 10 سنوات.</li>\n                            <li>قريبة من الخدمات.</li>\n                            <li>عمل فرشة نظافة بسماكة 10سم الخرسانة المقاومة .</li>\n                            <li>استخدام الإسمنت المقاوم</li>\n                            <li>عزل القواعد والحمامات وخزان المياه والسطح.</li>\n                            <li>المباني الخارجية والداخلية بلوك أحمر معزول. </li>\n                            <li>خزان مستقل لكل شقة.</li>\n                        </ul>\n                    </div>\n\n                    <!-- Flooring Tabs -->'
PAGE_104 = BOX_104 + CAROUSEL_104 + LOWER_104
BOX_110 = '<div class="about-property col-lg-8 col-md-12 col-sm-12">\n                    <h2>شقة 3 غرف حي البوادي</h2>\n                    <div class="location"><i class="la la-map-marker"></i> جدة - حي البوادي</div>\n                    <ul class="property-info clearfix">\n                        <li><i class="flaticon-dimension"></i> 105 متر مربع</li>\n                        <li><i class="flaticon-bed"></i> 3 غرف</li>\n                        <li><i class="flaticon-bathtub"></i> 3 حمامات</li>\n                        <li><i class="flaticon-sketch"></i> 1 مطبخ</li>\n                        <li><i class="flaticon-car"></i> 1 موقف خاص</li>\n                    </ul>\n                </div>\n                <div class="price-column col-lg-4 col-md-12 col-sm-12">\n                    <span class="title">فقط بـ</span>\n                    <div class="price">490,000 ريال</div>\n                    <!-- New WhatsApp'
LOWER_110 = '<h3>الوصف</h3>\n                        <blockquote>شقة خلفية شرقية جنوبية شمالية 3 غرف مشروع 118</blockquote>\n                    </div>\n\n                    <!-- Property Features -->\n                    <div class="property-features">\n                        <h3>مميزات الشقة :</h3>\n                        <ul class="list-style-one">\n                            <li>فقط بـ 490,000</li>\n                            <li>إتحاد ملاك.</li>\n                            <li>ضمان على الهيكل : 10 سنوات.</li>\n                            <li>قريبة من الخدمات.</li>\n                            <li>عمل فرشة نظافة بسماكة 10سم الخرسانة المقاومة .</li>\n                            <li>استخدام الإسمنت المقاوم</li>\n                            <li>عزل القواعد والحمامات وخزان المياه والسطح.</li>\n                            <li>المباني الخارجية والداخلية بلوك أحمر معزول. </li>\n                            <li>خزان مستقل لكل شقة.</li>\n                        </ul>\n                    </div>\n\n                    <!-- Flooring Tabs -->'
PAGE_110 = BOX_110 + LOWER_110
BOX_999 = '<div class="about-property col-lg-8 col-md-12 col-sm-12">\n                    <h2></h2>\n                    <div class="location"><i class="la la-map-marker"></i> </div>\n                    <ul class="property-info clearfix">\n                        <li><i class="flaticon-dimension"></i>  متر مربع</li>\n                        <li><i class="flaticon-bed"></i>  غرف</li>\n                        <li><i class="flaticon-bathtub"></i>  حمامات</li>\n                        <li><i class="flaticon-sketch"></i>  مطبخ</li>\n                        <li><i class="flaticon-car"></i>  موقف خاص</li>\n                    </ul>\n                </div>\n                <div class="price-column col-lg-4 col-md-12 col-sm-12">\n                    <span class="title">فقط بـ</span>\n                    <div class="price">0 ريال</div>\n                    <!-- New WhatsApp'              # the empty shell a never-held id renders (HTTP 200)
CATALOGUE_SNIPPET = '<h3><a href="index.php?page=property-detail&id=110">شقة 3 غرف حي البوادي</a></h3> <h3><a href="index.php?page=property-detail&id=109">شقة 5غرف للبيع حي البوادي</a></h3> <h3><a href="index.php?page=property-detail&id=104">شقة للبيع 5غرف حي البوادي</a></h3> <h3><a href="index.php?page=property-detail&id=110">شقة 3 غرف حي البوادي</a></h3>'


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (18, 2) if c == "جدة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي البوادي" if t and "البوادي" in t else None)


def test_catalogue_ids_are_deduplicated_in_page_order():
    assert R.catalogue_ids(CATALOGUE_SNIPPET) == ["110", "109", "104"]
    assert R.catalogue_ids("<html>no cards</html>") == []


def test_parse_reads_every_field_by_its_icon_not_its_position():
    d = R.parse_detail(PAGE_104)
    assert d["title"] == "شقة للبيع 5غرف حي البوادي" and d["location"] == "جدة - حي البوادي"
    assert d["info"] == {"dimension": "136 متر مربع", "bed": "5 غرف", "bathtub": "3 حمامات",
                         "sketch": "1 مطبخ", "car": "1 موقف خاص"}
    assert d["price_text"] == "630,000 ريال" and d["description"] == "شقة امامية غربية جنوبية 5 غرف مشروع 118"
    assert "ضمان على الهيكل : 10 سنوات." in d["features"] and d["photo_count"] == 5


def test_price_is_exact_a_sale_and_never_a_rate_unless_the_cell_says_metre():
    row, cat, why = R.map_listing("104", R.parse_detail(PAGE_104))
    assert why == "" and cat == "residential"
    assert row["ad_number"] == "RFI104" and row["listing_url"] == "https://alrifai.com.sa/index.php?page=property-detail&id=104"
    assert row["transaction_type"] == "Buy" and row["price_total"] == 630_000 and row["price_per_meter"] is None
    ppm = R.map_listing("104", {**R.parse_detail(PAGE_104), "price_text": "5,000 ريال للمتر"})[0]
    assert ppm["price_per_meter"] == 5_000 and ppm["price_total"] is None


def test_a_deal_the_listing_does_not_state_is_skipped_not_guessed():
    d = R.parse_detail(PAGE_110)
    assert d["title"] == "شقة 3 غرف حي البوادي" and d["price_text"].endswith("ريال")
    assert R.map_listing("110", d)[2] == "no_deal_stated"
    rent = {**d, "title": "شقة للإيجار 3 غرف"}
    row = R.map_listing("110", rent)[0]
    assert row["transaction_type"] == "Rent" and row["rent_period"] is None
    assert row["price_annual"] == int(d["price_text"].split()[0].replace(",", ""))   # silent → unscaled
    assert R.map_listing("110", {**d, "title": "شقة للبيع او للإيجار"})[2] == "deal_ambiguous"
    # Deal words are whole words: «الربيع» (a district) and «المبيعات» (a sales office) state no deal.
    assert R.map_listing("110", {**d, "title": "شقة 3 غرف حي الربيع"})[2] == "no_deal_stated"
    assert R.map_listing("110", {**d, "description": "شقة قرب مكتب المبيعات"})[2] == "no_deal_stated"
    assert R.map_listing("110", {**d, "title": "شقة بيع 3 غرف"})[0]["transaction_type"] == "Buy"
    assert R.map_listing("110", {**d, "title": "شقة ايجار 3 غرف"})[0]["transaction_type"] == "Rent"


def test_rooms_kitchen_parking_area_and_location_reach_their_columns():
    row = R.map_listing("104", R.parse_detail(PAGE_104))[0]
    assert (row["bedrooms"], row["bathrooms"], row["area_m2"]) == (5, 3, 136)
    assert row["kitchen"] is True and row["parking"] is True
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("جدة", 18, 2)
    assert row["district_ar"] == "حي البوادي" and row["neighborhood"] == "حي البوادي"
    assert row["additional_info"]["project"] == "118"


def test_a_warranty_is_not_an_age_and_two_facades_are_not_a_direction():
    row = R.map_listing("104", R.parse_detail(PAGE_104))[0]
    assert row["property_age"] is None and row["direction"] is None and row["license_number"] is None
    one = R.map_listing("104", {**R.parse_detail(PAGE_104), "description": "شقة شمالية 5 غرف"})[0]
    assert one["direction"] == "شمال"


def test_broken_source_photos_are_not_claimed():
    row = R.map_listing("104", R.parse_detail(PAGE_104))[0]
    assert row["photo_urls"] is None and row["additional_info"]["photo_count_at_source_unrenderable"] == 5


def test_the_empty_shell_is_recognised_and_an_unplaceable_city_skips():
    assert R.parse_detail(BOX_999)["title"] == ""
    assert R.map_listing("999", R.parse_detail(BOX_999))[2] == "empty_shell"
    assert R.map_listing("104", {**R.parse_detail(PAGE_104), "location": "قرية مجهولة - حي كذا"})[2] == "city_not_in_catalog"
    assert R.map_listing("104", {**R.parse_detail(PAGE_104), "title": "سيارة للبيع"})[2] == "type_unmapped"


def _route(pages: dict, catalogue: str, status: int = 200):
    def fetch(s, url):
        if url == R.CATALOGUE:
            return status, catalogue
        pid = url.rsplit("id=", 1)[1]
        return (status, pages.get(pid, BOX_999)) if status == 200 else (status, "")
    return fetch


def test_verify_gone_under_the_law(monkeypatch):
    monkeypatch.setattr(R, "session", lambda: object())
    R._SEEN_THIS_RUN.clear(); R._SEEN_THIS_RUN.update({"104", "109", "110"})
    R._CATALOGUE_CACHE.clear()
    monkeypatch.setattr(R, "fetch", _route({"104": PAGE_104, "62": PAGE_110}, CATALOGUE_SNIPPET))
    verdict, why = R.verify_gone("RFI999")
    assert verdict == "gone" and "empty shell" in why   # shape 1: the never-held id, by the page alone
    assert R.verify_gone("RFI104")[0] == "live"        # full page, listed in the catalogue
    verdict, why = R.verify_gone("RFI62")
    assert verdict == "gone" and "catalogue no longer lists it" in why   # shape 2: needs the catalogue
    R._CATALOGUE_CACHE.clear()
    monkeypatch.setattr(R, "fetch", _route({"62": PAGE_110}, CATALOGUE_SNIPPET, status=403))
    assert R.verify_gone("RFI62")[0] == "unknown"      # blocked: about us, never a death
    R._CATALOGUE_CACHE.clear()
    R._SEEN_THIS_RUN.clear(); R._SEEN_THIS_RUN.add("5555")   # none of this run's ids in the catalogue
    monkeypatch.setattr(R, "fetch", _route({"62": PAGE_110}, CATALOGUE_SNIPPET))
    assert R.verify_gone("RFI62")[0] == "unknown"      # positive control failed → held
    assert R.verify_gone("RFIabc")[0] == "unknown"


def test_main_tallies_every_skip_into_end_run_notes(monkeypatch):
    calls: dict = {"batches": []}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    monkeypatch.setattr(R, "fetch", _route({"104": PAGE_104, "110": PAGE_110}, CATALOGUE_SNIPPET))
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls.setdefault("pruned", []).append(tbl) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"][0] == ("alrifai_residential_listings", ["RFI104"])
    assert calls["end"]["rows_seen"] == 3 and calls["end"]["rows_upserted"] == 1
    assert "no_deal_statedx1" in calls["end"]["notes"] and "empty_shellx1" in calls["end"]["notes"]
    assert calls["end"]["check_tables"] == ["alrifai_residential_listings", "alrifai_commercial_listings"]
    assert calls["pruned"] == ["alrifai_residential_listings", "alrifai_commercial_listings"]
