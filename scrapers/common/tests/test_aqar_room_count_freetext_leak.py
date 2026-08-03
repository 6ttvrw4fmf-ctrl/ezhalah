"""Regression test for aqar's bathrooms/master_bedrooms/halls/reception_rooms_majlis leak (2026-08-03).

`_int_after_label` searches the WHOLE de-tagged page for "label THEN number", unanchored. Aqar's
real structured «تفاصيل الإعلان» spec-table rows are "label number" (e.g. "دورات المياه 1"), but the
SAME label words also show up, incidentally, in the seller's free-text description ABOVE that
heading — where natural Arabic order is "number label" ("3 حمامات"), so the "number after label"
match there grabs whatever unrelated figure happens to sit textually after the word, not a room
count. Confirmed live (2026-08-03), three different leak sources for three different fields:
    ad 6689949  bathrooms=550        — desc: "...مطبخ 3 حمامات \\n550 الف ريال" (a DIFFERENT unit's
                                        price on the next line; = price_total/1000 exactly)
    ad 6657497  master_bedrooms=1900 — desc: "🛏️ الماستر: 1900 ريال شهرياً" (a room-type's monthly
                                        rent; this listing's spec table has no ماستر field at all)
    ad 6579190  halls=206            — desc: "مساحة كل صالة 206 م" (area per hall; = area_m2)

Fix: same anchor `_property_age_from_text` already uses for property_age — only search the text
AFTER «تفاصيل الإعلان» (the real spec table). Mirrors
scrapers/common/tests/test_dealapp_spec_value_meta_leak.py's pattern (synthetic HTML fixture
reproducing the leak, before/after).

Run: python -m pytest scrapers/common/tests/test_aqar_room_count_freetext_leak.py -v
"""
from scrapers.aqar.enrich_residential import (
    _html_to_text,
    _int_after_label,
    _int_after_label_in_spec_table,
)

BATH_LABELS = (r"دورات\s*المياه", r"الحمامات", r"حمامات")
MASTER_LABELS = (r"غرف\s*ماستر", r"غرفة\s*ماستر", r"ماستر")
HALL_LABELS = (r"صالات", r"صالة", r"غرفة\s*المعيشة", r"المعيشة")
BEDROOM_LABELS = (r"غرف\s*النوم",)

# Trimmed but structurally real shape (ad 6689949): a bundled-units free-text description with NO
# structured spec table for bathrooms at all, then a real «تفاصيل الإعلان» block that omits it.
_BATHROOMS_LEAK_HTML = """
<html><body>
<div>شقق مساحات من 154 م الى 158 م
3 غرف نوم مجلس صاله غرفة طعام مطبخ 3 حمامات
550 الف ريال</div>
<div>المزيد تفاصيل الإعلان نوع العقار سكني الواجهة شرق غرف النوم 6 عمر العقار جديد المساحة 160 م²</div>
</body></html>
"""

# Trimmed but structurally real shape (ad 6657497): a room-pricing menu in the free-text description,
# then a real «تفاصيل الإعلان» block that has no غرف ماستر field.
_MASTER_BEDROOMS_LEAK_HTML = """
<html><body>
<div>الاقتصادية: 1750 ريال شهرياً
الديلوكس: 1800 ريال شهرياً
الماستر: 1900 ريال شهرياً شامل الكهرباء والمياه
الاستديو: 2200 ريال شهرياً</div>
<div>المزيد تفاصيل الإعلان المساحة 45 م² الفئة عوائل غرف النوم 1 دورات المياه 1 عمر العقار 3 سنوات</div>
</body></html>
"""

# Trimmed but structurally real shape (ad 6579190): a per-hall area mention in the free-text
# description, then a real «تفاصيل الإعلان» block that has no صالات field.
_HALLS_LEAK_HTML = """
<html><body>
<div>للإيجار صالات تجارية حي قرطبة شمال بريدة طريق الأمير فيصل بن مشعل مساحة كل صالة 206 م ميزانين</div>
<div>المزيد تفاصيل الإعلان الواجهة غرب عرض الشارع 40 م عمر العقار سنتين المساحة 206 م²</div>
</body></html>
"""

# A genuine structured value (real shape, ad 6294093): "غرف نوم ماستر N" — a real Aqar spec-table
# field the fix must keep parsing correctly, not just null everything after the anchor.
_MASTER_BEDROOMS_GENUINE_HTML = """
<html><body>
<div>🛏️ الماستر: 1900 ريال شهرياً شامل الكهرباء والمياه</div>
<div>المزيد تفاصيل الإعلان نوع العقار سكني غرف النوم 5 الصالات 1 دورات المياه 3 عمر العقار جديد
المساحة 160 م² نظام التكييف سبليت غرف نوم ماستر 1 المميزات مطبخ</div>
</body></html>
"""


def test_bathrooms_leak_is_fixed():
    text = _html_to_text(_BATHROOMS_LEAK_HTML)
    assert _int_after_label_in_spec_table(text, *BATH_LABELS) is None


def test_bathrooms_leak_was_real():
    """Negative control: the OLD unanchored helper really did return the price as bathrooms."""
    text = _html_to_text(_BATHROOMS_LEAK_HTML)
    assert _int_after_label(text, *BATH_LABELS) == 550


def test_master_bedrooms_leak_is_fixed():
    text = _html_to_text(_MASTER_BEDROOMS_LEAK_HTML)
    assert _int_after_label_in_spec_table(text, *MASTER_LABELS) is None


def test_master_bedrooms_leak_was_real():
    text = _html_to_text(_MASTER_BEDROOMS_LEAK_HTML)
    assert _int_after_label(text, *MASTER_LABELS) == 1900


def test_halls_leak_is_fixed():
    text = _html_to_text(_HALLS_LEAK_HTML)
    assert _int_after_label_in_spec_table(text, *HALL_LABELS) is None


def test_halls_leak_was_real():
    text = _html_to_text(_HALLS_LEAK_HTML)
    assert _int_after_label(text, *HALL_LABELS) == 206


def test_genuine_spec_table_value_still_parses():
    """The fix must not cost us real values — same «ماستر» label word, but now it sits in the
    genuine spec-table row «غرف نوم ماستر 1», and the fix must isolate THAT match, not the free-text
    monthly-rent mention above the anchor."""
    text = _html_to_text(_MASTER_BEDROOMS_GENUINE_HTML)
    assert _int_after_label_in_spec_table(text, *MASTER_LABELS) == 1


def test_genuine_bathrooms_and_halls_still_parse():
    """Sanity: fields that DO have a real spec-table entry (bathrooms=3, halls=1 in the same
    fixture) still resolve, not just null out."""
    text = _html_to_text(_MASTER_BEDROOMS_GENUINE_HTML)
    assert _int_after_label_in_spec_table(text, *BATH_LABELS) == 3
    assert _int_after_label_in_spec_table(text, *HALL_LABELS) == 1


# bedrooms used the same unanchored `_int_after_label` as the other 3 fields — same bug class
# (2026-08-03 audit follow-up: 1,960 live rows with bedrooms>20, same "label immediately followed
# by an unrelated number" mechanism as the master_bedrooms case). Real shape: a free-text price
# note directly after the label ("غرف النوم: 500 ريال إضافي" — an extra-charge-per-room note), which
# `_int_after_label`'s "label [:space]* NUMBER" regex greedily matches. The real spec table (after
# «تفاصيل الإعلان») has the true count.
_BEDROOMS_LEAK_HTML = """
<html><body>
<div>شقة فاخرة، غرف النوم: 500 ريال إضافي لكل غرفة عند الطلب</div>
<div>المزيد تفاصيل الإعلان نوع العقار سكني الواجهة شرق غرف النوم 5 دورات المياه 2 عمر العقار جديد
المساحة 180 م²</div>
</body></html>
"""


def test_bedrooms_leak_is_fixed():
    text = _html_to_text(_BEDROOMS_LEAK_HTML)
    assert _int_after_label_in_spec_table(text, *BEDROOM_LABELS) == 5


def test_bedrooms_leak_was_real():
    """Negative control: the OLD unanchored helper grabbed the unrelated price figure, not the
    real spec-table bedroom count."""
    text = _html_to_text(_BEDROOMS_LEAK_HTML)
    assert _int_after_label(text, *BEDROOM_LABELS) == 500


def test_genuine_bedrooms_still_parses():
    text = _html_to_text(_MASTER_BEDROOMS_GENUINE_HTML)
    assert _int_after_label_in_spec_table(text, *BEDROOM_LABELS) == 5


if __name__ == "__main__":
    test_bathrooms_leak_is_fixed()
    test_bathrooms_leak_was_real()
    test_master_bedrooms_leak_is_fixed()
    test_master_bedrooms_leak_was_real()
    test_halls_leak_is_fixed()
    test_halls_leak_was_real()
    test_genuine_spec_table_value_still_parses()
    test_genuine_bathrooms_and_halls_still_parse()
    test_bedrooms_leak_is_fixed()
    test_bedrooms_leak_was_real()
    test_genuine_bedrooms_still_parses()
    print("OK — aqar room-count free-text-leak regression tests pass")
