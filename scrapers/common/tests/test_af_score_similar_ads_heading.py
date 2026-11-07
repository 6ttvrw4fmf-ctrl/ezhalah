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


def test_a_heading_inside_inline_markup_is_a_heading_too():
    # CodeRabbit on #11065: «<h2><span>إعلانات مشابهة</span></h2>»
    body = OWN + SIMILAR.replace('<h2 class="building-title ">الاعلانات المشابة</h2>',
                                 '<h2 class="t"><span>إعلانات <b>مشابهة</b></span></h2>') + '<footer>x</footer></body></html>'
    assert "مؤثثه" in similar_ads_tail(body)
    assert not any("مؤثثه" in x for x in _lines(strip_related(page_evidence(body), body)))


def test_the_ads_own_line_stays_when_a_similar_card_repeats_it():
    # CodeRabbit on #11065: the ad says «مؤثثه بالكامل» itself, and so does a card under the heading
    body = OWN.replace('</div>', '<p>مؤثثه بالكامل السعر غير شامل السعي للتواصل</p></div>', 1) + SIMILAR + '<footer>x</footer></body></html>'
    assert any("مؤثثه" in x for x in _lines(strip_related(page_evidence(body), body)))


def test_the_ads_longer_line_stays_when_a_card_repeats_part_of_it():
    # CodeRabbit (Major) on #11072: card «مؤثثه بالكامل» vs the ad's own «شقة مؤثثه بالكامل للعائلات»
    card = SIMILAR.replace('</div></div></div>', '<span class="tag">مؤثثه بالكامل</span></div></div></div>')
    body = OWN.replace('</div>', '<p>شقة مؤثثه بالكامل للعائلات</p></div>', 1) + card + '<footer>x</footer></body></html>'
    kept = _lines(strip_related(page_evidence(body), body))
    assert any(x.strip() == "شقة مؤثثه بالكامل للعائلات" for x in kept), kept
    assert not any("السعر غير شامل السعي" in x for x in kept), kept   # the card-only line is still dropped


def test_a_script_above_the_heading_does_not_protect_the_cards_line():
    # CodeRabbit (Major) on #11080: the card's phrase inside a pre-heading script is not the ad's own text
    script = '<script>var t = "شقة مؤثثه بالكامل السعر غير شامل السعي للتواصل للعائلات";</script>'
    body = OWN.replace('<div class="ad-body">', script + '<div class="ad-body">', 1) + SIMILAR + '<footer>x</footer></body></html>'
    kept = _lines(strip_related(page_evidence(body), body))
    assert not any("مؤثثه" in x for x in kept), kept
    assert any("السديري" in x for x in kept), kept


def test_the_ads_negated_line_stays_and_the_cards_positive_line_goes():
    # CodeRabbit (Major) on #11080: ad «لا يوجد مطبخ مجهز بالكامل», card «مطبخ مجهز بالكامل»
    card = SIMILAR.replace('</div></div></div>', '<span class="tag">مطبخ مجهز بالكامل</span></div></div></div>')
    body = OWN.replace('</div>', '<p>لا يوجد مطبخ مجهز بالكامل</p></div>', 1) + card + '<footer>x</footer></body></html>'
    kept = [x.strip() for x in _lines(strip_related(page_evidence(body), body))]
    assert "لا يوجد مطبخ مجهز بالكامل" in kept, kept
    assert "مطبخ مجهز بالكامل" not in kept, kept


def test_a_related_ads_block_card_does_not_delete_the_ads_longer_line():
    # CodeRabbit on #11080: the same rule inside «div.related-ads»
    block = '<div class="related-ads"><span>مؤثثه بالكامل السعر غير شامل السعي للتواصل</span></div>'
    body = OWN.replace('</div>', '<p>شقة مؤثثه بالكامل السعر غير شامل السعي للتواصل للعائلات</p></div>', 1) + block + '</body></html>'
    kept = [x.strip() for x in _lines(strip_related(page_evidence(body), body))]
    assert "شقة مؤثثه بالكامل السعر غير شامل السعي للتواصل للعائلات" in kept, kept
    assert "مؤثثه بالكامل السعر غير شامل السعي للتواصل" not in kept, kept
