"""new_listings_score: a worded figure on the line after its label is the label's value (🆕, 2026-10-30, backlog 1091).

reinvest 21664052 prints «عمر العقار» / «ثلاث سنوات» as a label/value pair (re-read run 41098655633) and we store
property_age 3. The scorer read worded figures only on the label's own line, and the bare «3179» (plan number) on
the row before counted as a stated age, so the ad scored a MISMATCH.
"""
from scrapers.common import new_listings_score as S

PAGE = ('<div><span>رقم المخطط</span><span>3179</span></div>'
        '<div><span>عمر العقار</span><span>ثلاث سنوات</span></div>'
        '<div><span>رقم القطعة</span><span>146</span></div><div><span>عدد الغرف</span><span>3</span></div>')


def _age(stored, body=PAGE):
    return S.compare_listing({"property_age": stored}, S.page_evidence(body))["property_age"]


def test_worded_value_on_the_next_line_matches():
    assert _age(3) == S.MATCH


def test_a_different_stored_age_still_mismatches():
    assert _age(5) == S.MISMATCH


def test_a_longer_next_line_is_not_read_as_the_value():
    assert S.WORDED_VALUE_LINE.match(S.norm("ثلاث سنوات تقريبا من البناء")) is None
    assert S.WORDED_VALUE_LINE.match(S.norm("ثلاث سنوات"))
