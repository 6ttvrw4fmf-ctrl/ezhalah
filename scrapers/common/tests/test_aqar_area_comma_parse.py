"""Golden tests for scrapers/aqar/enrich_residential.py's _int_after_label() comma fix
(2026-07-17) — old-vs-new over REAL aqar page text harvested from the live DB
(source_capture->source_text snippets, trimmed to the relevant block; advertiser info removed).

The bug: the old capture `(\\d+)` stopped at the FIRST thousands separator, so a comma-grouped
label value was truncated to its leading group — "المساحة 717,928" stored area_m2=717 (live ad
6693642; ad 6708090 stored 739 for 739,100). Downstream, the trg_aqar_parse trigger recomputes
Buy price_per_meter as price_total / NEW.area_m2, so the truncated area also poisoned stored ppm
(717,928 § / 717 m² → 1001 §/m² where the page's own spec row says سعر المتر = 1 §). Live pages
group thousands with the ASCII comma AND the Arabic separator ٬ U+066C ("المساحة: ١٨٬٨٣٧٫١٩ م²",
ad 6658941, stored as 18) — Python's \\d already matches Arabic-Indic digits and int() parses
them, so ONLY the separator broke those shapes.

New contract: a strictly-grouped first alternative (1-3 digits + [,٬]-separated 3-digit groups,
not followed by another digit) with the old plain `\\d+` as fallback. Strict grouping is the
whole point: every shape the old parse handled CORRECTLY parses identically (rooms "3", decimal
"882.49" → 882, malformed "717,9282" → 717, list commas "3, 4" → 3) — the only behaviour change
is consuming real thousands-grouped numbers in full. These goldens pin old and new side by side
on every harvested shape.
"""
from __future__ import annotations

import re
import sys
import types
from typing import Optional

# ── Stub supabase + dotenv so the import chain stays hermetic (same as test_aqar_ppm_parse) ─────
_supabase_mod = types.ModuleType("supabase")


class _StubClient:
    pass


_supabase_mod.Client = _StubClient
_supabase_mod.create_client = lambda url, key: _StubClient()
sys.modules.setdefault("supabase", _supabase_mod)

_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.aqar.enrich_residential import _int_after_label  # noqa: E402

# The label tuples, verbatim from the enrich_residential() call sites — the tests must exercise
# the parser exactly the way production does.
AREA_LABELS = (r"المساحة\s*(?:الكلية|الإجمالية)?", r"\bالمساحة\b")
INTERIOR_LABELS = (r"المساحة\s*الداخلية", r"مساحة\s*البناء")
BEDROOM_LABELS = (r"غرف\s*النوم", r"عدد\s*الغرف")


def _old_int_after_label(html: str, *labels: str) -> Optional[int]:
    """The retired body, verbatim — kept ONLY to document what the old code returned on each
    golden sample. It must never come back into production code."""
    for lbl in labels:
        m = re.search(rf"{lbl}[\s:]*?(\d+)", html)
        if m:
            return int(m.group(1))
    return None


# ── Golden samples — live DB source_text, trimmed ────────────────────────────────────────────────

# Ad 6693642: agricultural land, spec row "المساحة 717,928 م²". Stored area_m2 was 717; with
# price_total 717,928 § the trigger stored ppm 1001 §/m² — the page's own سعر المتر is 1 §.
G_6693642 = ("تفاصيل الإعلان الواجهة 4 شوارع عرض الشارع 50 م المساحة 717,928 م² سعر المتر 1 § "
             "المميزات توفر الماء معلومات الإعلان معلومات إضافية تفاصيل الموقع رقم الإعلان 6693642")

# Ad 6708090: land, spec row "المساحة 739,100 م²". Stored area_m2 was 739 → ppm 7501 §/m²
# (price_total 5,543,250 §) where the page says سعر المتر = 7.5 §.
G_6708090 = ("فرصه للمستثمرين سعر متر البيع 7,5 ريال ملاحظه : نقبل البدل والمقايضة المزيد "
             "تفاصيل الإعلان الواجهة جنوب عرض الشارع 50 م المساحة 739,100 م² سعر المتر 7.5 §")

# Ad 6658941: Arabic-Indic digits + Arabic thousands separator ٬ + Arabic decimal ٫ in the
# description blob. Stored area_m2 was 18 (truncated at ٬); the true total is 18,837.19 m².
G_6658941 = ("قطعة ١١ • ٢٬٨٢٤٫٦٧ م²\n━━━━━━━━━━━━━━\n📐 إجمالي المساحة: ١٨٬٨٣٧٫١٩ م²\n"
             "🏢 نظام البناء: تجاري\n\n• واجهة مباشرة على طريق الجنادرية")

# Ad 6658933: same Arabic-grouped shape, "المساحة: ٢٬٥٢٤٫٨٢ م²". Stored area_m2 was 2.
G_6658933 = ("🔹 قطعة رقم ٢٦ | رأس بلوك مميز\nالمساحة: ٢٬٥٢٤٫٨٢ م²\n✦ ثلاث واجهات:\n"
             "🔹 قطعة رقم ٢٥\nالمساحة: ٢٬٥٨٩٫٠٦ م²")

# Ad 6715558: comma-grouped building area, label-only match via the مساحة البناء fallback.
# Stored interior_space_m2 was 1 (truncated from 1,926).
G_6715558 = ("عر المطلوب:2,500,000 ريال قابل للتفاوض 🔺مساحة البناء 1,926 على ارض 523 م "
             "صاحب الترخيص : مكتب الش")

# Ad 6561841: "إجمالي مساحة البناء: 1,650 م²". Stored interior_space_m2 was 1.
G_6561841 = ("قطعة رقم 580\n🔹 مواصفات المبنى\nإجمالي مساحة البناء: 1,650 م²\n"
             "عدد الغرف: 10 غرف ماستر")

# Ad 6318985 (Rent apartment): canonical non-comma spec row — must be UNCHANGED.
G_6318985 = ("المزيد تفاصيل الإعلان المساحة 80 م² الفئة عوائل غرف النوم 1 الصالات 1 دورات المياه 1 "
             "عمر العقار 6 سنوات المميزات مؤثثة مطبخ دفعات الإيجار 1500 § سنوي دفعة واجدة 1,500 § "
             "على شهري 125 § لكل شهر")

# Ad 6768687: non-comma area in both description and spec row — must be UNCHANGED.
G_6768687 = ("للبيع أرض بحي الرجاء 2/419 بعزيزية الخبر رقم القطعة 1/224 المساحة 412 م الشارع 15 "
             "شمال السعر 450 الف المزيد تفاصيل الإعلان نوع العقار سكني الواجهة شمال عرض الشارع 15 م "
             "المساحة 412 م² سعر المتر 1,093.74 §")

# Ad 6776946: decimal ASCII area "882.49 م²" — the decimal point must still terminate the match
# (truncate toward zero), exactly as the old parse did.
G_6776946 = ("📍 الموقع: حي شاطئ نصف القمر – الدمام 📐 المساحة: 882.49 م² 💰 سعر البيع: 2,200 ريال "
             "للمتر المزيد تفاصيل الإعلان نوع العقار سكني الواجهة شمال عرض الشارع 15 م المساحة 882 م²")


# ── The truncation rows: old = leading group, new = the full grouped number ─────────────────────

def test_area_6693642_comma_grouped():
    assert _old_int_after_label(G_6693642, *AREA_LABELS) == 717        # the stored (wrong) value
    assert _int_after_label(G_6693642, *AREA_LABELS) == 717_928


def test_area_6708090_comma_grouped():
    assert _old_int_after_label(G_6708090, *AREA_LABELS) == 739
    assert _int_after_label(G_6708090, *AREA_LABELS) == 739_100


def test_area_6658941_arabic_separator_and_digits():
    assert _old_int_after_label(G_6658941, *AREA_LABELS) == 18
    # ٬-grouped Arabic-Indic digits consumed in full; the Arabic decimal ٫١٩ truncates.
    assert _int_after_label(G_6658941, *AREA_LABELS) == 18_837


def test_area_6658933_arabic_separator_and_digits():
    assert _old_int_after_label(G_6658933, *AREA_LABELS) == 2
    assert _int_after_label(G_6658933, *AREA_LABELS) == 2_524


def test_interior_6715558_comma_grouped_build_area():
    assert _old_int_after_label(G_6715558, *INTERIOR_LABELS) == 1
    assert _int_after_label(G_6715558, *INTERIOR_LABELS) == 1_926


def test_interior_6561841_comma_grouped_build_area():
    assert _old_int_after_label(G_6561841, *INTERIOR_LABELS) == 1
    assert _int_after_label(G_6561841, *INTERIOR_LABELS) == 1_650


def test_fixed_area_yields_sane_trigger_ppm():
    """Document the downstream repair math: trg_aqar_parse recomputes Buy ppm as
    round(price_total / area_m2) — with the fixed area the exemplars land on the page's own
    سعر المتر instead of the ×1000 poison."""
    assert round(717_928 / _int_after_label(G_6693642, *AREA_LABELS)) == 1        # was 1001
    assert round(5_543_250 / _int_after_label(G_6708090, *AREA_LABELS)) == 8      # was 7501 (7.5 §)


# ── Shapes the OLD parse got right must stay byte-identical ─────────────────────────────────────

def test_non_comma_areas_unchanged():
    for g, want in ((G_6318985, 80), (G_6768687, 412)):
        assert _old_int_after_label(g, *AREA_LABELS) == want
        assert _int_after_label(g, *AREA_LABELS) == want


def test_decimal_area_still_truncates_at_the_point():
    assert _old_int_after_label(G_6776946, *AREA_LABELS) == 882
    assert _int_after_label(G_6776946, *AREA_LABELS) == 882


def test_room_counts_unchanged():
    assert _old_int_after_label(G_6318985, *BEDROOM_LABELS) == 1
    assert _int_after_label(G_6318985, *BEDROOM_LABELS) == 1
    assert _old_int_after_label(G_6318985, r"عمر\s*العقار") == 6
    assert _int_after_label(G_6318985, r"عمر\s*العقار") == 6


def test_list_comma_is_not_a_thousands_separator():
    """A comma NOT followed by a 3-digit group is punctuation, not grouping — old behaviour."""
    for text, want in (
        ("غرف النوم 3, 4 حمامات", 3),          # comma then space
        ("غرف النوم 3,4 مع صالة", 3),           # comma then 1 digit — not a group
        ("غرف النوم 3,45 تقريبا", 3),           # 2 digits — not a group
    ):
        assert _old_int_after_label(text, *BEDROOM_LABELS) == want
        assert _int_after_label(text, *BEDROOM_LABELS) == want


def test_malformed_grouping_keeps_old_parse():
    """4 digits after the comma is not thousands grouping → the strict alternative must back
    off entirely and return exactly what the old parse returned."""
    text = "المساحة 717,9282 م²"
    assert _old_int_after_label(text, *AREA_LABELS) == 717
    assert _int_after_label(text, *AREA_LABELS) == 717


def test_multi_group_number_parses_in_full():
    assert _int_after_label("المساحة 1,234,567 م²", *AREA_LABELS) == 1_234_567


def test_no_label_or_no_number_is_none():
    assert _int_after_label("أرض للبيع في موقع مميز", *AREA_LABELS) is None
    assert _int_after_label("المساحة حسب الصك", *AREA_LABELS) is None
    assert _old_int_after_label("المساحة حسب الصك", *AREA_LABELS) is None
