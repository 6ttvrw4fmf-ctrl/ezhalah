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
    pg = _page(rec)
    assert "السعر 900000 ريال" in pg["evidence_lines"] and "سعر المتر 1500 ريال" in pg["evidence_lines"]
    assert S.compare_listing({"price_total": 900000}, pg)["price"] == S.MATCH


def test_no_land_total_heads_with_the_property_price():
    pg = _page()
    assert "السعر 1600000 ريال" in pg["evidence_lines"]
    assert not any(x.startswith("سعر المتر") for x in pg["evidence_lines"])


def test_unreadable_is_none():
    assert S.muhaysini_page("https://aqaralmuhaysini.com/propertydetails/1", fetch=lambda _id: None) is None
    assert S.muhaysini_page("https://aqaralmuhaysini.com/other", fetch=lambda _id: REC) is None


def test_deal_word_variants_are_read():
    for word in ("إيجار", "للإيجار", "ايجار"):
        rec = {**REC, "AdValidator": {"advertisement": {**REC["AdValidator"]["advertisement"], "advertisementType": word}}}
        assert "نوع الإعلان للايجار" in _page(rec)["evidence_lines"]
