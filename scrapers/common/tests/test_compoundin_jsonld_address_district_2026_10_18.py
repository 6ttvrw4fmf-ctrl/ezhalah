"""compoundin: the district the page states in its JSON-LD address, exactly — never the template line (2026-10-18).

158 live rows had no district; 127 of them carried the site's template «King Abdullah Financial» as their
only district text while the page's JSON-LD streetAddress named the real place — in Arabic on
al-malqa-compound: «RRMA3815, 3815 Hajar Valley, 7410، حي الملقا، Riyadh 13524, Saudi Arabia» (rendered
2026-10-18). Other pages state only a road («King Faisal Road», al-danah-al-nadah) or a province (azure-qassim):
those stay NULL. Fixture: the recorded Al Malqa page (JSON-LD + h1 + one unit card, verbatim).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

import scrapers.compoundin.run as C

_TD = Path(__file__).resolve().parents[2] / "compoundin" / "testdata"
PAGE = (_TD / "al-malqa-compound.excerpt.html").read_text(encoding="utf-8")
URL = "https://compoundin.com/compounds/riyadh/al-malqa-compound"
KNOWN = {(1, "حي الملقا"), (1, "حي النرجس"), (1, "حي الرمال"), (1, "حي الياسمين"), (2, "حي الروابي")}


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setattr(C, "to_catalog", lambda city_ar, hint=None: {"الرياض": (1, 1), "الخبر": (2, 1), "بريدة": (3, 4)}.get(city_ar, (None, None)))
    monkeypatch.setattr(C, "find_district_in_text", lambda text, city_id: text if (city_id, text) in KNOWN else None)
    monkeypatch.setattr(C, "_bridge_en_ar", lambda city_en: {"Riyadh": {"rimal": "حي الرمال"}}.get(city_en, {}))


def _page(street, locality="Riyadh", legacy_line=""):
    p = re.sub(r'"streetAddress":\s*"[^"]*"', f'"streetAddress": "{street}"' if street is not None else '"x": "y"', PAGE)
    p = re.sub(r'"addressLocality":\s*"[^"]*"', f'"addressLocality": "{locality}"', p)
    return p.replace("</h1>", "</h1>" + (f"<p>Enjoy living in {legacy_line}.</p>" if legacy_line else ""), 1)


def test_recorded_page_arabic_address_segment_is_the_district():
    assert C.address_segments(PAGE) == ["RRMA3815", "3815 Hajar Valley", "حي الملقا"] or "حي الملقا" in C.address_segments(PAGE)
    rows, why = C.map_units(URL, PAGE)
    assert rows, why
    assert {r["district_ar"] for r in rows} == {"حي الملقا"} and {r["additional_info"]["district_source"] for r in rows} == {"address_ar"}


@pytest.mark.parametrize("street, locality, slug, legacy", [
    ("King Faisal Road", "Al Khobar", "khobar", ""),                 # al-danah-al-nadah: a road is not a district
    (None, "Buraydah", "buraydah", ""),                              # azure-qassim: no street at all
    ("Riyadh 13524, Saudi Arabia", "Riyadh", "riyadh", ""),          # city + postal + country only
    (None, "Riyadh", "riyadh", "King Abdullah Financial"),           # the template line alone
    ("حي الملقا، حي النرجس، Riyadh", "Riyadh", "riyadh", ""),         # two districts named = none
])
def test_mutation_road_province_city_template_or_conflict_is_no_district(street, locality, slug, legacy):
    rows, why = C.map_units(f"https://compoundin.com/compounds/{slug}/x", _page(street, locality, legacy))
    assert rows, why
    assert all(r["district_ar"] is None and "district_source" not in r["additional_info"] for r in rows)


def test_english_segment_goes_dictionary_then_unique_bridge_then_catalogue():
    rows, _ = C.map_units(URL, _page("Al Yasmin District, Riyadh"))            # dictionary («yasmin»)
    assert {r["district_ar"] for r in rows} == {"حي الياسمين"} and {r["additional_info"]["district_source"] for r in rows} == {"dictionary"}
    assert C._DISTRICT_EN_AR.get(("riyadh", C._norm_dist("Ar Rimal"))) is None  # not in the dictionary…
    rows, _ = C.map_units(URL, _page("Ar Rimal, Riyadh"))                          # …the bridge answers, uniquely
    assert {r["district_ar"] for r in rows} == {"حي الرمال"} and {r["additional_info"]["district_source"] for r in rows} == {"bridge"}
    rows, _ = C.map_units(URL, _page("Al Olaya, Riyadh"))                          # dictionary knows it, catalogue (stub) does not
    assert all(r["district_ar"] is None for r in rows)


def test_the_legacy_line_still_answers_when_the_address_is_silent():
    rows, _ = C.map_units(URL, _page(None, "Riyadh", "Al Narjis"))
    assert {r["district_ar"] for r in rows} == {"حي النرجس"} and {r["additional_info"]["district_source"] for r in rows} == {"legacy_line"}


def test_bridge_unique_is_shared_and_exact():
    from scrapers.common.district_bridge import bridge_unique
    rows = [("Al Malaz", "حي الملز"), ("Al-Malaz", "حي الضباط"), ("Ar Rimal", "حي الرمال"), ("Ar Rimal Dist.", "حي الرمال"), ("الرمال", "x")]
    assert bridge_unique(rows, C._norm_dist) == {"rimal": "حي الرمال"}
