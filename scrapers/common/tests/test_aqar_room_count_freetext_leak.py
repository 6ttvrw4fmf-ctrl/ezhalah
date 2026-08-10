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


# ─── AREA (2026-08-10) — the same leak, in the field that survived the 2026-08-03 sweep ──────────
# «المساحة» is not only a spec label; in free text it is an ordinary Arabic word that routinely
# introduces a PRICE, so the unanchored read stored the asking price as the area. Live proof:
#   ad 6603069  area=1,822,550 — desc: "قيمة الأرض مقابل المساحة = 1,822,550 ريال" (the land's VALUE;
#                                 the real area, "مساحتها 364,51 متر مربع", uses a suffixed form the
#                                 label never matches) → a 364 m² plot filed as 1.8 million m²
#   ad 6656704  area=550,000   — an apartment, area came out exactly equal to price_total
#   ad 6680418  area=4,200,000 — a villa, likewise ("910م²" is the real area, stated in prose)
AREA_LABELS = (r"المساحة\s*(?:الكلية|الإجمالية)?", r"\bالمساحة\b")

# Trimmed but structurally real shape (ad 6603069): a land description that states the area with a
# suffixed word and the PRICE with the bare label, and whose stored page carries no spec table.
_AREA_LEAK_HTML = """
<html><body>
<div>● للبيع أرض في حي النعيم رقم المخطط 441 / ب .
● مساحتها 364,51 متر مربع .
● السعر 5000 ريال للمتر المربع .
● قيمة الأرض مقابل المساحة = 1,822,550 ريال .</div>
</body></html>
"""

# Free text where the bare label is followed directly by a figure — the shape the anchor removes.
_AREA_PROSE_NUMBER_HTML = """
<html><body>
<div>شقة للبيع بحي البديعة المساحة 550,000 ريال شامل الضريبة</div>
</body></html>
"""

_AREA_GENUINE_HTML = """
<html><body>
<div>شقة للبيع بحي البديعة السعر: 550,000 ريال</div>
<div>المزيد تفاصيل الإعلان نوع العقار سكني المساحة 132 م² غرف النوم 3 عمر العقار جديد</div>
</body></html>
"""


def test_area_leak_is_fixed():
    """No spec table → no area. A number scavenged from the description is not an area."""
    text = _html_to_text(_AREA_LEAK_HTML)
    assert _int_after_label_in_spec_table(text, *AREA_LABELS) is None


def test_area_leak_was_real():
    """Pin the hazard the anchor removes: free text where «المساحة» IS followed straight by a
    number, so the unanchored read adopts it. NOTE — the exact prose that produced the live
    defects could not be replayed: those listings' stored captures are truncated to the
    description (447 chars vs 2,878 average), so the page region the parser actually matched is
    not in our snapshot. What IS proven about them is the outcome — the stored area equals the
    asking price exactly, while the page states a different, plausible area (364.51 m², 910 m²,
    480 m²). This fixture pins the shape; the live rows pin the consequence."""
    text = _html_to_text(_AREA_PROSE_NUMBER_HTML)
    assert _int_after_label(text, *AREA_LABELS) == 550000
    assert _int_after_label_in_spec_table(text, *AREA_LABELS) is None


def test_genuine_area_still_parses():
    """The spec table's own «المساحة» row is unaffected — and is NOT the 550,000 price above it."""
    text = _html_to_text(_AREA_GENUINE_HTML)
    assert _int_after_label_in_spec_table(text, *AREA_LABELS) == 132


def test_area_is_never_the_price():
    """The signature of this class: area coming out exactly equal to the asking price."""
    text = _html_to_text(_AREA_GENUINE_HTML)
    assert _int_after_label_in_spec_table(text, *AREA_LABELS) != 550000


if __name__ == "__main__":
    test_area_leak_is_fixed()
    test_area_leak_was_real()
    test_genuine_area_still_parses()
    test_area_is_never_the_price()
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
