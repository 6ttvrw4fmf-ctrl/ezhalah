"""new_listings_score: a keyword that ENDS its line states nothing on that line (🆕, 2026-11-02).

haraj 21839193's meta description is cut off at «…نوع العقار: Apartment سعر الوحدة: 27000 عمر العقار:» (re-read run
41288305920): the age's value fell off the end of the text, and the other field's 27000 before the keyword read as a
stated age, so our stored 9 (from the REGA block's «Nine Year») scored a MISMATCH. A label/value neighbour line still
states the value.
Mutation: removing the keyword-ends-the-line fold in _cmp_number turns test_truncated_meta_is_silent red.
"""
from scrapers.common import new_listings_score as S

TRUNC = "<p>شقة للإيجار نوع العقار: Apartment سعر الوحدة: 27000 عمر العقار:</p>"


def _age(stored, body):
    return S.compare_listing({"property_age": stored}, S.page_evidence(body))["property_age"]


def test_truncated_meta_is_silent():
    assert _age(9, TRUNC) == S.PAGE_SILENT


def test_rega_block_still_states_the_age():
    assert _age(9, TRUNC + "<p>عمر العقار: Nine Year</p>") == S.MATCH
    assert _age(5, TRUNC + "<p>عمر العقار: Nine Year</p>") == S.MISMATCH


def test_label_value_neighbour_still_counts():
    body = "<div><span>عمر العقار:</span><span>جديد</span></div><div><span>المساحة</span><span>220 م²</span></div>"
    assert _age(0, body) == S.MATCH
    assert _age(5, body) == S.MISMATCH


def test_keyword_with_its_value_on_the_line_unchanged():
    assert _age(7, "<p>عمر العقار: 7 سنوات</p>") == S.MATCH
    assert _age(4, "<p>عمر العقار: 7 سنوات</p>") == S.MISMATCH
