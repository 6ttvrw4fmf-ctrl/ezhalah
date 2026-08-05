"""Regression test for scrapers/raghdan/run.py's `_breadcrumb_district` (2026-08-04).

raghdan's breadcrumb has two shapes. When raghdan's CMS tags a district it emits 5 crumbs (home,
العقارات, city, bare district, listing). When it doesn't, it collapses to 4 crumbs — but the title
crumb itself embeds the district: "ارض للبيع في مغرزات، الرياض". The old code only handled len>=5
and its own guard explicitly EXCLUDED strings containing للبيع/للإيجار — exactly the shape needed
for the 4-crumb case, so these 33 rows (city known, district null) never got a district.

Fix: an `elif len(items) == 4` branch extracts the text between "في" and the following Arabic comma
from the title crumb. Live-reconfirmed 2026-08-04 against raghdan.sa (see ad
KCdnNUpnuOnCSh4UK1K4 → "ارض للبيع في مغرزات، الرياض", 5B63qpmP5ctHV1nr6wtc → "... ضاحية نمار ...",
aMcKH0aLr2mnMWWib6ud → "... مطار الملك خالد الدولي ..." landmark, all 4-crumb, all live 200s).

This is a raw, unvalidated extraction — a landmark or "غير محدد" can come out of it too. That's
safe: downstream `resolve_district_ar()` only accepts a value already attested in
loc_canonical_district for the listing's city_id, so anything not a real district for that city
resolves to NULL rather than leaking onto the card (card-district-gates-on-match rule). This test
only covers the scraper-side extraction, not the DB-side gate.

Run: python -m pytest scrapers/common/tests/test_raghdan_4crumb_title_district.py -v
"""
import sys

sys.path.insert(0, ".")

from scrapers.raghdan.run import _breadcrumb_district  # noqa: E402


def _bc(*names):
    return {"itemListElement": [{"position": i + 1, "name": n} for i, n in enumerate(names)]}


def test_4crumb_title_extracts_district_land():
    # live ad KCdnNUpnuOnCSh4UK1K4
    bc = _bc("الرئيسية", "العقارات", "الرياض", "ارض للبيع في مغرزات، الرياض")
    assert _breadcrumb_district(bc) == "مغرزات"


def test_4crumb_title_extracts_district_multiword():
    # live ad BhF234koIrgEoTdPZh9q
    bc = _bc("الرئيسية", "العقارات", "الرياض", "عمارة للإيجار في منفوحة الجديدة، الرياض")
    assert _breadcrumb_district(bc) == "منفوحة الجديدة"


def test_4crumb_title_extracts_district_rent_apartment():
    # live ad 44I8CgLKBeFSCVZxexig
    bc = _bc("الرئيسية", "العقارات", "الرياض", "شقة للإيجار في ظهرة لبن، الرياض")
    assert _breadcrumb_district(bc) == "ظهرة لبن"


def test_4crumb_title_landmark_still_extracted_raw():
    # live ad aMcKH0aLr2mnMWWib6ud — not a real district; DB-side resolve_district_ar() gates this,
    # not the scraper (see module docstring).
    bc = _bc("الرئيسية", "العقارات", "الرياض", "فيلا للإيجار في مطار الملك خالد الدولي، الرياض")
    assert _breadcrumb_district(bc) == "مطار الملك خالد الدولي"


def test_4crumb_no_fi_clause_is_none():
    # "<type> للبيع" with no city/district at all (city="Other" rows) → no match, None
    bc = _bc("الرئيسية", "العقارات", "الرياض", "دور للبيع")
    assert _breadcrumb_district(bc) is None


def test_5crumb_shape_unchanged():
    bc = _bc("الرئيسية", "العقارات", "الرياض", "النرجس", "فيلا للبيع في النرجس، الرياض")
    assert _breadcrumb_district(bc) == "النرجس"


def test_no_breadcrumb_is_none():
    assert _breadcrumb_district(None) is None
    assert _breadcrumb_district({"itemListElement": []}) is None


if __name__ == "__main__":
    test_4crumb_title_extracts_district_land()
    test_4crumb_title_extracts_district_multiword()
    test_4crumb_title_extracts_district_rent_apartment()
    test_4crumb_title_landmark_still_extracted_raw()
    test_4crumb_no_fi_clause_is_none()
    test_5crumb_shape_unchanged()
    test_no_breadcrumb_is_none()
    print("OK — raghdan 4-crumb title-embedded-district regression tests pass")
