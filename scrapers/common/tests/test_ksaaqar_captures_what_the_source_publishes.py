"""KSA Aqar publishes a labelled spec block. Every test here exists because a real listing shape,
or a real past incident on another platform, would otherwise be read wrong.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_captures_what_the_source_publishes.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scrapers.ksaaqar.run as K  # noqa: E402
from scrapers.ksaaqar.run import (  # noqa: E402
    district_candidate, parse_age, parse_area, parse_city, parse_deal, parse_direction,
    parse_furnished, parse_licence, parse_price, parse_tristate, parse_type_ar,
    rent_period_and_annual, spec, spec_int,
)

# HERMETIC: map_listing resolves the city against the live catalog, which would make these depend
# on production — and on a machine with no credentials it HANGS rather than fails.
K.to_catalog = lambda city_ar, region_hint=None: (1, 1)
K.find_district_in_text = lambda text, city_id: text

# The real spec block, copied verbatim from a live listing (ksaaqar.com, 2026-09-19).
SPEC = ("الدولة: عقارات الرياض الحالة: غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة "
        "50,000.00SAR (قابل للتفاوض) النوع: للإيجار الحالة: غير مؤجرة "
        "رقم رخصة فال : 1200023153 عدد الغرف : 3 عدد الصالات : 1 دورة المياه : 2 "
        "عدد الأدوار : 2 التكييف : نعم عرض الشارع : ١٥ واجهة العقار : جنوب "
        "عمر العقار : 7 سنوات نوع العقار : سكني التأثيث : مفروشة "
        "الوصف: شقه للايجار حي الملقا ثلاث غرف وصاله")


# ── the field عقاريون shipped at 0% ───────────────────────────────────────────────────────────────
def test_bathrooms_are_captured():
    assert spec_int(SPEC, "دورة المياه", 0, 50) == 2, \
        "«دورة المياه» is published on 72% of pages — it must never ship uncaptured again"


def test_every_measured_field_is_read():
    assert spec_int(SPEC, "عدد الغرف", 0, 50) == 3
    assert spec_int(SPEC, "عدد الصالات", 0, 20) == 1
    assert spec_int(SPEC, "عدد الأدوار", 0, 60) == 2
    assert parse_direction(SPEC) == "جنوب"
    assert parse_age(SPEC) == 7
    assert parse_furnished(SPEC) is True
    assert parse_tristate(SPEC, "التكييف") is True
    assert parse_licence(SPEC) == "1200023153"
    assert parse_city(SPEC) == "الرياض"
    assert parse_deal(SPEC) == "Rent"


# ── street width: the labelled field, never page chrome ───────────────────────────────────────────
def test_street_width_reads_arabic_indic_digits():
    assert spec_int(SPEC, "عرض الشارع", 1, 120) == 15, "«عرض الشارع : ١٥» is fifteen metres"


def test_a_label_value_never_bleeds_into_the_next_label():
    # An unanchored capture read «رسالة على واتساب النوع» and «مؤجرة رقم رخصة فال» as field names —
    # that is two labels swallowed as one. Each value must stop at the next known label.
    assert spec(SPEC, "التكييف") == "نعم"
    assert spec(SPEC, "نوع العقار") == "سكني"
    assert spec_int(SPEC, "عدد الغرف", 0, 50) == 3


# ── price ────────────────────────────────────────────────────────────────────────────────────────
def test_price_is_the_sources_own_figure():
    assert parse_price(SPEC) == 50000


def test_zero_price_is_absence_not_a_free_property():
    assert parse_price("0.00SAR (قابل للتفاوض)") is None, \
        "«0.00SAR» is the theme rendering nothing — a stored 0 tops every cheapest-first search"
    assert parse_price("1,250,000.00SAR") == 1250000


# ── rent period: a monthly figure stored as annual is a 12x error ─────────────────────────────────
def test_monthly_noun_phrase_is_annualised():
    assert rent_period_and_annual(250, "غرفه للإيجار الشهر بـ ( 250 ريال )") == ("monthly", 3000)


def test_shared_period_behaviour_is_not_disturbed():
    # The local wrapper may only ADD where the shared normaliser found nothing.
    assert rent_period_and_annual(3000, "إيجار شهري 3000 ريال") == ("monthly", 36000)
    assert rent_period_and_annual(50000, "للإيجار سنوي 50,000") == ("annual", 50000)
    assert rent_period_and_annual(400, "إيجار يومي 400") == (None, None)


def test_no_period_token_leaves_the_price_as_published():
    assert rent_period_and_annual(50000, "شقه للايجار حي الملقا") == (None, 50000)


# ── area: a number WITH a unit, never prose ───────────────────────────────────────────────────────
def test_area_reads_every_shape_the_source_uses():
    assert parse_area("📐 مساحة الأرض: 525م²") == 525
    assert parse_area("• المساحة: 163.27 متر مربع") == 163
    assert parse_area("مساحة ٢٠٠م² الموقع: حي طويق") == 200
    assert parse_area("♻️المساحة / 620 م") == 620
    assert parse_area("مساحة الأرض الإجمالية: 1,200 م²") == 1200


def test_prose_about_space_is_not_an_area():
    assert parse_area("نوفر لكم مساحة عمل تدعم طموحكم") is None
    assert parse_area("إذا كنت تبحث عن السكن بمساحة مريحة") is None


# ── what must never become inventory ─────────────────────────────────────────────────────────────
def test_wanted_ads_are_not_listings():
    assert parse_deal("النوع: مطلوب") is None, \
        "«مطلوب» is a buyer REQUEST — demand, not a property for sale"


def test_unknown_type_is_skipped_never_guessed():
    assert parse_type_ar("لا يوجد تصنيف", "إعلان بدون نوع") is None


def test_type_falls_back_to_the_title_through_the_SAME_closed_map():
    assert parse_type_ar("no breadcrumb here", "شقه ايجار") == "شقة"
    assert parse_type_ar("no breadcrumb here", "ارض للبيع في بيش") == "أرض"
    assert parse_type_ar("no breadcrumb here", "عقار غامض") is None


def test_agent_reference_code_is_never_a_district():
    assert district_candidate("جديدة RFRA3688, 3688 ... انظر الخريطة") is None, \
        "that slot holds the agent's own code on some listings — a code is not a place"
    assert district_candidate("غير مؤجرة الملقا، الرياض السعودية... انظر الخريطة") == "الملقا"


# ── source is truth ──────────────────────────────────────────────────────────────────────────────
def test_unstated_attribute_is_null_never_false():
    assert parse_tristate("عدد الغرف : 3", "التكييف") is None
    assert parse_furnished("عدد الغرف : 3") is None


def test_open_bound_age_is_unknown_not_the_bound():
    assert parse_age("عمر العقار : أكثر من 10 سنوات") is None, \
        "«more than ten» has no upper bound — storing 10 invents a precision the source withheld"
    assert parse_age("عمر العقار : جديد") == 0


def test_a_number_near_the_word_area_is_not_an_area_without_a_unit():
    # The unit is what makes it a measurement. Without this the pattern would read the «6» of
    # «مساحة 6 غرف» (six ROOMS) as six square metres, and a plan number as a plot size.
    assert parse_area("مساحة 6 غرف نوم") is None
    assert parse_area("المساحة رقم 1532") is None
    assert parse_area("مساحة 600 متر مربع") == 600


def test_age_reads_arabic_indic_digits():
    # «عمر العقار : ٧ سنوات» — the source mixes numeral sets in the same spec block (its street
    # width is Arabic-Indic on most listings while its room counts are Latin).
    assert parse_age("عمر العقار : ٧ سنوات") == 7
    assert parse_age("عمر العقار : ١٢ سنة") == 12


def test_city_survives_the_other_terminators_the_source_prints():
    # «الدولة: عقارات الرياض انظر الخريطة» — the value is followed by «انظر», not by one of the
    # spec labels. A terminator list missing it lost the city on 15% of listings.
    assert parse_city("الدولة: عقارات الرياض انظر الخريطة تم النشر في 24 يوليو") == "الرياض"
    assert parse_city("الدولة: عقارات جدة الحالة: جديدة") == "جدة"


def test_city_fallback_recognises_only_real_saudi_cities():
    # When «الدولة» is absent, the city is RECOGNISED from a closed set — never inferred.
    assert parse_city("لا يوجد حقل دولة", "فله للايجار في الطائف") == "الطائف"
    assert parse_city("لا يوجد حقل دولة", "شقة في حي غير معروف") is None


def test_the_longest_city_name_wins():
    # «المدينة المنورة» must not be read as «المدينة», nor «رأس تنورة» as «تنورة».
    assert parse_city("x", "أرض في المدينة المنورة") == "المدينة المنورة"


def test_a_word_numeral_age_is_not_overrun_by_the_next_field():
    # Two live listings said «سنتين» (2) and «سنة» (1) and were stored as 100 YEARS OLD, because
    # «حدود وأطوال العقار : 100» follows the age and that label was missing from _LABELS. The value
    # ran past its own field and took the next one's number.
    assert parse_age("عمر العقار : سنتين حدود وأطوال العقار : 100 نوع العقار : سكني") == 2
    assert parse_age("عمر العقار : سنة حدود وأطوال العقار : 100 نوع العقار : تجاري") == 1


def test_the_boundaries_label_terminates_the_field_before_it():
    assert spec("عمر العقار : جديد حدود وأطوال العقار : 100", "عمر العقار") == "جديد"
