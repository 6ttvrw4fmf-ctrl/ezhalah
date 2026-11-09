"""vmksa's own REGA feature block reaches the score (🔬 2026-11-09, backlog 1512).

Markup pasted from the re-read page vm-ksa.com/ar/ads/742 (vmksa_commercial_listings:13604976, net.http_get 10361,
stored direction «شرق», REGA option «واجهة العقار: شرقية»): the site's search form near the top prints the label and a
<select> of every facade; the ad's own block, far below, prints «<h2>واجهة العقار </h2><span>شرقية</span>». Dry run
42593890418 scored 9 of 12 vmksa facades MISMATCH because only the search-form label survived.
"""
from scrapers.common.new_listings_score import MATCH, MISMATCH, compare_listing
from scrapers.common.source_reread import page_evidence

FILLER = "<p>" + ("مكاتب مؤثثة جاهزة للإيجار " * 80) + "</p>"   # pushes the block past text_head's 1,500 characters
SEARCH_FORM = ('<label for="select-options[6][value]">واجهة العقار </label><select name="options[6][value]" '
               'id="select-options[6][value]"><option value="">اختر من القائمة</option><option value="48">شرقية<!-- --> '
               '</option><option value="49">غربية<!-- --> </option><option value="50">شمالية<!-- --> </option>'
               '<option value="51">جنوبية<!-- --> </option></select>')


def block(facade: str) -> str:
    return ('<div class="building-features-grid"><div class="feature-block"><i class="las la-check-square"></i>'
            '<h2>عرض الشارع</h2><span>100</span></div><div class="feature-block"><i class="las la-file-alt"></i>'
            '<h2>رقم صك الملكية</h2><span>20628721029</span></div><div class="feature-block"><i class="las la-building">'
            f'</i><h2>واجهة العقار </h2><span>{facade}</span></div><div class="feature-block"><i class="las la-bullhorn">'
            '</i><h2>مصدر الاعلان</h2><span>الهيئة العامة للعقار</span></div></div>')


def page(facade: str) -> dict:
    return page_evidence(f"<html><body>{SEARCH_FORM}{FILLER}{block(facade)}</body></html>")


def test_the_ads_own_facade_is_an_evidence_line():
    lines = page("شرقية")["evidence_lines"]
    assert "واجهة العقار شرقية" in lines
    assert "عرض الشارع 100" in lines


def test_a_deed_number_is_never_an_evidence_line():
    assert not any("20628721029" in x for x in page("شرقية")["evidence_lines"])


def test_stored_facade_equal_to_the_page_matches_and_a_different_one_does_not():
    assert compare_listing({"direction_ar": "شرق"}, page("شرقية"))["direction_ar"] == MATCH
    assert compare_listing({"direction_ar": "غرب"}, page("شرقية"))["direction_ar"] == MISMATCH
    assert compare_listing({"direction_ar": "جنوب شرق"}, page("جنوبية شرقية"))["direction_ar"] == MATCH


def test_the_old_reader_lost_it():
    # without the pair reader the ad's facade never reaches the score (the 11-09 bug), so the guard is real
    import scrapers.common.source_reread as R
    saved = R._feature_block_lines
    try:
        R._feature_block_lines = lambda body: []
        assert compare_listing({"direction_ar": "شرق"}, page("شرقية"))["direction_ar"] == MISMATCH
    finally:
        R._feature_block_lines = saved
