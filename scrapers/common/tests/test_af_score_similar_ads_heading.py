"""A «similar ads» HEADING starts other ads (🔬 2026-11-07, af-score night 11-07 vmksa miss).

vmksa 641 (vmksa_residential_listings:13604850, a building for sale) was asked «furnished» from «مؤثثه بالكامل» — the
price line of ad 791, a card under «الاعلانات المشابة». The markup below is copied from the live page (net.http_get
2026-11-07 09:3x UTC, response 9276), trimmed, with the advertiser's phone removed (PDPL)."""
from scrapers.common.af_score import similar_ads_tail, strip_related
from scrapers.common.source_reread import page_evidence

OWN = ('<html><head><title>بناية ٤ أدوار في المدينة المنورة للبيع | المسوق الافتراضي</title></head><body>'
       '<div class="ad-body"><p>عمارة للبيع تتكون من أربعة أدوار وملحق كل دور شقه ٥ غرفه وصاله وعدد ٢ حمام</p>'
       '<p>الغرف والصالة كبيره تبعد عن الحرم 1600 متر</p><p>الموقع بداية مخطط  السديري  السديري بجوار المسجد</p></div>')
SIMILAR = ('<h2 class="building-title ">الاعلانات المشابة</h2><div class="content-section-div"><div class="home-block bg-white '
           'flex mb-2 rounded-lg"><div class="home-details"><a href="/ads/791">بناية للبيع بسعر مناسب في بلجرشي </a>'
           '<ul class="home-discription"><li><i class="las la-money-bill"></i>2500000</li><li><i class="las la-home"></i>عمارة '
           '</li><li><i class="las la-hourglass-half"></i>أقل من سنة</li><li><i class="las la-plug"></i>كهرباء, مياه, صرف صحي'
           '</li></ul><p>SAR 2,500,000.00</p><span class="mb-3">مؤثثه بالكامل السعر غير شامل السعي للتواصل</span></div></div>'
           '</div>')
BODY = OWN + SIMILAR + '<footer>المسوق الافتراضي</footer></body></html>'


def _lines(page):
    return (page.get("evidence_lines") or []) + (page.get("text_head") or "").split(" | ")


def test_the_similar_ads_card_is_not_the_ad():
    page = page_evidence(BODY)
    assert any("مؤثثه" in x for x in _lines(page)), "fixture lost the line the old score read"
    kept = strip_related(page, BODY)
    assert not any("مؤثثه" in x for x in _lines(kept)), _lines(kept)
    assert any("السديري" in x for x in _lines(kept)), "the ad's own words must stay"


def test_without_a_similar_heading_nothing_is_cut():
    body = OWN + '<p>شقة مؤثثه بالكامل</p></body></html>'
    assert similar_ads_tail(body) == ""
    page = page_evidence(body)
    assert any("مؤثثه" in x for x in _lines(strip_related(page, body)))


def test_other_spellings_are_headings_too():
    for h in ("إعلانات مشابهة", "عقارات مشابهة", "الإعلانات المشابهة"):
        assert similar_ads_tail(f"<h3>{h}</h3><p>x</p><footer>") == "<p>x</p>"
    assert similar_ads_tail("<h2>مميزات العقار</h2><p>x</p>") == ""
