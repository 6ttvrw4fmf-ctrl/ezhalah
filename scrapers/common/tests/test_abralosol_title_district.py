"""abralosol: an EMPTY tags cell is filled from the ad's h1 ONLY by an exact, city-scoped name match.

96 live rows (2026-10-18; 92 الهفوف, 4 المبرز, both tables) had no neighbourhood while their own title
named the district («بيت جاهز للبيع في الراشديةأ», «أرض للبيع في الحي الخامس ضاحية هجرج»). SOURCE IS
TRUTH: the title may fill `neighborhood` only where a whole slice of it keys — norm_district_tok, the
catalogue's own key — to a district already attested for that city: loc_catalog_district plus the
districts this office's own tags cell published there. The site glues the plot's block letter to the
district («الراشديةأ» ×12, «هجرد» ×6), so one trailing أ/ب/ج/د is split off before the SAME exact
comparison. No edit distance, no prefix, no fragment, no guess; the stored value is the title's own
spelling. Owner (10-18): the 11 ads whose title ends at «في» / a plot number, «مخطط الرياض» (5249, a
plan) and «شمال المبرز» (6997, a direction) are CITY matches — district NULL. The recorded page is the
real /6503 (fetched 2026-10-18). Every title below is a live one, copied verbatim.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from scrapers.abralosol import run as R
from scrapers.common import arabic_location as AL
from scrapers.common import db

_TD = Path(__file__).resolve().parents[2] / "abralosol" / "testdata"
PAGE = (_TD / "6503.excerpt.html").read_text(encoding="utf-8")

# Read-only snapshot (2026-10-18) of what the two halves hold for الهفوف — enough to make every
# assertion below real: the office's own tags-cell names and loc_catalog_district (city 12).
SEEN_HOFUF = ("ضاحية هجر", "ضاحية هجر الحي الثاني", "الراشدية", "جنوب المنسوب", "الفيصلية", "الدانة الهفوف",
              "الرياض", "مخطط الرياض", "الهفوف", "الاحساء", "محاسن أرامكو", "الراجحي", "الغسانية", "هجر")
CATALOG_HOFUF = ("حي الزهرة", "حي هجر", "حي الرياض", "المبرز")


def K(*names: str) -> frozenset[str]:
    return frozenset(AL.norm_district_tok(n) for n in names)


KNOWN = K(*SEEN_HOFUF, *CATALOG_HOFUF)


@pytest.fixture(autouse=True)
def _fresh_cache():
    R._known_districts.cache_clear()
    yield
    R._known_districts.cache_clear()


class _Resp:
    status_code, text = 200, PAGE


class _S:  # serves the recorded /6503 for any URL
    def get(self, url, **_k):
        return _Resp()


def _ix(tags_html: str = "") -> dict:
    """An index row for 6503 through the shipping parser; the tags cell is EMPTY unless given."""
    return R._parse_index({"nid": "6503", "cells": {
        "view-field-als-r-table-column": "السعر\n600,000<br>",
        "view-nothing-1-table-column": "المساحة 925.5 م شارع 15+15",
        "view-field-tags-table-column": tags_html,
        "view-nothing-table-column": '<a href="/6503" hreflang="ar">أرض<br>للبيع</a>',
    }})


def test_recorded_6503_page_fills_the_empty_tags_cell_from_its_h1(monkeypatch):
    detail = R._detail(_S(), "6503")
    assert detail["title"] == "أرض للبيع في الحي الخامس ضاحية هجرج"     # «هجر» + the glued block letter ج
    monkeypatch.setattr(R, "_known_districts", lambda city: KNOWN)
    ix = _ix()
    assert ix["district"] is None
    row, cat = R.map_listing(ix, detail)
    assert row["neighborhood"] == "ضاحية هجر"                           # the suburb, as the h1 wrote it
    assert row["additional_info"]["district_ar"] == "ضاحية هجر"
    assert row["additional_info"]["district_from"] == "title"
    # city resolution is untouched: decided before the title is read, from the same rules as before
    assert (row["city"], row["additional_info"]["city_basis"]) == ("Hofuf", "office_default")
    assert cat == "residential"


@pytest.mark.parametrize("title, want", [
    ("بيت جاهز للبيع في الراشديةأ", "الراشدية"),                          # glued block letter split off
    ("أرض سكنية للبيع في ضاحية هجر الحي الثانيج", "ضاحية هجر الحي الثاني"),  # longest attested name wins
    ("أرض للبيع في جنوب المنسوب 400 د", "جنوب المنسوب"),                  # plot number + block letter ignored
    ("شقة للبيع في دانة الهفوف", "دانة الهفوف"),                           # title spelling, not «الدانة الهفوف»
    ("فيلا للبيع في محاسن ارامكو _ الثانيه", "محاسن ارامكو"),               # title spelling, not «محاسن أرامكو»
    ("شقة للإيجار في حي الراجحي", "حي الراجحي"),                           # the title's «حي » is kept
    ("أرض للبيع في الغسانيه", "الغسانيه"),                                 # ة/ه folds for matching only
    ("عمارة سكنية جاهز للبيع في الزهرة", "الزهرة"),                        # catalog «حي الزهرة», stored as written
    ("أرض في ضاحية هجر", "ضاحية هجر"),                                     # not the shorter «هجر»
])
def test_exact_match_stores_the_titles_own_spelling_longest_first(title, want):
    assert R._title_district(title, KNOWN) == want


@pytest.mark.parametrize("title, known", [
    ("أرض في ضاحية هجرة", K("ضاحية هجر")),                 # one letter added — ة is no block letter
    ("شقة للإيجار في الراجحية", K("الراجحي")),              # prefix of a longer word
    ("أرض للبيع في جوهرة", K("جوهرة الهادي")),              # fragment of a longer known name
    ("أرض للبيع في الغسانيا", K("الغسانية")),               # one letter changed
    ("فيلا جاهز للبيع في عين النجم", K("حي عين نجم")),      # live 4674: «النجم» is not «نجم»
    ("عمارة سكنية جاهز للبيع في السبعان", KNOWN),           # live 5021: attested nowhere for الهفوف
    ("مزرعة صك للبيع في الشعبة", KNOWN),                    # live 5371: only «قرية الشعبة»/«دانة الشعبة» are
    ("أرض للبيع في حي الراجحي", frozenset()),               # nothing known for the city
    (None, KNOWN),
])
def test_mutation_fuzzy_partial_or_unknown_title_district_is_never_filled(title, known):
    assert R._title_district(title, known) is None


@pytest.mark.parametrize("title", [
    "عمارة تجارية جاهز للبيع في",          # 4784 — title ends at «في»
    "بيت جاهز للبيع في",                   # 5956
    "أرض للبيع في 243 أ",                  # 5023 — a plot number is not a district
    "أرض للبيع في 4 ج",                    # 5342
    "أرض سكنية للبيع في 2/643",            # 6009
    "أرض للبيع في مخطط الرياض 551 د",      # 5249 — a PLAN, though «الرياض» and «مخطط الرياض» are both attested
    "أرض للبيع في مخطط الر ياض 551 د",     # 5249 exactly as the page spells it
    "أرض خام للبيع في شمال المبرز",        # 6997 — a direction from a town; «المبرز» is a catalog row for city 12
    "أرض للبيع في الهفوف",                 # the tags cell has filed «الهفوف» as a neighbourhood; still a town
])
def test_mutation_owner_city_level_ads_stay_null(title):
    assert R._title_district(title, KNOWN) is None


def test_tags_cell_district_wins_and_the_lookup_is_never_consulted(monkeypatch):
    def boom(city):
        raise AssertionError("looked districts up although the tags cell had one")
    monkeypatch.setattr(R, "_known_districts", boom)
    row, _ = R.map_listing(_ix("الحزم"), R._detail(_S(), "6503"))
    assert row["neighborhood"] == "الحزم" and "district_from" not in row["additional_info"]


def test_title_district_is_computed_after_the_city_and_never_moves_it(monkeypatch):
    # An ad whose text names المبرز: _city() says Mubarraz (ad_text) exactly as before, and only then
    # is المبرز's own name set asked.
    asked = []
    monkeypatch.setattr(R, "_known_districts", lambda city: asked.append(city) or K("الحزم"))
    detail = {**R._detail(_S(), "6503"), "title": "بيت عربي للبيع في المبرز حي الحزم"}
    row, _ = R.map_listing(_ix(), detail)
    assert (row["city"], row["additional_info"]["city_basis"]) == ("Mubarraz", "ad_text")
    assert row["neighborhood"] == "حي الحزم" and asked == ["Mubarraz"]


class _Q:
    """A PostgREST chain whose every step returns itself and whose .data is fixed."""
    def __init__(self, data):
        self.data = data

    def __getattr__(self, name):
        return lambda *a, **k: self


def test_known_districts_is_catalog_plus_this_offices_own_tags_once_per_city(monkeypatch):
    calls = []
    monkeypatch.setattr(db, "sb", lambda: calls.append(1) or _Q(
        [{"neighborhood": "ضاحية هجر"}, {"neighborhood": None}, {"neighborhood": ""}]))
    monkeypatch.setattr(db, "_execute", lambda q, **k: q)
    monkeypatch.setattr(AL, "to_catalog", lambda ar, region_hint=None: (12, 5) if ar == "الهفوف" else (None, None))
    monkeypatch.setattr(AL, "catalog_district_keys", lambda cid: K("حي الزهرة") if cid == 12 else frozenset())
    assert R._known_districts("Hofuf") == K("حي الزهرة", "ضاحية هجر")
    R._known_districts("Hofuf")
    assert len(calls) == 2            # two tables, ONE pass — the second call is served from the cache


def test_a_failed_lookup_fills_nothing_and_never_crashes_the_crawl(monkeypatch, capsys):
    def down(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(AL, "to_catalog", down)
    assert R._known_districts("Hofuf") == frozenset()
    assert "db down" in capsys.readouterr().out
    row, _ = R.map_listing(_ix(), R._detail(_S(), "6503"))
    assert row["neighborhood"] is None and row["city"] == "Hofuf"
