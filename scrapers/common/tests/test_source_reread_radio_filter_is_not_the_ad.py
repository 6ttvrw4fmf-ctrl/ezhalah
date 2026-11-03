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
