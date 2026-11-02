"""new_listings_score: a safa unit is scored from its OWN card and sheet (🆕, 2026-10-30, backlog 1087).

safa has no page per unit. Its stored link is a shared list page (/project/units/58?page=1&property_id=14144)
that carries 21 OTHER units, and the unit's rooms live only in the POST /unit/details sheet. 21671007 (3 rooms)
scored bedrooms MISMATCH against «عدد الغرف 1» of a co-working unit on that list and capped the 10-30 night at
5 (score run 41009231494, re-read run 41088522215).
"""
from scrapers.common import new_listings_score as S

URL = "https://safainv.sa/project/units/58?page=1&property_id=14144"
CARD = ('<i class="fa fa-key mainColor mx-1"></i> للبيع</span>'
        '<span class="type mx-1 justify-content-center">شقة</span>'
        '<div class="location d-flex align-items-center">الرياض - الازدهار</div>')
POPUP = ('<h3 class="unit_title">صفا 58 - A12</h3>'
         '<span class="ar-label">إجمالي المساحة</span> <span class="ar-value">208.15</span>'
         '<div class="feature_box">3 غرف</div><div class="feature_box">3 دورة المياه</div>'
         '<div class="total"><h3 id="total_price">1,501,390</h3></div>')
LIST_PAGE = ('<div>وحدات للإيجار</div><div>مساحة عمل مشتركه</div><div>عدد الغرف 1</div>'
             '<div>للبيع</div><div>208.15 م² 1,501,390</div>')
STORED = {"deal_ar": "بيع", "type_ar": "شقة", "bedrooms": 3, "area_m2": 208, "price_total": 1501390}


def test_the_units_own_sheet_states_its_rooms():
    page = S.safa_page(URL, fetch=lambda u, uid: (CARD, POPUP) if uid == "14144" else (None, None))
    assert page is not None
    res = S.compare_listing(STORED, page)
    assert res["bedrooms"] == S.MATCH
    assert S.MISMATCH not in res.values(), res


def test_the_shared_list_page_is_what_misread_it():
    # mutation: scoring the list page (the old path) reads another unit's «عدد الغرف 1»
    assert S.compare_listing(STORED, S.page_evidence(LIST_PAGE))["bedrooms"] == S.MISMATCH


def test_an_unreadable_sheet_is_unknown_never_wrong():
    assert S.safa_page(URL, fetch=lambda u, uid: (CARD, None)) is None
    assert S.safa_page("https://safainv.sa/units/rental?page=1", fetch=lambda u, uid: (CARD, POPUP)) is None


def test_score_site_routes_safa_to_its_own_reader():
    import inspect
    src = inspect.getsource(S.score_site)
    assert '"safainv.sa" in url' in src and "safa_page" in src
