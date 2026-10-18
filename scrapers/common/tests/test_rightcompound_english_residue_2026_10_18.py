"""rightcompound: the English spellings still left NULL on live rows map to their catalogued Arabic (2026-10-18).

Measured on active rows with no served district: «Almonisya» 7, «Al Qirawan» 6, «Rahmaniah» 4, «alyasmeen» 4,
«Al Hada» 3, «Al Monsyah» 3, «As Safarat» 2, «AlNafel», «Almasif», «Alsulaimaniya», «Almalqa», «Yasameen», «Qirawan»
(الرياض), «Qutuba» 5, «Al Cornish» 5, «The Olya» 4 (الخبر), «Al Shatieh» 2 (جدة), «second industrial zone» 7 (الرياض).
The article is often glued on («Almonisya»), so _norm_dist folds it. Every Arabic value is in loc_catalog_district
for that city (checked the same night). A name with two catalogued answers, or none, stays unmapped.
"""
from scrapers.rightcompound.run import _DISTRICT_EN_AR, _norm_dist

CASES = [
    ("riyadh", "Almonisya", "حي المونسية"), ("riyadh", "Al Monsyah", "حي المونسية"),
    ("riyadh", "Al Qirawan", "حي القيروان"), ("riyadh", "Qirawan", "حي القيروان"),
    ("riyadh", "Rahmaniah", "حي الرحمانية"), ("riyadh", "alyasmeen", "حي الياسمين"),
    ("riyadh", "Yasameen", "حي الياسمين"), ("riyadh", "As Safarat", "حي السفارات"),
    ("riyadh", "AlNafel", "حي النفل"), ("riyadh", "Almasif", "حي المصيف"),
    ("riyadh", "Alsulaimaniya", "حي السليمانية"), ("riyadh", "Almalqa", "حي الملقا"),
    ("riyadh", "Al Hada", "حي الهدا"), ("riyadh", "second industrial zone", "المدينة الصناعية الثانية"),
    ("khobar", "Qutuba", "حي قرطبة"), ("khobar", "Al Cornish", "حي الكورنيش"), ("khobar", "The Olya", "حي العليا"),
    ("jeddah", "Al Shatieh", "حي الشاطئ"),
]


def test_the_residue_spellings_map():
    for city, en, ar in CASES:
        assert _DISTRICT_EN_AR.get((city, _norm_dist(en))) == ar, (city, en)


def test_the_glued_article_folds_and_nothing_else_changes():
    for en, k in [("Almonisya", "monisya"), ("AlNafel", "nafel"), ("The Olya", "olya"), ("Al Munsiyah District", "munsiyah"),
                  ("An Narjis", "narjis"), ("Al-Arid", "arid"), ("Al Malaz", "malaz"), ("Alkhobar", "khobar")]:
        assert _norm_dist(en) == k, en


def test_two_answers_or_no_catalogue_entry_stays_unmapped():
    for city, en in [("khobar", "Rakaa"), ("khobar", "Aziziyah"), ("khobar", "Azzizyah"),
                     ("khobar", "Al Qashlah"), ("khobar", "Al Douha"), ("khobar", "Dana Bay"), ("jubail", "Khaldiya"),
                     ("riyadh", "King Abdullah Financial"), ("riyadh", "Arizona Golf Resort")]:
        assert _DISTRICT_EN_AR.get((city, _norm_dist(en))) is None, (city, en)
