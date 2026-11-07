"""new_listings_score: a muhaysini ad is read from the platform's own record (🆕 2026-11-07).

The ad page is a Vue shell (re-read run 42352217629), so the score decided 0 of 10 sampled muhaysini arrivals a night.
"""
from scrapers.common import new_listings_score as S

REC = {"id": "35822", "title": "عمارة للبيع حي اليمامة", "description": "عمارة مكونة من 4 شقق",
       "City": {"name": "الرياض"}, "PropertyType": {"name": "عمارة"},
       "AdValidator": {"advertisement": {"advertisementType": "بيع", "propertyArea": 255, "propertyPrice": 1600000,
                                         "location": {"region": "منطقة الرياض", "city": "الرياض", "district": "اليمامة"}}}}


def _page(rec=REC):
    return S.muhaysini_page("https://aqaralmuhaysini.com/propertydetails/35822", fetch=lambda _id: rec)


def test_the_record_is_the_page():
    pg = _page()
    out = S.compare_listing({"price_total": 1600000, "area_m2": 255, "district_ar": "حي اليمامة",
                             "city_ar": "الرياض", "deal_ar": "بيع"}, pg)
    assert out["price"] == S.MATCH and out["area"] == S.MATCH and out["district"] == S.MATCH


def test_a_wrong_stored_value_still_mismatches():
    assert S.compare_listing({"price_total": 1700000}, _page())["price"] == S.MISMATCH


def test_land_total_is_the_price_and_the_rate_is_the_metre_price():
    rec = {**REC, "AdValidator": {"advertisement": {"advertisementType": "بيع", "propertyArea": 600,
                                                    "propertyPrice": 1500, "landTotalPrice": 900000}}}
    assert S.compare_listing({"price_total": 900000}, _page(rec))["price"] == S.MATCH


def test_unreadable_is_none():
    assert S.muhaysini_page("https://aqaralmuhaysini.com/propertydetails/1", fetch=lambda _id: None) is None
    assert S.muhaysini_page("https://aqaralmuhaysini.com/other", fetch=lambda _id: REC) is None
