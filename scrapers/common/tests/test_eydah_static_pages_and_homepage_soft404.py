"""eydah's traps: two static pages whose ids differ in CASE («EY-1002» / «Ey-1001») on a
case-sensitive host, a JSON-LD whose addressRegion is really the district, the AD licence beside the
broker's FAL licence and telephone, a Farm routed commercial, and a removal oracle where a gone
offer is a 200 serving the HOMEPAGE (whose prose contains the word RealEstateListing).

Fixtures are VERBATIM /offers/<id>.html and /offers/ markup captured 2026-09-24, trimmed to the
blocks the code reads. Assertions run the SHIPPING functions (run.parse_detail, run.map_listing,
run.index_hrefs, run.site_total, run._make_signal, run.main). Offline: only
to_catalog/find_district_in_text and db are stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.eydah import run as R  # noqa: E402

INDEX = '''<p class="lead">2 عرض مرخّص — كل عرض يحمل رقم ترخيص إعلانه ورقم رخصة فال للمعلن، وموقعه بالمدينة والحي ورقم المخطط.</p>
<div class="grid"><a class="card" href="/offers/EY-1002.html"><b>ارض ريفي فاخر</b></a><a class="card" href="/offers/Ey-1001.html"><b>فيلا للبيع</b></a></div>'''

EY_1002 = '''<script type="application/ld+json">
{
 "@context": "https://schema.org",
 "@type": "RealEstateListing",
 "name": "مزرعة للبيع في العمارية، الرياض",
 "description": "ارض ريفي فاخر في حي العمارية منطقة الأستراحات مساحتها 3000 متر مربع",
 "url": "https://eydah.com/offers/EY-1002.html",
 "datePosted": "2026-08-18",
 "image": [
  "https://eydah.com/assets/listings/EY-1002-1.jpg"
 ],
 "identifier": {
  "@type": "PropertyValue",
  "name": "رقم ترخيص الإعلان",
  "value": "7201087899"
 },
 "offers": {
  "@type": "Offer",
  "price": 2550000,
  "priceCurrency": "SAR",
  "availability": "https://schema.org/InStock"
 },
 "address": {
  "@type": "PostalAddress",
  "addressLocality": "الرياض",
  "addressRegion": "العمارية",
  "addressCountry": "SA"
 },
 "floorSize": {
  "@type": "QuantitativeValue",
  "value": 3000,
  "unitCode": "MTK"
 },
 "broker": {
  "@type": "RealEstateAgent",
  "name": "مكتب الإيضاح للخدمات العقارية وإدارة الأملاك",
  "url": "https://eydah.com",
  "telephone": "+966536607155"
 }
}
</script>
      <h2>المواصفات</h2>
      <div class="specs"><div class="spec"><span>نوع العقار</span><b>مزرعة</b></div><div class="spec"><span>الغرض</span><b>بيع</b></div><div class="spec"><span>المدينة</span><b>الرياض</b></div><div class="spec"><span>الحي</span><b>العمارية</b></div><div class="spec"><span>رقم المخطط</span><b>393</b></div><div class="spec"><span>المساحة</span><b>3000 م²</b></div><div class="spec"><span>السعر</span><b>2,550,000 ريال</b></div></div>
        <div class="crow"><span>رقم ترخيص الإعلان</span><b>7201087899</b></div><div class="crow"><span>رخصة فال للمعلن</span><b>1200019127</b></div>
        <a class="btn btn-wa" href="https://wa.me/966536607155?text=%D8%A7%D8%B3%D8%AA%D9%81%D8%B3%D8%A7%D8%B1%20%D8%B9%D9%86%20EY-1002" target="_blank" rel="noopener">استفسر عبر واتساب</a>
        <a class="btn btn-line" href="mailto:sultan@eydah.com?subject=EY-1002">راسلنا بالبريد</a>'''

EY_1001 = '''<script type="application/ld+json">
{
 "@context": "https://schema.org",
 "@type": "RealEstateListing",
 "name": "فيلا للبيع في الملك سلمان، الرياض",
 "description": "الدور الأرضي مجلس رجال ودورة مياه ومغاسل ومقلط صالة كبيرة ودورة مياه ومغاسل ومطبخ  درج داخلي   الدور الأول  جناح مكون من غرفتين مع دورة مياه   جناح غرفة مع دورة مياه   جناح غرفة مع دورة مياه   وصالة    السطح يوجد غرفة و غرفة خادمة مع دورة مياه مع غرفة غسيل ملابس   يوجد حوالي ٨ مكيفات سبلت   يوجد ملحق خارجي ومدخل سيارة",
 "url": "https://eydah.com/offers/Ey-1001.html",
 "datePosted": "2026-08-18",
 "image": [
  "https://eydah.com/assets/listings/Ey-1001-1.jpg"
 ],
 "identifier": {
  "@type": "PropertyValue",
  "name": "رقم ترخيص الإعلان",
  "value": "7201073399"
 },
 "offers": {
  "@type": "Offer",
  "price": 5500000,
  "priceCurrency": "SAR",
  "availability": "https://schema.org/InStock"
 },
 "address": {
  "@type": "PostalAddress",
  "addressLocality": "الرياض",
  "addressRegion": "الملك سلمان",
  "addressCountry": "SA"
 },
 "floorSize": {
  "@type": "QuantitativeValue",
  "value": 500,
  "unitCode": "MTK"
 },
 "broker": {
  "@type": "RealEstateAgent",
  "name": "مكتب الإيضاح للخدمات العقارية وإدارة الأملاك",
  "url": "https://eydah.com",
  "telephone": "+966536607155"
 }
}
</script>
      <div class="specs"><div class="spec"><span>نوع العقار</span><b>فيلا</b></div><div class="spec"><span>الغرض</span><b>بيع</b></div><div class="spec"><span>المدينة</span><b>الرياض</b></div><div class="spec"><span>الحي</span><b>الملك سلمان</b></div><div class="spec"><span>رقم المخطط</span><b>3112-938</b></div><div class="spec"><span>المساحة</span><b>500 م²</b></div><div class="spec"><span>عمر العقار</span><b>12 سنوات</b></div><div class="spec"><span>السعر</span><b>5,500,000 ريال</b></div></div>
        <div class="crow"><span>رخصة فال للمعلن</span><b>1200019127</b></div>'''

# What /offers/EY-9999.html (and the wrong-case /offers/EY-1001.html) actually serve: the homepage.
HOME_SOFT404 = '''<title>الإيضاح | خدمات عقارية وإدارة أملاك في المملكة العربية السعودية</title>
<script type="application/ld+json">
{ "@context":"https://schema.org", "@graph":[ { "@type":"RealEstateAgent", "@id":"https://eydah.com/#org", "name":"مكتب الإيضاح للخدمات العقارية وإدارة الأملاك", "url":"https://eydah.com/" } ] }
</script><p>RealEstateListing feed coming soon</p>'''


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def test_index_is_the_catalogue_and_its_counter_is_the_completeness_check():
    assert R.index_hrefs(INDEX) == ["/offers/EY-1002.html", "/offers/Ey-1001.html"]
    assert R.site_total(INDEX) == 2


def test_farm_sale_reads_jsonld_price_area_and_the_AD_licence_not_the_fal():
    d = R.parse_detail(EY_1002)
    row, cat, why = R.map_listing("/offers/EY-1002.html", d)
    assert why == "" and cat == "commercial" and row["property_type"] == "Farm"
    assert row["ad_number"] == "EYDEY-1002" and row["listing_url"] == "https://eydah.com/offers/EY-1002.html"
    assert row["price_total"] == 2550000 and "rent_period" not in row and row["area_m2"] == 3000
    assert row["license_number"] == "7201087899"
    assert row["additional_info"]["advertiser_fal_licence"] == "1200019127"
    assert row["additional_info"]["printed_price"] == "2,550,000 ريال" and row["additional_info"]["plot_no"] == "393"
    # the district «العمارية» is not a Riyadh catalog district → NULL; the card keeps the source's word
    assert row["city_ar"] == "الرياض" and row["district_ar"] is None and row["neighborhood"] == "العمارية"
    assert row["photo_urls"] == ["https://eydah.com/assets/listings/EY-1002-1.jpg"]


def test_mixed_case_id_keeps_the_exact_url_but_one_identity():
    row, cat, why = R.map_listing("/offers/Ey-1001.html", R.parse_detail(EY_1001))
    assert why == "" and cat == "residential" and row["property_type"] == "Villa"
    assert row["ad_number"] == "EYDEY-1001"                       # identity is case-folded
    assert row["listing_url"] == "https://eydah.com/offers/Ey-1001.html"   # the URL is not (host is case-sensitive)
    assert row["price_total"] == 5500000 and row["property_age"] == 12
    assert row["maid_room"] is True and row["air_conditioner"] is True and row["kitchen"] is True
    assert row["halls"] == 1 and "bedrooms" not in row             # «جناح مكون من غرفتين» is not «N غرف وصالة»


def test_pii_never_leaves_the_page():
    row, _, _ = R.map_listing("/offers/EY-1002.html", R.parse_detail(EY_1002))
    blob = json.dumps(row, ensure_ascii=False)
    assert "536607155" not in blob and "sultan@" not in blob and "telephone" not in blob


def test_unmapped_type_purpose_and_auction_are_skipped():
    d = R.parse_detail(EY_1002.replace("<b>مزرعة</b>", "<b>منزل ريفي</b>"))
    assert R.map_listing("/offers/EY-1002.html", d)[2] == "type_unmapped_منزل ريفي"
    d = R.parse_detail(EY_1002.replace("<span>الغرض</span><b>بيع</b>", "<span>الغرض</span><b>استثمار</b>"))
    assert R.map_listing("/offers/EY-1002.html", d)[2] == "purpose_unmapped_استثمار"
    d = R.parse_detail(EY_1002.replace('"name": "مزرعة للبيع', '"name": "مزاد مزرعة للبيع'))
    assert R.map_listing("/offers/EY-1002.html", d)[2] == "auction"
    d = R.parse_detail(EY_1002.replace('"addressLocality": "الرياض"', '"addressLocality": "القويعية"').replace("<b>الرياض</b>", "<b>القويعية</b>"))
    assert R.map_listing("/offers/EY-1002.html", d)[2] == "city_not_in_catalog"


def test_a_rent_purpose_takes_its_period_only_from_the_printed_price():
    d = R.parse_detail(EY_1002.replace("<span>الغرض</span><b>بيع</b>", "<span>الغرض</span><b>إيجار</b>"))
    row, _, why = R.map_listing("/offers/EY-1002.html", d)
    assert why == "" and row["transaction_type"] == "Rent"
    assert "rent_period" not in row and row["price_annual"] == 2550000        # silent → NULL, figure verbatim
    assert row["additional_info"]["price_note"] is None if "price_note" in row["additional_info"] else True
    d = R.parse_detail(EY_1002.replace("<span>الغرض</span><b>بيع</b>", "<span>الغرض</span><b>إيجار</b>")
                       .replace("<b>2,550,000 ريال</b>", "<b>2,550,000 ريال شهرياً</b>"))
    row, _, _ = R.map_listing("/offers/EY-1002.html", d)
    assert row["rent_period"] == "monthly" and row["price_annual"] == 30600000


def test_signal_a_200_homepage_is_gone_and_only_this_url_is_live():
    sig = R._make_signal("https://eydah.com/offers/EY-1002.html")
    assert sig(200, HOME_SOFT404, False) == "gone"
    assert sig(200, EY_1002, False) == "live"
    assert sig(200, EY_1001, False) is None            # a listing page, but not THIS listing
    assert sig(404, "", False) == "gone" and sig(500, HOME_SOFT404, False) is None and sig(None, "", False) is None
    assert R.parse_detail(HOME_SOFT404) is None


def test_main_tallies_skips_and_prunes_only_on_a_complete_index(monkeypatch):
    calls: dict = {"batches": [], "prune": []}
    pages = {"/offers/EY-1002.html": EY_1002, "/offers/Ey-1001.html": EY_1001,
             "/offers/EY-1003.html": EY_1002.replace("<b>مزرعة</b>", "<b>منزل ريفي</b>")}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_index", lambda s: (list(pages), 3))
    monkeypatch.setattr(R, "fetch_detail", lambda s, href: R.parse_detail(pages[href]))
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls["prune"].append(tbl) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"] == [("eydah_residential_listings", ["EYDEY-1001"]), ("eydah_commercial_listings", ["EYDEY-1002"])]
    assert calls["end"]["rows_seen"] == 3 and calls["end"]["rows_upserted"] == 2
    assert "type_unmapped_منزل ريفيx1" in calls["end"]["notes"] and "complete=True" in calls["end"]["notes"]
    assert calls["prune"] == ["eydah_residential_listings", "eydah_commercial_listings"]
    assert calls["end"]["check_tables"] == ["eydah_residential_listings", "eydah_commercial_listings"]
    calls["prune"].clear()
    monkeypatch.setattr(R, "fetch_index", lambda s: (list(pages), 5))     # site says 5, index lists 3
    assert R.main() == 0 and calls["prune"] == [] and "complete=False" in calls["end"]["notes"]
