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
    for city, en in [("khobar", "Rakaa"),
                     ("khobar", "Al Qashlah"), ("khobar", "Al Douha"), ("khobar", "Dana Bay"), ("jubail", "Khaldiya"),
                     ("riyadh", "King Abdullah Financial"), ("riyadh", "Arizona Golf Resort")]:
        assert _DISTRICT_EN_AR.get((city, _norm_dist(en))) is None, (city, en)


# Read from the live compound pages 2026-10-18 (JSON-LD streetAddress / «X District» sentences, verbatim).
PAGE_CASES = [
    ("khobar", "Prince Hamoud Street no. 22 – AQRABIA Area", "AQRABIA", "حي العقربية"),       # al-ferdouse
    ("khobar", "7316, B4 St., Al Safa", "Al Safa", "حي الصفا"),                              # safa-khobar-residence
    ("riyadh", "Imam Abdullah Ibn Saud Ibn Abdulaziz Rd, Al Janadiriyah", "Al Janadiriyah", "حي الجنادرية"),  # vives
    ("taif", "Alqarahin, Taif, Saudi Arabia", "Alqarahin", "حي القراحين"),                   # meral-oasis
    ("riyadh", "Ar Rahmaniya District", "Ar Rahmaniya", "حي الرحمانية"),                     # tuwaiq-gate
]


def test_the_page_spellings_map():
    from scrapers.rightcompound.run import district_en_candidates
    for city, street, en, ar in PAGE_CASES:
        if "District" not in street:
            assert en in district_en_candidates(street), street
        assert _DISTRICT_EN_AR.get((city, _norm_dist(en))) == ar, (city, en)


def test_a_street_glued_to_the_district_shortens_to_the_district_but_never_past_a_direction():
    from scrapers.rightcompound.run import _name_and_tails
    # j-one-compound-jeddah: «7007 Muhammad Masud As Salamah District Jeddah 23»
    assert "salamah" in _name_and_tails("Masud As Salamah")
    assert _DISTRICT_EN_AR[("jeddah", "salamah")] == "حي السلامة"
    assert "obhur" not in _name_and_tails("South Obhur")          # south Obhur is not (north) Obhur
    assert "diriyah" not in _name_and_tails("New Ad Diriyah")


def test_the_template_sentence_does_not_hide_the_next_district_sentence():
    from scrapers.rightcompound.run import compound_facts
    page = ("<h1>Tuwaiq Gate</h1><p>in King Abdullah Financial District</p><p>located in Ar Rahmaniya District</p>"
            '<script type="application/ld+json">{"@type":"Place","geo":{"latitude":1,"longitude":2},'
            '"address":{"streetAddress":"King Fahad Road","addressLocality":"Riyadh"}}</script>')
    assert compound_facts("https://rightcompound.com/compounds/riyadh/tuwaiq-gate", page)["district_en_candidates"] == ["Ar Rahmaniya"]


def test_khobars_aziziyah_maps_once_admitted_to_its_catalogue():
    # «Aziziyah, Khobar» (gulf-pearl-compound-2), «Aziziyah district» (sea-shore-compound), «Azzizyah» (black-pearl),
    # «Al Aziziyah» (al-nawras) — 14 live units; الخبر's «العزيزية» admitted 2026-10-18 (migration 20261018235112).
    for en in ("Aziziyah", "Azzizyah", "Al Aziziyah"):
        assert _DISTRICT_EN_AR.get(("khobar", _norm_dist(en))) == "حي العزيزية", en
    assert _DISTRICT_EN_AR.get(("riyadh", _norm_dist("Aziziyah"))) is None    # never another city's العزيزية
