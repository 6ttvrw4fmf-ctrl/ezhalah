"""rightcompound: the English district names left NULL on live rows map to their catalogued Arabic (#658, 2026-10-18).

Measured 10-18 on active rows with district_ar NULL: «Al Jawhara» 17, «Qurtoba» 15, «Al Tahliyah» 14 (الخبر),
«Rabwah» 10, «Al Bawadi» 7 (جدة), «Sulaimaniah» 8, «Deplomatic Quarter» 8, «Al Ghoroub» 8, «Al-Qayrawan» 7 (الرياض).
Every Arabic value is catalogued for that city (checked against loc_catalog_district the same night).
«King Abdullah Financial» is the site's template text and must stay unmapped.
"""
from scrapers.rightcompound.run import _DISTRICT_EN_AR, _norm_dist

CASES = [
    ("khobar", "Al Jawhara", "حي الجوهرة"), ("khobar", "Qurtoba", "حي قرطبة"),
    ("khobar", "Al Tahliyah", "حي التحلية"), ("khobar", "Bustan", "حي البستان"),
    ("khobar", "Sadafah", "حي الصدفة"), ("riyadh", "Sulaimaniah", "حي السليمانية"),
    ("riyadh", "Deplomatic Quarter", "حي السفارات"), ("riyadh", "Al Ghoroub", "حي الغروب"),
    ("riyadh", "Al-Qayrawan", "حي القيروان"), ("riyadh", "Ishbilia", "حي اشبيلية"),
    ("riyadh", "Al Rafiah", "حي الرفيعة"), ("jeddah", "Rabwah", "حي الربوة"),
    ("jeddah", "Al Bawadi", "حي البوادي"),
]


def test_live_null_english_names_map():
    for city, en, ar in CASES:
        assert _DISTRICT_EN_AR.get((city, _norm_dist(en))) == ar, (city, en)


def test_template_and_city_names_stay_unmapped():
    for city, en in [("riyadh", "King Abdullah Financial"), ("khobar", "King Abdullah Financial"),
                     ("khobar", "Al Khobar"), ("khobar", "Doha"), ("riyadh", "Exit 8")]:
        assert _DISTRICT_EN_AR.get((city, _norm_dist(en))) is None, (city, en)
