"""dealapp: a plot or plan code is never the district; the title's district segment, then the deed block (2026-10-18).

93 live dealapp rows stored a plot/plan code from the page's location line («حي 1051 مخطط رقم», «حي 33ج», «حي ج19»)
and served NO district, while the same page names one: the title's middle segment («ارض للبيع - المليداء - بريدة»)
or the deed block the ad prints («وصف موقع العقار حسب الصك / المدينة: القويعية / الحي: الصناعية»). The deed block is
read only when its city is the listing's city: 422 of 1,949 live blocks name another city (ad 581956, a Buraidah plot,
prints «المدينة: جده الحي: الصفا»). Fixtures are recorded pages (fresh renders, 2026-10-18), person lines redacted.

Run: python -m pytest scrapers/common/tests/test_dealapp_plot_code_district_2026_10_18.py -v
"""
from pathlib import Path

import pytest

from scrapers.dealapp import run as D

TD = Path(__file__).resolve().parents[2] / "dealapp" / "testdata"


def _read(n):
    html = (TD / f"{n}.excerpt.html").read_text(encoding="utf-8")
    schema = D._listing_schema(html)
    return html, schema, D._breadcrumb_city_ar(schema)


def test_573551_plot_code_line_and_plan_title_fall_to_the_same_city_deed():
    html, schema, city = _read("573551")
    assert city == "القويعية"
    assert D._location_line_district_ar(html, city) == "حي 1051 مخطط رقم"      # what was stored before
    assert D._breadcrumb_district_ar(schema, city) == "مخططات"                  # the title's segment is a plan word
    assert D._district_ar(schema, html, city) == "الصناعية"


def test_581956_plot_code_line_falls_to_the_titles_district_and_the_other_city_deed_is_ignored():
    html, schema, city = _read("581956")
    assert city == "بريدة"
    assert D._location_line_district_ar(html, city) == "حي 33ج"
    assert D._deed_district_ar(schema, city) is None                            # «المدينة: جده» is not بريدة
    assert D._district_ar(schema, html, city) == "المليداء"


@pytest.mark.parametrize("word", ["حي 1051 مخطط رقم", "حي 33ج", "حي ج19", "حي (حي رقم (5", "حي حي_001022142",
                                  "مخططات", "حي غير محدد", "", None])
def test_mutation_a_plot_code_placeholder_or_nothing_is_never_a_district(word):
    assert not D._usable_district(word)


def test_mutation_the_deed_needs_its_own_city_and_a_district_name():
    s = {"description": "وصف موقع العقار حسب الصك\nالمدينة: القويعية\nالحي: الصناعية\nالموظف المسؤول عن الإعلان: x"}
    assert D._deed_district_ar(s, "القويعية") == "الصناعية"
    assert D._deed_district_ar(s, "الرياض") is None                              # another city's deed
    assert D._deed_district_ar(s, None) is None                                  # no city to compare
    flat = {"description": "وصف موقع العقار حسب الصك المدينة: جدة الحي: السلامة الموظف المسؤول عن الإعلان: x"}
    assert D._deed_district_ar(flat, "جده") == "السلامة"                         # ة/ه folded, flattened text
    plot = {"description": "وصف موقع العقار حسب الصك\nالمدينة: القويعية\nالحي: 1051\n"}
    assert D._deed_district_ar(plot, "القويعية") is None


def test_a_real_location_line_district_still_wins_over_the_deed():
    html = ("<html><head><title>x</title></head><body><div>القويعية, حي الخليج</div><div>حي الخليج, القويعية</div>"
            "</body></html>")
    s = {"description": "وصف موقع العقار حسب الصك\nالمدينة: القويعية\nالحي: الصناعية\n"}
    assert D._district_ar(s, html, "القويعية") == "حي الخليج"


# Recorded 2026-10-18 (fresh renders): the location line of 426903 is «جازان, حي الناصرية 4» and of 520500
# «قرية العليا - الرفيعه, حي الياسمين1». Both are numbered districts the page states; the title's segment
# («الشواجرة», «الرفيعة») must not replace them.
@pytest.mark.parametrize("word", ["حي الناصرية 4", "حي الياسمين1", "الناصرية 4", "حي المصيف ٢", "حي الملك فهد 2"])
def test_a_numbered_district_is_a_district_not_a_plot_code(word):
    assert D._usable_district(word)


def test_mutation_a_numbered_location_line_still_wins_over_the_title():
    html = ("<html><head><title>x</title></head><body><div>جازان, حي الناصرية 4</div><div>حي الناصرية 4, جازان</div>"
            "</body></html>")
    s = {"_breadcrumb": {"itemListElement": [{"position": 3, "name": "ارض للبيع - الشواجرة - جازان"}]}}
    assert D._district_ar(s, html, "جازان") == "حي الناصرية 4"


@pytest.mark.parametrize("word", ["حي ج1", "ج1", "حي 1النخيل", "حي مخطط 144", "حي 1156"])
def test_mutation_short_codes_are_still_plot_codes(word):
    assert not D._usable_district(word)
