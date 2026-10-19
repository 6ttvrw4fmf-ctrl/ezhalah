"""compoundin: the English spellings that left new rows without a district (2026-10-06).

The weekly field-fill comparison flagged compoundin: rows first seen since the 10-02 address move
carried a district on 1 of 18 (84 of 248 before). The source wrote «Ishbilia», «Located in
Qurtubah», «Qurtoba District», «Al Mursalat District», «Well located in AlRehab» — none matched the
map. Each is an unambiguous transliteration of a district already catalogued for that city.
"""
from __future__ import annotations

import pytest

import scrapers.compoundin.run as C


@pytest.mark.parametrize("raw,city,expect", [
    ("Ishbilia", "riyadh", "حي اشبيلية"),
    ("Located in Qurtubah", "riyadh", "حي قرطبة"),
    ("Qurtoba District", "riyadh", "حي قرطبة"),
    ("Al Mursalat District", "riyadh", "حي المرسلات"),
    ("Ghirnatah District", "riyadh", "حي غرناطة"),
    ("Well located in AlRehab", "jeddah", "حي الرحاب"),
    ("Al Rawabi District", "khobar", "حي الروابي"),          # 9 live NULL rows, 10-06
    ("Rabwah District", "riyadh", "حي الربوة"),
    ("Al Safa District", "riyadh", "حي الصفا"),
    ("Sulimania District", "riyadh", "حي السليمانية"),
    ("Al Narjis District", "riyadh", "حي النرجس"),          # unchanged behaviour
])
def test_new_spellings_map(raw, city, expect):
    nd = C._norm_dist(raw)
    cand = C._DISTRICT_EN_AR.get((city, nd))
    if cand is None and nd.startswith("al") and " " not in nd:
        cand = C._DISTRICT_EN_AR.get((city, nd[2:]))
    assert cand == expect


def test_unknown_or_other_city_stays_null():
    assert C._DISTRICT_EN_AR.get(("riyadh", C._norm_dist("Well located in AlRehab"))) is None
    for city in ("riyadh", "khobar", "makkah"):   # the site's template text, not a district
        assert C._DISTRICT_EN_AR.get((city, C._norm_dist("King Abdullah Financial"))) is None


def test_map_units_writes_the_catalogued_district(monkeypatch):
    html = ('<h1>Olaris</h1> Residential compound for rent in Riyadh. Located in Qurtubah District, close to '
            '<article class="cin-unit-card x"><h3 class="cin-unit-card__title">Apartment</h3></article>')
    monkeypatch.setattr(C, "to_catalog", lambda city_ar: (1, 1))
    seen = []
    monkeypatch.setattr(C, "find_district_in_text", lambda cand, cid: seen.append(cand) or cand)
    C.map_units("https://compoundin.com/compounds/riyadh/olaris-residence", html)
    assert seen == ["حي قرطبة"]
