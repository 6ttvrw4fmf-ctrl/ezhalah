"""ksaaqar: the ad's own description reaches the description COLUMN (owner 2026-10-30: «we read everything»).

Measured 2026-10-30: all 1,353 active ksaaqar rows had description NULL while the live pages publish a full
«الوصف:» box (area, street width, price — ksaaqar.com/ad/ارض-سكنية-للبيع-طيبة-الفرعية). `_description_text` had
read that box for amenities since 10-08, but map_listing never stored it, so the AI facts reader
(title + description >= 30 chars) could not read a single ksaaqar ad. Fails on the old code: the row had no key.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_stores_the_description.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.ksaaqar.run as K  # noqa: E402

# HERMETIC: map_listing resolves the city against the live catalog (and hangs with no credentials).
K.to_catalog = lambda city_ar, region_hint=None: (1, 1)
K.find_district_in_text = lambda text, city_id: text

SPEC = ("الدولة: عقارات الرياض الحالة: غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة "
        "50,000.00SAR (قابل للتفاوض) النوع: للإيجار الحالة: غير مؤجرة "
        "عدد الغرف : 3 نوع العقار : سكني الوصف: شقه للايجار حي الملقا")
POST = {"id": 1, "slug": "x", "link": "https://ksaaqar.com/ad/x/",
        "title": {"rendered": "شقة للإيجار في الملقا"}, "class_list": []}
BOX = ('<div id="adt-ad-description-box"><h4>الوصف:</h4>'
       '<p>شقه للايجار حي الملقا ثلاث غرف وصاله</p>'
       '<p>الشارع 15 م - مطبخ راكب - مصعد</p>'
       '</div><div class="sidebar"><p>اعلانات مشابهة</p></div>')


def test_the_description_is_stored_verbatim_every_paragraph():
    row, _cat, why = K.map_listing(POST, SPEC, BOX)
    assert row is not None, why
    assert "description" in row, "the row must carry the description column (it never did before 2026-10-30)"
    assert "شقه للايجار حي الملقا ثلاث غرف وصاله" in row["description"]
    assert "الشارع 15 م" in row["description"], "every paragraph, not only the first"
    assert "اعلانات مشابهة" not in row["description"], "the box ends at its own div — never the sidebar"


def test_no_box_stays_null_never_empty_string():
    row, _cat, _why = K.map_listing(POST, SPEC, "")
    assert row is not None and row["description"] is None, "silent → NULL (SOURCE IS TRUTH), never ''"
