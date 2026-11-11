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


def test_a_bare_singular_year_after_the_age_label_is_one_year():
    # aqarcity_residential_listings:2292614 (2026-11-09 score), the description's real line
    from scrapers.common.new_listings_score import AGE_KW, _cmp_number, norm
    line = norm("المساحة :109 متر مربع. سطح مع غرفة بمساحة 75 متر مربع. عمر العقار: سنة. بناء على الكود السعودي.")
    assert _cmp_number(1, [line], line, AGE_KW) == MATCH
    assert _cmp_number(5, [line], line, AGE_KW) == MISMATCH
    other = norm("المساحة :109 متر مربع. عمر العقار: سنتين.")
    assert _cmp_number(1, [other], other, AGE_KW) != MATCH       # «سنتين» is two, never one


def test_a_singular_year_on_its_own_value_line_is_one_year():
    # CodeRabbit on #11465: a label/value page prints «عمر العقار» / «سنة» on two lines
    from scrapers.common.new_listings_score import AGE_KW, PAGE_SILENT, WE_MISS, _cmp_number, norm
    lines = [norm("المساحة 109"), norm("عمر العقار"), norm("سنة"), norm("غرف النوم")]
    whole = " | ".join(lines)
    assert _cmp_number(1, lines, whole, AGE_KW) == MATCH
    assert _cmp_number(5, lines, whole, AGE_KW) == MISMATCH
    # a stored age we LOST on a page that states one year is our miss, never «page silent»
    one = norm("عمر العقار: سنة.")
    assert _cmp_number(None, [one], one, AGE_KW) == WE_MISS
    assert _cmp_number(None, lines, whole, AGE_KW) == WE_MISS
    blank = norm("عمر العقار: غير محدد")
    assert _cmp_number(None, [blank], blank, AGE_KW) == PAGE_SILENT


def test_a_hidden_feature_block_supplies_no_facade():
    # CodeRabbit on #11465: a feature block inside a not_present section is not shown, so it states nothing
    hidden = ('<div class="not_present"><div class="feature-block"><i class="las la-building"></i>'
              '<h2>واجهة العقار </h2><span>غربية</span></div></div>')
    ev = page_evidence(f"<html><body>{SEARCH_FORM}{FILLER}{hidden}</body></html>")
    assert "واجهة العقار غربية" not in ev["evidence_lines"]
    assert compare_listing({"direction_ar": "غرب"}, ev)["direction_ar"] != MATCH


def test_a_calendar_year_after_the_age_label_is_not_one_year():
    # CodeRabbit on #11465: «عمر العقار: عام 2020» is a date, never an age of one
    from scrapers.common.new_listings_score import AGE_KW, _cmp_number, norm
    for text in ("عمر العقار: عام 2020", "عمر العقار: سنة ٢٠١٩"):
        line = norm(text)
        assert _cmp_number(1, [line], line, AGE_KW) != MATCH
