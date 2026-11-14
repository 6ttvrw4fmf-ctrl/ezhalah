"""A bare label is not a «yes» (🔬 2026-11-14, af-score night 11-13).

ksaaqar prints its feature cells as `<li>التكييف : <span>لا</span></li>`. source_reread's text_head splits on every
tag, so the lone label «التكييف :» reached compare_listing's lines beside the joined «التكييف : لا»; the label named
the field and the page read as «yes», so our correct stored «no» scored MISMATCH (ksaaqar 12226834 / 12225842, two of
that night's three ksaaqar mismatches). The markup below is pasted from the live page re-read on 2026-11-14
(net.http_get, HTTP 200), never typed from memory.
"""
from scrapers.common import new_listings_score as S
from scrapers.common.source_reread import page_evidence

# ksaaqar 12226834, re-read 2026-11-14 (the feature list and the description, verbatim)
_KSAAQAR = """<html><body><ul>
<li>رقم رخصة فال : <span>7200017066</span></li> <li>عدد الغرف  : <span>4</span></li> <li>عدد الصالات : <span>1</span></li> <li>دورة المياه : <span>2</span></li> <li>عدد الأدوار : <span>3</span></li> <li>التكييف : <span>لا</span></li> <li> واجهة العقار : <span>شمال</span></li> <li>عمر العقار : <span>3 سنوات</span></li> <li>حدود وأطوال العقار : <span>18</span></li> <li>نوع العقار : <span>تجاري</span></li> <li>التأثيث : <span>غير مفروشة</span></li>
</ul>
<div id="adt-ad-description-box" class="adt-ad-description"><h4>الوصف:</h4><p>شقه جديده مفروشه للايجار في جده حي النهضه الدور ال </p></div></body></html>"""


def _page(html: str) -> dict:
    ev = page_evidence(html)
    # what score_site hands compare_listing: the evidence lines plus the tag-split text head
    ev["text_head"] = " | ".join(x.strip() for x in __import__("re").split(r"<[^>]+>", html) if x.strip())
    return ev


def test_a_labelled_no_matches_a_stored_no():
    out = S.compare_listing({"air_conditioner": False}, _page(_KSAAQAR), skip_price=True)
    assert out["air_conditioner"] == S.MATCH


def test_a_labelled_no_still_catches_a_stored_yes():
    out = S.compare_listing({"air_conditioner": True}, _page(_KSAAQAR), skip_price=True)
    assert out["air_conditioner"] == S.MISMATCH


def test_a_labelled_yes_still_reads_yes():
    html = _KSAAQAR.replace("<li>التكييف : <span>لا</span></li>", "<li>التكييف : <span>نعم</span></li>")
    assert S.compare_listing({"air_conditioner": True}, _page(html), skip_price=True)["air_conditioner"] == S.MATCH
    assert S.compare_listing({"air_conditioner": None}, _page(html), skip_price=True)["air_conditioner"] == S.WE_MISS


def test_the_bare_label_alone_is_not_evidence():
    assert S._bare_label(S.norm("التكييف :"), r"مكيف|تكييف")
    assert not S._bare_label(S.norm("التكييف : لا"), r"مكيف|تكييف")
    assert not S._bare_label(S.norm("مكيفات راكبة"), r"مكيف|تكييف")
    assert S._cmp_bool(False, [S.norm("التكييف :"), S.norm("لا")], r"مكيف|تكييف") == S.PAGE_SILENT
