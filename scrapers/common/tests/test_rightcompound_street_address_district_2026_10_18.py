"""rightcompound: the district the page states in English is read from EVERY shape of its JSON-LD
streetAddress and becomes Arabic only through an exact, unique, catalogued answer (2026-10-18).

690 live rows had no district_ar; 242 of them had no English name at all although their page printed one
(«Al Malaz», «Dana Bay», «Al Douha Neighborhood », «Yasmeen Area - Near Prince Salman Road» — rendered in a
real browser 2026-10-18): only the «…, City» shape was read. The EN→AR step is the hand dictionary, else the
source-attested bridge (public.district_name_bridge: 2,307 English pairs; 219/221 Riyadh keys unique), then
the city's catalogue. An ambiguous bridge key («Al Malaz» → حي الملز AND حي الضباط), an unknown name, the
site's template line and the city's own name all stay NULL — never a guess. Fixture: the recorded Al Bustan
Village page (JSON-LD + h1 + unit blocks, verbatim).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from scrapers.rightcompound import run as R

BRIDGE_READ = R._bridge_en_ar          # the real cached reader, captured before the fixture swaps it

_TD = Path(__file__).resolve().parents[2] / "rightcompound" / "testdata"
PAGE = (_TD / "al-bustan-village.excerpt.html").read_text(encoding="utf-8")
URL = "https://rightcompound.com/compounds/riyadh/al-bustan-village"
KNOWN = {(1, "حي الياسمين"), (1, "حي الملز"), (1, "حي الضباط"), (1, "حي الغدير"), (2, "حي التحلية"), (2, "حي الهدا"), (1, "حي الملك عبدالله المالي")}
BRIDGE = {
    "Riyadh": [{"district_en": "Al Malaz", "district_ar": "حي الملز"}, {"district_en": "Al-Malaz", "district_ar": "حي الضباط"},
               {"district_en": "Malaz", "district_ar": "حي الملز"},
               {"district_en": "King Abdullah Financial", "district_ar": "حي الملك عبدالله المالي"}],   # a future bridge row
    "Khobar": [{"district_en": "Al Hada", "district_ar": "حي الهدا"}, {"district_en": "Al-Hada Dist.", "district_ar": "حي الهدا"},
               {"district_en": "الهدا", "district_ar": "x"}],
}


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, hint=None: {"الرياض": (1, 100), "الخبر": (2, 100)}.get(city_ar, (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", lambda text, city_id: text if (city_id, text) in KNOWN else None)
    monkeypatch.setattr(R, "_bridge_en_ar", lambda city_en: R._bridge_unique(BRIDGE.get(city_en, [])))


def _page(street: str, locality: str) -> str:
    """The recorded page with its JSON-LD address swapped for another LIVE shape (all seen 2026-10-18)."""
    p = re.sub(r'"streetAddress"\s*:\s*"[^"]*"', f'"streetAddress": "{street}"', PAGE)
    return re.sub(r'"addressLocality"\s*:\s*"[^"]*"', f'"addressLocality": "{locality}"', p)


def test_recorded_page_single_segment_address_resolves_through_the_dictionary():
    facts = R.compound_facts(URL, PAGE)
    assert facts["district_en_candidates"] == ["Yasmeen"] and facts["district_en"] == "Yasmeen"
    rows, why, _ = R.map_units(URL, PAGE)
    assert rows, why
    assert {r["district_ar"] for r in rows} == {"حي الياسمين"} and {r["neighborhood"] for r in rows} == {"Yasmeen"}
    assert {r["additional_info"]["district_source"] for r in rows} == {"dictionary"}


@pytest.mark.parametrize("street, locality, slug, want_en", [
    ("Al Malaz", "Riyadh", "riyadh", "Al Malaz"),                       # bridge: الملز AND الضباط → ambiguous
    ("Dana Bay", "Khobar", "khobar", "Dana Bay"),                       # nowhere: not a catalogued district
    ("Al Douha Neighborhood ", "Khobar", "khobar", "Al Douha"),         # unknown; «Neighborhood» is not a name
    ("King Abdullah Financial", "Riyadh", "riyadh", "King Abdullah Financial"),  # the site's template line
    ("Riyadh", "Riyadh", "riyadh", None),                               # the city is never its own district
])
def test_mutation_ambiguous_unknown_template_or_city_text_is_no_district(street, locality, slug, want_en):
    url = f"https://rightcompound.com/compounds/{slug}/x"
    rows, why, _ = R.map_units(url, _page(street, locality))
    assert rows, why
    assert all(r["district_ar"] is None and r["neighborhood"] == want_en for r in rows)
    assert all("district_source" not in r["additional_info"] for r in rows)


def test_the_template_sentence_does_not_mask_the_jsonld_address():
    # al-ghadeer-compound (rendered 2026-10-18): the page prints the template «King Abdullah Financial District»
    # while its JSON-LD streetAddress reads «4100 Northern Ring Rd, Al Ghadir» — 40 live rows stood blank behind it.
    page = _page("4100 Northern Ring Rd, Al Ghadir", "Riyadh").replace("</h1>", "</h1><p>Located in the King Abdullah Financial District area.</p>", 1)
    assert R.compound_facts(URL, page)["district_en_candidates"] == ["Al Ghadir"]
    rows, why, _ = R.map_units(URL, page)
    assert rows, why
    assert {r["district_ar"] for r in rows} == {"حي الغدير"} and {r["additional_info"]["district_source"] for r in rows} == {"dictionary"}
    # …while a REAL «X District» sentence still stands alone, as before.
    page2 = _page("Al Malaz, Riyadh", "Riyadh").replace("</h1>", "</h1><p>Located in the Al Yasmin District of Riyadh.</p>", 1)
    assert R.compound_facts(URL, page2)["district_en_candidates"] == ["Al Yasmin"]


def test_bridge_name_resolves_only_when_unique_and_catalogued():
    assert R._DISTRICT_EN_AR.get(("khobar", R._norm_dist("Al Hada"))) is None     # not in the hand dictionary
    rows, why, _ = R.map_units("https://rightcompound.com/compounds/khobar/x", _page("Al Hada", "Khobar"))
    assert rows, why
    assert {r["district_ar"] for r in rows} == {"حي الهدا"} and {r["additional_info"]["district_source"] for r in rows} == {"bridge"}
    # …and the dictionary still answers first for a name it holds (today's #7446 entry).
    rows, why, _ = R.map_units("https://rightcompound.com/compounds/khobar/x", _page("Al Tahliyah", "Khobar"))
    assert rows and {r["additional_info"]["district_source"] for r in rows} == {"dictionary"}


def test_bridge_unique_drops_ambiguous_keys_and_arabic_keyed_rows():
    assert R._bridge_unique(BRIDGE["Riyadh"]) == {"king abdullah financial": "حي الملك عبدالله المالي"}   # malaz: two answers
    assert R._bridge_unique(BRIDGE["Khobar"]) == {"hada": "حي الهدا"}             # two spellings, one answer; Arabic key ignored
    assert R._bridge_unique([]) == {}


@pytest.mark.parametrize("street, city, want", [
    ("Near Al Thoumamah Rd. Al Munsiyah, Riyadh ", "Riyadh", ["Al Munsiyah"]),
    ("Yasmeen Area - Near Prince Salman Road", "Riyadh", ["Yasmeen"]),
    ("Al Douha Neighborhood ", "Khobar", ["Al Douha"]),
    ("Amr Al Damri Street", "Riyadh", []),
    ("KSA", "Riyadh", []),                                      # the country, 55 live rows showed it as a name
    ("Al Malaz, Riyadh, KSA", "Riyadh", ["Al Malaz"]),
    ("Al Malaz, Al Olaya, Riyadh", "Riyadh", ["Al Malaz", "Al Olaya"]),
    ("", None, []),
])
def test_candidate_segments_are_the_source_words_in_order(street, city, want):
    assert R.district_en_candidates(street, city) == want


def test_two_segments_naming_two_districts_is_no_district(monkeypatch):
    monkeypatch.setattr(R, "_bridge_en_ar", lambda city_en: {"malaz": "حي الملز"})
    rows, why, _ = R.map_units(URL, _page("Al Malaz, Yasmeen Area", "Riyadh"))
    assert rows, why and all(r["district_ar"] is None for r in rows)


def test_a_failed_bridge_read_degrades_to_the_dictionary(monkeypatch, capsys):
    def down(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(R.db, "sb", down)
    BRIDGE_READ.cache_clear()
    try:
        assert BRIDGE_READ("Riyadh") == {}
    finally:
        BRIDGE_READ.cache_clear()
    assert "db down" in capsys.readouterr().out
