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


def test_a_single_bearing_does_not_match_a_diagonal_facade():
    # CodeRabbit on #11465: stored «شرق» inside «جنوبية شرقية» is not the same facade
    assert compare_listing({"direction_ar": "شرق"}, page("جنوبية شرقية"))["direction_ar"] == MISMATCH
    assert compare_listing({"direction_ar": "جنوب شرق"}, page("جنوبية شرقية"))["direction_ar"] == MATCH
    assert compare_listing({"direction_ar": "شرق"}, page("شرقية"))["direction_ar"] == MATCH


def test_a_singular_year_value_line_past_text_head_reaches_the_score():
    # CodeRabbit on #11465: «عمر العقار» / «سنة» as sibling elements beyond text_head's 1,500 characters
    p = page_evidence(f"<html><body>{FILLER}<div>عمر العقار</div><div>سنة</div></body></html>")
    assert "عمر العقار سنة" in p["evidence_lines"]
    assert compare_listing({"property_age": 1}, p)["property_age"] == MATCH


def test_a_hyphenated_stored_diagonal_still_matches():
    # CodeRabbit on #11465: «جنوب-شرق» is two bearings, not one word
    assert compare_listing({"direction_ar": "جنوب-شرق"}, page("جنوبية شرقية"))["direction_ar"] != MISMATCH


def test_a_unit_line_after_a_stated_age_is_not_one_year():
    # CodeRabbit on #11465: «عمر العقار: 5» / «سنة» is five years
    from scrapers.common.new_listings_score import AGE_KW, _cmp_number, norm
    lines = [norm("عمر العقار: 5"), norm("سنة")]
    assert _cmp_number(1, lines, " | ".join(lines), AGE_KW) != MATCH
    assert _cmp_number(5, lines, " | ".join(lines), AGE_KW) == MATCH


def test_repeated_feature_pairs_do_not_push_a_later_field_past_the_cap():
    rep = '<div class="feature-block"><h2>غرف النوم</h2><span>3</span></div>' * 300
    p = page_evidence(f"<html><body>{rep}<div>عمر العقار</div><div>سنة</div></body></html>")
    assert p["evidence_lines"].count("غرف النوم 3") == 1
    assert "عمر العقار سنة" in p["evidence_lines"]


def test_a_phone_in_a_feature_value_never_reaches_the_evidence():
    blk = '<div class="feature-block"><h2>عرض الشارع</h2><span>20 للتواصل 0551234567</span></div>'
    lines = page_evidence(f"<html><body>{blk}</body></html>")["evidence_lines"]
    assert not any("0551234567" in x for x in lines)
    assert "عرض الشارع 20 للتواصل <num>" in lines


def test_a_title_value_no_past_text_head_stays_a_no():
    # CodeRabbit on #11465: tuba's «مفروشة :» / «لا» joined without its colon read as a yes
    pair = '<div class="newest-title">مفروشة :</div><div class="newest-value">لا</div>'
    filler = "<p>" + ("تفاصيل العقار " * 200) + "</p>"   # neutral: FILLER's «مؤثثة» is itself a yes
    p = page_evidence(f"<html><body>{filler}{pair}</body></html>")
    assert "مفروشة: لا" in p["evidence_lines"]
    assert compare_listing({"furnished": False}, p)["furnished"] == MATCH


def test_a_phone_in_a_title_value_never_reaches_the_evidence():
    pair = ('<div class="newest-title">عرض الشارع :</div><div class="newest-value">15 جوال 0551234567</div>'
            '<div class="newest-title">مساحة الأرض :</div><div class="newest-value">625</div>')
    lines = page_evidence(f"<html><body>{pair}</body></html>")["evidence_lines"]
    assert not any("0551234567" in x for x in lines)
    assert "عرض الشارع: 15 جوال <num>" in lines and "مساحة الأرض: 625" in lines


def test_a_colon_label_with_the_year_on_the_next_line_is_one_year():
    # CodeRabbit on #11465: «عمر العقار:» / «سنة» — the bare colon label is emptied later, so it is read first
    from scrapers.common.new_listings_score import AGE_KW, WE_MISS, _cmp_number, norm
    lines = [norm("عمر العقار:"), norm("سنة")]
    assert _cmp_number(1, lines, " | ".join(lines), AGE_KW) == MATCH
    assert _cmp_number(None, lines, " | ".join(lines), AGE_KW) == WE_MISS


def test_a_phone_under_any_label_never_reaches_either_output():
    # CodeRabbit on #11465: _with_values and text_head carried a bare phone under a permitted label
    body = ("<html><body><div>مساحة الأرض</div><div>0551234567</div><div>غرف النوم</div><div>966551234567</div>"
            "<div>واجهة العقار</div><div>شمالية</div><div>عرض الشارع</div><div>20</div>"
            "<div>السعر</div><div>850,000 ريال</div></body></html>")
    p = page_evidence(body)
    out = " ".join(p["evidence_lines"]) + p["text_head"]
    assert "0551234567" not in out and "551234567" not in out
    assert "عرض الشارع | 20" in p["text_head"] and "شمالية" in p["text_head"]   # the facts survive
    assert "850,000 ريال" in p["evidence_lines"]
    assert page_evidence(body)["evidence_lines"] == p["evidence_lines"]   # idempotent


def test_a_name_or_phone_under_a_facade_or_street_label_never_reaches_the_evidence():
    # CodeRabbit on #11465: a value that is not a bearing / a width is not the fact
    blk = ('<div class="feature-block"><h2>واجهة العقار</h2><span>محمد أحمد</span></div>'
           '<div class="feature-block"><h2>عرض الشارع</h2><span>للتواصل ابو فهد</span></div>'
           '<div class="newest-title">الواجهة :</div><div class="newest-value">شرقية</div>')
    lines = page_evidence(f"<html><body>{blk}</body></html>")["evidence_lines"]
    assert not any("محمد" in x or "فهد" in x for x in lines if x.startswith(("واجهة العقار ", "عرض الشارع ")))
    assert "الواجهة: شرقية" in lines


def test_json_ld_and_meta_contacts_never_reach_the_artifact():
    import json as _json
    ld = {"@type": "Product", "name": "شقة للبيع", "seller": {"telephone": "0551234567", "name": "x"},
          "description": "للتواصل 0551234567", "floorSize": {"value": 150}}
    body = (f'<html><head><title>شقة جوال 0551234567</title><meta name="description" content="اتصل 0559876543">'
            f'<script type="application/ld+json">{_json.dumps(ld, ensure_ascii=False)}</script></head><body></body></html>')
    p = page_evidence(body)
    dumped = _json.dumps({k: p[k] for k in ("title", "meta", "jsonld")}, ensure_ascii=False)
    assert "0551234567" not in dumped and "0559876543" not in dumped
    assert '"value": 150' in dumped   # property facts survive


def test_a_phone_across_the_text_head_cut_leaves_no_digits():
    # CodeRabbit on #11465: truncating before redaction could keep the first digits of a phone at character 1,500
    for pad in range(1490, 1502):
        p = page_evidence(f"<html><body><p>{'ا' * pad} 0551234567</p></body></html>")
        assert "055123" not in p["text_head"] and "551234" not in p["text_head"]


def test_redaction_is_idempotent_on_every_output():
    from scrapers.common.pii import redact_pii
    body = ("<html><body><div>مساحة الأرض</div><div>0551234567</div><div>السعر</div><div>850,000 ريال</div>"
            "<div>واتس 966551234567</div></body></html>")
    p = page_evidence(body)
    for x in p["evidence_lines"] + [p["text_head"]]:
        assert redact_pii(x) == x
