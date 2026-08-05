"""Regression test for scrapers/dealapp/run.py's district extraction (2026-08-03).

The bug: dealapp's district was taken from schema.org `itemOffered.address.addressRegion`, which is
ENGLISH ("Al Naseem Dist.") and frequently a wrong default ("Riyadh" for a non-Riyadh listing). The app
only shows Arabic districts, so ~1.1k active dealapp listings showed «الحي غير محدد» despite the source
publishing the district in Arabic.

Root cause: we captured the wrong field. dealapp's /ar/ page carries the district in Arabic in the
listing's OWN title (schema breadcrumb position 3): "<type/deal> - <district_ar> - <city_ar>", e.g.
"شقة للإيجار - الراشدية - مكة المكرمة". (A `.location` map element also exists but was found UNRELIABLE —
it can name a different/adjacent district than the listing's title, e.g. '.location'=حي الشرائع on a
listing titled 'الراشدية' — so we deliberately do NOT use it.)

Fix: `_breadcrumb_district_ar()` takes the middle segment of the position-3 title. Verbatim source Arabic,
never English; None → honest «الحي غير محدد» when uncertain. Live-confirmed the extracted Arabic resolves
against the canonical catalog (الراشدية→حي الراشدية, العزيزية→حي العزيزية, …); non-catalogued strings
(مخطط 6, الشامية) correctly stay null.
(feedback_english-district-to-arabic-mapping-standard.)

Run: python -m pytest scrapers/common/tests/test_dealapp_district_from_breadcrumb.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.dealapp.run import _breadcrumb_district_ar  # noqa: E402


def _schema(title_pos3, city_pos2="مكة المكرمة"):
    return {"_breadcrumb": {"itemListElement": [
        {"position": 1, "name": "الرئيسية"},
        {"position": 2, "name": city_pos2},
        {"position": 3, "name": title_pos3},
    ]}}


def test_extracts_arabic_district_from_title_middle():
    # live ad 238685: title "شقة للإيجار - الراشدية - مكة المكرمة" → الراشدية
    assert _breadcrumb_district_ar(_schema("شقة للإيجار - الراشدية - مكة المكرمة"), "مكة المكرمة") == "الراشدية"


def test_land_type_multiword_still_extracts_middle():
    # live ad (Al Naseem): "ارض سكنية للبيع - النسيم - خميس مشيط" → النسيم
    s = _schema("ارض سكنية للبيع - النسيم - خميس مشيط", city_pos2="خميس مشيط")
    assert _breadcrumb_district_ar(s, "خميس مشيط") == "النسيم"


def test_never_returns_english():
    # a fully-English title must never yield an English district (Arabic-only guard) → None
    assert _breadcrumb_district_ar(_schema("Apartment for rent - Al Naseem Dist. - Mecca"), "مكة المكرمة") is None


def test_missing_district_two_parts_is_none():
    # "<type> - <city>" (no district segment) → honest None, not the city
    assert _breadcrumb_district_ar(_schema("شقة للإيجار - مكة المكرمة"), "مكة المكرمة") is None


def test_district_equal_to_city_is_rejected():
    assert _breadcrumb_district_ar(_schema("شقة للإيجار - مكة المكرمة - مكة المكرمة"), "مكة المكرمة") is None


def test_no_breadcrumb_is_none():
    assert _breadcrumb_district_ar({}, "مكة المكرمة") is None
    assert _breadcrumb_district_ar({"_breadcrumb": {"itemListElement": []}}, "مكة المكرمة") is None


if __name__ == "__main__":
    test_extracts_arabic_district_from_title_middle()
    test_land_type_multiword_still_extracts_middle()
    test_never_returns_english()
    test_missing_district_two_parts_is_none()
    test_district_equal_to_city_is_rejected()
    test_no_breadcrumb_is_none()
    print("OK — dealapp district-from-breadcrumb regression tests pass")
