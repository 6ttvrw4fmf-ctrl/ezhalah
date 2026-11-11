"""tuba: a commented-out template is not the page, and «- مفروشة: لا» is a no (🔬 2026-11-11).

af-score night 2026-11-10 scored 4 of tuba's 29 claims wrong, all correct values (pages re-read via net.http_get
11454 / 11455): villa 13261455 / 13261520 stored «شمال», page «واجهة العقار : شمالية»; studio 13261393 stored
furnished false, page «- مفروشة: لا». The markup below is copied from the re-read pages: the old details template
sits inside «<!-- … -->» ABOVE the real «تفاصيل العقار» block.
"""
from scrapers.common.new_listings_score import MATCH, MISMATCH, compare_listing
from scrapers.common.source_reread import page_evidence

TEMPLATE = ('<!--<div class="more-details"><ul class="list-inline-item" id="labels-2">'
            '<li class="hidden"><p>رقم المبنى :</p></li><li class="hidden"><p>واجهة العقار :</p></li>'
            '<li class="hidden"><p>مطابقة كود البناء السعودي :</p></li></ul>'
            '<ul class="list-inline-item" id="values-2"><li><p><span>5</span></p></li><li><p><span>5</span></p></li>'
            '<li><p><span>0</span></p></li><li class="hidden"><p><span>New</span></p></li>'
            '<li class="hidden"><p><span>lorem ipsum</span></p></li><li class="hidden"><p><span>270</span></p></li>'
            '<li class="hidden"><p><span>Lorem Ipsum</span></p></li><li class="hidden"><p><span>yes/no</span></p></li></ul>'
            '</div><button id="toggle-button">عرض المزيد</button></div></div></div>-->')
DETAILS = ('<div class="col-lg-12"><div class="additional_details"><div class="row"><div class="col-lg-12">'
           '<h4 class="mb15" style="font-weight: bold">تفاصيل العقار</h4></div><div class="col-lg-6">'
           '<div class="newest-property-details"><div class="newest-title">رقم المرجع :</div>'
           '<div class="newest-value">17957</div><div class="newest-title">رقم المبنى :</div>'
           '<div class="newest-value">4179</div><div class="newest-title">واجهة العقار :</div>'
           '<div class="newest-value">شمالية</div><div class="newest-title">مطابقة كود البناء السعودي :</div>'
           '<div class="newest-value">1</div></div></div></div></div></div>')
# a long page pushes the real pair past every line cap (the live page is 217 KB)
FILL = "".join(f'<div class="x"><span>عنصر {i}</span><span>{i * 7}</span></div>' for i in range(600))
DESC = ('<div class="desc">المزايا الرئيسية:<br />\r\n- نوع العقار: شقة<br />\r\n- غرف النوم: 0 (استوديو)<br />\r\n'
        '- الحمامات: 0<br />\r\n- مفروشة: لا<br />\r\n- للكراء<br />\r\n- الموقع: العزيزية، جدة<br />\r\n</div>')


def villa() -> dict:
    return page_evidence(f"<html><body>{TEMPLATE}{FILL}{DETAILS}</body></html>")


def test_the_real_facade_pair_reaches_the_score_on_a_long_page():
    ev = villa()
    assert "واجهة العقار: شمالية" in ev["evidence_lines"]
    assert compare_listing({"direction_ar": "شمال"}, ev)["direction_ar"] == MATCH
    assert compare_listing({"direction_ar": "جنوب"}, ev)["direction_ar"] == MISMATCH


def test_a_commented_out_template_is_not_on_the_page():
    ev = page_evidence(f"<html><body>{TEMPLATE}<p>فيلا للبيع</p></body></html>")
    assert "lorem" not in ev["text_head"].lower() and "واجهة" not in ev["text_head"]


def test_a_labelled_no_after_the_field_is_a_no():
    ev = page_evidence(f"<html><body>{DESC}</body></html>")
    assert compare_listing({"furnished": False}, ev)["furnished"] == MATCH
    assert compare_listing({"furnished": True}, ev)["furnished"] == MISMATCH
    yes = page_evidence("<html><body><p>شقة مفروشة بالكامل</p><p>مفروشة: نعم</p></body></html>")
    assert compare_listing({"furnished": True}, yes)["furnished"] == MATCH
