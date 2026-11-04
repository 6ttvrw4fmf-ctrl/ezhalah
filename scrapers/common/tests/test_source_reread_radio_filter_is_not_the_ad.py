"""source_reread: a radio button's option label is the site's search control, not the ad (🔬 2026-11-03).

sakan prints its search «filters-popup» on every ad page (re-read of /ar/property/details/94863 on 2026-11-03,
whitespace trimmed). Its furnishing choices «مؤثث / شبه مؤثث / غير مؤثث» were read as the ad saying «مؤثث», so the
score asked furnished of 10 of 10 sampled sakan ads (ops_af_score 2026-11-03, furnished we_miss 10).
"""
from scrapers.common.source_reread import page_evidence

POPUP = ('<div class="filters-popup__furnishing"><span class="f14">حالة التأثيث</span>'
         '<input type="radio" name="property_furnishing_status" id="furnishing_new" hidden value="1"> مؤثث '
         '<input type="radio" name="property_furnishing_status" id="furnishing_bw" hidden value="2"> شبه مؤثث '
         '<input type="radio" name="property_furnishing_status" id="furnishing_status_old" hidden value="3"> غير مؤثث '
         '</div>')
OWN = '<h1>شقة للبيع - خميس مشيط - حي الوسام</h1><div>المساحة</div><div>150</div>'


def _all(page: dict) -> str:
    return page["text_head"] + " ".join(page["evidence_lines"])


def test_the_search_filter_choices_are_not_page_lines():
    assert "مؤثث" not in _all(page_evidence(OWN + POPUP))


def test_the_ads_own_furnished_words_are_kept():
    own = OWN + '<p>الشقة مؤثثة بالكامل</p>'
    assert "مؤثثة" in page_evidence(own + POPUP)["text_head"]


def test_a_ticked_checkbox_feature_is_kept():
    ticked = OWN + '<label><input type="checkbox" checked disabled> مصعد</label>'
    assert "مصعد" in _all(page_evidence(ticked))


def test_a_dropdown_of_types_and_districts_is_not_the_ad():
    # nofodh 472243 (2026-11-03): a <select> of every type and district on each ad page read as «balcony».
    dropdown = ('<select name="type"><option value="1">شقة</option><option value="9">تراس</option></select>'
                '<select name="district"><option>حي الشرفة الشمالية</option><option>مشرفة</option></select>')
    page = page_evidence(OWN + dropdown)
    assert "تراس" not in _all(page) and "الشرفة" not in _all(page)
    assert "حي الوسام" in page["text_head"]


def test_a_button_chip_is_not_the_ad():
    # sukna unit 711 (2026-11-03): AI prompt chips on every page read as the ad offering instalments.
    chips = ('<button type="button" class="inline-flex"><svg></svg><span class="whitespace-nowrap">خطة تقسيط ميسّرة'
             '</span></button>')
    assert "تقسيط" not in _all(page_evidence(OWN + chips))


def test_a_wordpress_menu_link_is_not_the_ad():
    # aqaralriyadh (2026-11-03): the menu «شقق مفروشة» on every page read as the ad saying furnished.
    menu = ('<ul><li id="menu-item-244" class="menu-item menu-item-type-taxonomy menu-item-244">'
            '<a href="https://aqaralriyadh.com/category/x/">شقق مفروشة</a></li></ul>')
    assert "مفروشة" not in _all(page_evidence(OWN + menu))
    assert "مفروشة" in page_evidence(OWN + menu + "<p>الشقة مفروشة</p>")["text_head"]


# The REAL markup (sakan 12613050 re-read from production 2026-11-04, HTTP 200): the option text is a separate
# <label for=…>. The fixture above put the text right after the input, so the 11-03 fix passed while the score kept
# reading «مؤثث» on 9 of 10 sakan ads.
POPUP_REAL = ('<span class="f14">حالة التأثيث</span>'
              '<input type="radio" name="property_furnishing_status" id="furnishing_new" hidden value="1"> '
              '<label for="furnishing_new">مؤثث</label> '
              '<input type="radio" name="property_furnishing_status" id="furnishing_bw" hidden value="2"> '
              '<label for="furnishing_bw">شبه مؤثث</label> '
              '<input type="radio" name="property_furnishing_status" id="furnishing_status_old" hidden value="3"> '
              '<label for="furnishing_status_old">غير مؤثث</label>')


def test_a_label_bound_to_a_radio_input_is_not_a_page_line():
    assert "مؤثث" not in _all(page_evidence(OWN + POPUP_REAL))


def test_a_label_bound_to_a_checkbox_or_text_field_is_kept():
    own = OWN + '<input type="checkbox" id="lift" checked disabled><label for="lift">مصعد</label>'
    assert "مصعد" in _all(page_evidence(own + POPUP_REAL))
