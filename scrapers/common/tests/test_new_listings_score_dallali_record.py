"""dallali (2026-10-23): the ad page is a client-rendered shell with no ad text, so a template «إيجار» scored
20007459 («شقة للبيع في حي قرطبة», REGA advertisementType «بيع», listing_type sale) a deal MISMATCH and capped the
night at 5 on one ad (re-read run 39944419156: page title «دلّالي | نظام إدارة العقارات…»). The score now reads the
storefront's own JSON feed record. Record fields below are the stored source_capture of 20007459, verbatim."""
import scrapers.common.new_listings_score as S
from scrapers.common.new_listings_score import MATCH, MISMATCH, dallali_page, score_site
from scrapers.common.tests.test_new_listings_score import FakeClient

UUID = "02ae435d-5b29-4796-8a9f-0ecf5aec07a6"
URL = f"https://dallali.com/advertisements/property/{UUID}"
REC = {"id": UUID, "listing_type": "sale", "price": 1050000, "title": "🏡 شقة للبيع في حي قرطبة | مشروع الأرجان",
       "description": "فرصة لامتلاك شقة بمساحة 205م² في مشروع الأرجان بحي قرطبة",
       "rega_display_data": {"advertisementType": "بيع", "propertyType": "شقة", "propertyArea": 205.29,
                             "numberOfRooms": 3, "streetWidth": 0,
                             "location": {"city": "الرياض", "region": "منطقة الرياض", "district": "قرطبة"}}}
SHELL = (200, "<html><head><title>دلّالي | نظام إدارة العقارات والوساطة العقارية في السعودية</title></head>"
              "<body>بيع · إيجار · إدارة أملاك</body></html>")
STORED = {"source_table": "dallali_residential_listings", "listing_id": 20007459, "platform": "dallali",
          "city_ar": "الرياض", "district_ar": "حي قرطبة", "deal_ar": "بيع", "type_ar": "شقة",
          "price_total": 1050000, "area_m2": 205, "bedrooms": 3}


def _client(stored):
    return FakeClient({"search_listings_ar": [stored],
                       "dallali_residential_listings": [{"id": 20007459, "listing_url": URL}]})


def setup_function(_):
    S._DALLALI_RECORDS = None


def test_the_record_decides_and_the_sale_matches():
    row = score_site(_client(STORED), "dallali", [("dallali_residential_listings", 20007459)], night="2026-10-23",
                     pace=0, probe=lambda u: SHELL, dallali=lambda u: dallali_page(u, fetch=lambda: [REC]))
    assert row["decided_ads"] == 1 and row["normal_mismatch"] == 0, row["fields"]
    assert row["fields"]["deal"][MATCH] == 1


def test_a_wrong_deal_is_still_caught():
    row = score_site(_client({**STORED, "deal_ar": "إيجار"}), "dallali", [("dallali_residential_listings", 20007459)],
                     night="2026-10-23", pace=0, probe=lambda u: SHELL,
                     dallali=lambda u: dallali_page(u, fetch=lambda: [REC]))
    assert row["fields"]["deal"][MISMATCH] == 1


def test_an_id_missing_from_the_feed_is_unreadable_never_wrong():
    assert dallali_page(URL, fetch=lambda: []) is None
    S._DALLALI_RECORDS = None
    assert dallali_page(URL, fetch=lambda: (_ for _ in ()).throw(RuntimeError("blocked"))) is None
