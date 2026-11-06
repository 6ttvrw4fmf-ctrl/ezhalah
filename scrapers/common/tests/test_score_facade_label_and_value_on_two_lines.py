"""A facade label printed on its own line joins the value after it (🔬 2026-11-06).

Markup shape from the live re-read of https://vm-ksa.com/ar/ads/635 (net.http_get, 2026-11-06): «<h2>واجهة العقار </h2>
<span>جنوبية شرقية</span>», which source_reread joins as «واجهة العقار | جنوبية شرقية». We store «جنوب شرق» for
vmksa 14110686, and the 11-06 score counted it as a MISMATCH (vmksa: 3 direction mismatches).
"""
import sys

sys.path.insert(0, ".")

from scrapers.common.new_listings_score import compare_listing, label_value_lines  # noqa: E402
from scrapers.common.source_reread import page_evidence  # noqa: E402

LIVE = ('<div class="feature-block"><i class="las la-map"></i><h2>رقم المخطط</h2><span>361</span></div>'
        '<div class="feature-block"><i class="las la-building"></i><h2>واجهة العقار </h2><span>%s</span></div>'
        '<div class="feature-block"><i class="las la-bullhorn"></i><h2>مصدر الاعلان</h2><span>الهيئة العامة للعقار</span></div>')


def _v(stored, value):
    page = page_evidence("<html><body>" + LIVE % value + "</body></html>")
    return compare_listing({"direction_ar": stored}, page, skip_price=True)["direction_ar"]


def test_the_same_facade_on_the_next_line_matches():
    assert _v("جنوب شرق", "جنوبية شرقية") == "match"
    assert _v("شرق", "شرقية") == "match"


def test_a_different_facade_is_still_a_mismatch():
    assert _v("شمال", "جنوبية شرقية") == "mismatch"


def test_a_stated_facade_we_do_not_hold_is_a_miss_and_none_stays_silent():
    assert _v(None, "جنوبية شرقية") == "we_miss"
    assert _v(None, "لا يوجد") == "page_silent"


def test_only_a_bare_label_is_joined():
    kw = r"واجهه|الاتجاه"
    assert label_value_lines(["واجهه العقار", "جنوبيه"], kw) == ["واجهه العقار : جنوبيه", "جنوبيه"]
    prose = "فيلا واجهه بحريه على شارعين مع حديقه"
    assert label_value_lines([prose, "شرقيه"], kw) == [prose, "شرقيه"]


def test_a_district_after_the_label_is_not_its_value():
    kw = r"واجهه|الاتجاه"
    assert label_value_lines(["واجهه العقار", "الحي الشرقي"], kw) == ["واجهه العقار", "الحي الشرقي"]
