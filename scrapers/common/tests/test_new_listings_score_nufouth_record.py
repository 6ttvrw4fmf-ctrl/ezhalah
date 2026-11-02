"""#683 (2026-10-23): nufouth is scored from the ad's own get_property_data record, not the share link's HTML.

The share link («/latest-offers?ads-N5075=1») opens the ad in a JS modal; the static page is the vacancy table of
OTHER units, so every nufouth page was unreadable and the site had 0 decided ads on 10-20, 10-21, 10-22 and 10-23.
The record holds this ad's unit; the ad_number (NFZ<code>A<ad>U<sha1(unit name)[:8]>) picks it.
"""
import hashlib

from scrapers.common.new_listings_score import MATCH, MISMATCH, nufouth_page, score_site
from scrapers.common.tests.test_new_listings_score import FakeClient

UNIT = "(S02-شقة)-عمارة صلة - اليرموك -N5075"
KEY = hashlib.sha1(UNIT.encode("utf-8")).hexdigest()[:8]
AD_NUMBER = f"NFZN5075A01760U{KEY}"
URL = "https://nufouth.com/latest-offers?ads-N5075=1"
MSG = {"property": {"code": "N5075", "city": "الرياض", "district": "حي اليرموك", "property_type": "عمارة"},
       "ads": [{"ad": {"name": "AD-01759", "ad_type": "بيع", "status": "نشط"},
                "units": [{"name": "another unit", "no_of_rooms": 6, "space": 400}]},
               {"ad": {"name": "AD-01760", "ad_type": "ايجار", "status": "نشط"},
                "units": [{"name": "(S01-شقة)", "unit_type": "شقة", "no_of_rooms": 2, "annual_rent": 30000},
                          {"name": UNIT, "unit_type": "شقة", "no_of_rooms": 4, "annual_rent": 45000}]}]}


def test_the_record_restates_this_unit_only():
    page = nufouth_page(URL, AD_NUMBER, fetch=lambda code: MSG if code == "N5075" else None)
    text = " | ".join(page["evidence_lines"])
    assert "عدد الغرف 4" in text and "الإيجار السنوي 45000 ريال" in text and "للايجار" in text
    assert "6" not in text and "30000" not in text and "للبيع" not in text      # the other ad / unit never leak


def test_unknown_unit_or_failed_fetch_is_unreadable_never_wrong():
    assert nufouth_page(URL, "NFZN5075A01760U00000000", fetch=lambda c: MSG) is None
    assert nufouth_page(URL, AD_NUMBER, fetch=lambda c: None) is None
    assert nufouth_page(URL, "NFZN9999A01760U" + KEY, fetch=lambda c: MSG) is None     # another code's number


def test_score_site_decides_nufouth_from_the_record():
    stored = {"source_table": "nufouth_residential_listings", "listing_id": 5, "platform": "nufouth",
              "city_ar": "الرياض", "district_ar": "حي اليرموك", "deal_ar": "إيجار", "type_ar": "شقة",
              "rent_period_ar": "سنوي", "price_annual": 45000, "bedrooms": 4}
    client = FakeClient({"search_listings_ar": [stored],
                         "nufouth_residential_listings": [{"id": 5, "listing_url": URL, "ad_number": AD_NUMBER}]})
    table = lambda url: (200, "<html><body>جدول الشواغر حي المحمدية حي الياسمين حي التعاون 6 غرف</body></html>")
    row = score_site(client, "nufouth", [("nufouth_residential_listings", 5)], night="2026-10-23", pace=0,
                     probe=table, nufouth=lambda u, n: nufouth_page(u, n, fetch=lambda c: MSG))
    assert row["decided_ads"] == 1 and row["normal_mismatch"] == 0
    for f in ("city", "district", "deal", "price", "bedrooms"):
        assert row["fields"][f][MATCH] == 1, f
    wrong = {**stored, "bedrooms": 2}
    client.tables["search_listings_ar"] = [wrong]
    row = score_site(client, "nufouth", [("nufouth_residential_listings", 5)], night="2026-10-23", pace=0,
                     probe=table, nufouth=lambda u, n: nufouth_page(u, n, fetch=lambda c: MSG))
    assert row["fields"]["bedrooms"][MISMATCH] == 1
