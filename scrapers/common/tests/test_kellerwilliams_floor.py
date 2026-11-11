"""Keller Williams floor from the ad's own labelled line (🔬 2026-11-09, kellerwilliams_residential_listings:24214414)."""
from scrapers.kellerwilliams.run import floor_of

REAL = ("الرياض – حي النخيل – برج توين تاور (Twin Tower) المساحة: 122 متر مربع الدور: الرابع (4th Floor) المواصفات: "
        "غرف نوم ماستر بتصميم عصري وأنيق صالة عائلية واسعة")


def test_the_real_ad_states_the_fourth_floor():
    assert floor_of(REAL, "Apartment") == 4


def test_ground_digits_and_types():
    assert floor_of("الدور: الأرضي", "Apartment") == 0
    assert floor_of("الدور : 3", "Floor") == 3
    assert floor_of(REAL, "Villa") is None                 # a villa's «الدور» is not the unit's floor


def test_silence_counts_and_contradictions_stay_null():
    assert floor_of("شقة في الدور الرابع", "Apartment") is None       # unlabelled prose: not read
    assert floor_of("عمارة 3 أدوار", "Apartment") is None
    assert floor_of("الدور: الثاني … الدور: الثالث", "Apartment") is None
    assert floor_of("الدور: الرابعة عشر", "Apartment") is None       # not a whole ordinal we know
    assert floor_of(None, "Apartment") is None
