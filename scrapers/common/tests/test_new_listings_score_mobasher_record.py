"""mobasher is scored from its OWN discovery record, not the seller's prose (🆕 2026-11-10, mobasher cap 83.3 %).

The 11-10 score (job 129653650048) read the one-line description of mobasher_residential_listings:26222806 and scored
our area 300 / bathrooms 5 MISMATCH against «مساحة الأرض: 250 م²» — 300 and 5 are the record's own propertySpace and
bathrooms (source_capture.attributes). 25881325 scored deal and price MISMATCH: the record is a DIRECT_SALE with
askingPrice 3,100,000 and the prose names no price. Fields below are copied from the two stored captures."""
from scrapers.common import new_listings_score as S
from scrapers.common.new_listings_score import MATCH, compare_listing

VILLA_SLUG = "فيلا-سكني-في-عسير-خميس-مشيط-للبيع-1793149517585"
REST_SLUG = "استراحة-سكني-تجاري-في-الرياض-المزاحميه-للبيع-1794177001439"
VILLA = {"listingType": "DIRECT_SALE", "slugAr": VILLA_SLUG, "askingPrice": 980000, "cityNameAr": "خميس مشيط",
         "regionNameAr": "عسير", "neighborhoodNameAr": "الظرفة",
         "searchableAttributes": {"propertyTypeAr": "فيلا", "propertySpace": 300, "bathrooms": 5, "rooms": 5,
                                  "streetWidth": 20, "titleAr": "فيلا سكني في عسير خميس مشيط للبيع",
                                  "summaryAr": "فيلا VIP فاخرة للبيع مواصفات العقار * مساحة الأرض: 250 م². * مسطح البناء: "
                                               "أكثر من 500 م². * عرض الشارع: 20 متراً. * خزان مياه بسعة 42 طناً. "
                                               "* دورتا مياه. * حمام خارجي فاخر."}}
REST = {"listingType": "DIRECT_SALE", "slugAr": REST_SLUG, "askingPrice": 3100000, "cityNameAr": "المزاحميه",
        "regionNameAr": "الرياض", "neighborhoodNameAr": "نوارة",
        "searchableAttributes": {"propertyTypeAr": "استراحة", "propertySpace": 6228, "bathrooms": 0, "rooms": 0,
                                 "streetWidth": 15, "titleAr": "منتجع فاخر",
                                 "summaryAr": "منتجع ريفي فاخر المساحة الإجمالية: 6,228.25 م² على زاوية شارعين بعرض 15م و10م "
                                              "القسم الخاص – مساحة تقارب 4,000 م² والقسم الاستثماري 2,228.28 م² 3 مجالس"}}
URL = "https://mobasher.sa/direct/realestate/"


def _page(slug):
    S._MOBASHER_RECORDS = None
    from urllib.parse import quote
    return S.mobasher_page(URL + quote(slug), fetch=lambda: [VILLA, REST])


def test_the_box_matches_not_the_prose():
    r = compare_listing({"area_m2": 300, "bathrooms": 5, "price_total": 980000, "deal_ar": "بيع"}, _page(VILLA_SLUG))
    assert (r["area"], r["bathrooms"], r["price"], r["deal"]) == (MATCH,) * 4, r


def test_a_wrong_box_value_is_still_wrong():
    r = compare_listing({"area_m2": 250, "bathrooms": 2, "price_total": 900000}, _page(VILLA_SLUG))
    assert MATCH not in (r["bathrooms"], r["price"]), r


def test_the_rest_house_price_and_deal_match():
    r = compare_listing({"price_total": 3100000, "deal_ar": "بيع", "area_m2": 6228}, _page(REST_SLUG))
    assert (r["price"], r["deal"], r["area"]) == (MATCH, MATCH, MATCH), r


def test_an_ad_missing_from_the_list_is_unreadable_not_wrong():
    assert _page("شقة-غير-موجودة-1") is None


def test_a_failed_list_read_is_unreadable_not_wrong():
    S._MOBASHER_RECORDS = None

    def boom():
        raise RuntimeError("403")
    assert S.mobasher_page(URL + "x-1", fetch=boom) is None


# 🆕 2026-11-10 follow-up: the one-line summary is split into its own sentences, so the facade keyword reads only its
# own sentence (26222810's «واجهه 330 15 2009 4 3 6.» was scored against our «جنوب»).
FACADE_SLUG = "فيلا-للبيع-1"
FACADE = {"listingType": "DIRECT_SALE", "slugAr": FACADE_SLUG, "askingPrice": 1200000, "cityNameAr": "الرياض",
          "searchableAttributes": {"propertyTypeAr": "فيلا", "propertySpace": 330, "titleAr": "فيلا للبيع",
                                   "summaryAr": "فيلا مساحة 330 م² على شارع 15 م بناء 2009. * الواجهة: جنوبية. "
                                                "* 4 غرف و 3 دورات مياه و 6 مجالس."}}


def test_the_facade_keyword_reads_its_own_sentence():
    S._MOBASHER_RECORDS = None
    from urllib.parse import quote
    page = S.mobasher_page(URL + quote(FACADE_SLUG), fetch=lambda: [FACADE])
    assert any(x.startswith("الواجهة") and "جنوبية" in x and "330" not in x for x in page["evidence_lines"]), page
    assert compare_listing({"direction_ar": "جنوب"}, page, skip_price=True)["direction_ar"] == MATCH


def test_a_decimal_number_is_not_split():
    S._MOBASHER_RECORDS = None
    from urllib.parse import quote
    page = S.mobasher_page(URL + quote(REST_SLUG), fetch=lambda: [VILLA, REST])
    assert any("6,228.25" in x for x in page["evidence_lines"]), page
