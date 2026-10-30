"""new_listings_score: ashab's «عقارات مشابهة» block is other ads (🆕, 2026-10-30, backlog 934).

ashab 21679061 (/properties/502497): the ad's own header badge says «بيع» and we store بيع, but the sibling cards
under «عقارات مشابهة» carry «إيجار» badges, so the scorer read a rent claim and scored the deal MISMATCH
(score run 41009231494, re-read runs 41088522215 / 41088846088).
"""
from scrapers.common import new_listings_score as S

URL = "https://ashab.sa/properties/502497"
BODY = ('<section id="page-title"><span class="badge">بيع</span><span class="badge">متاح</span>'
        '<h4>دور علوي</h4><span>الحد 20000 ر.س</span></section>'
        '<section id="similar-properties"><h3>عقارات مشابهة</h3>'
        '<div class="card"><span class="badge">إيجار</span> شقة للايجار الحد 15000 ر.س</div></section>'
        '<footer>بيع<br>ايجار<br>استثمار</footer>')


def _deal(body):
    page = S.page_evidence(S.scope_to_its_ad(URL, body))
    return S.compare_listing({"deal_ar": "بيع"}, page)["deal"]


def test_sibling_cards_are_not_the_ads_deal():
    assert _deal(BODY) != S.MISMATCH
    assert "إيجار" not in S.scope_to_its_ad(URL, BODY)


def test_the_cut_is_what_made_it_pass():
    # mutation: without the cut the sibling «إيجار» is read as the ad's deal
    assert S.compare_listing({"deal_ar": "بيع"}, S.page_evidence(BODY))["deal"] == S.MISMATCH


def test_other_sites_are_untouched():
    assert S.scope_to_its_ad("https://aqar.fm/ad/1", BODY) == BODY


def test_a_real_rent_on_the_ad_itself_still_mismatches_a_stored_sale():
    own_rent = BODY.replace("<h4>دور علوي</h4>", "<h4>دور علوي للايجار</h4>")
    assert _deal(own_rent) == S.MISMATCH
