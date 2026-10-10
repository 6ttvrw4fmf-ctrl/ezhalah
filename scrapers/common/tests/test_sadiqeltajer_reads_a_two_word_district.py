"""صادق التاجر: a two-word district keeps its second word (2026-10-09).

The location line runs straight on into the page's next words («القصيم - بريدة - الغدير اعلانات
مشابهة»), so parse_location() stops the district at the first space. That cut «القصيم - بريدة -
القاع البارد» to «القاع», which no catalog knows in بريدة: 49 searchable ads carried no district
on 2026-10-09 although their own URLs read «بحي-القاع-البارد» and the catalog has «حي القاع البارد».
district_window() hands the resolver the district word plus the next two words; the resolver tries
3-, 2-, then 1-word windows against the catalog only, so nothing is guessed.

Executed against the REAL find_district_in_text() over an injected catalog (no database).

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_reads_a_two_word_district.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.common.arabic_location as L  # noqa: E402
import scrapers.sadiqeltajer.run as S  # noqa: E402

BURAIDAH = 11
CATALOG = ["حي القاع البارد", "حي الغدير", "حي الرابية", "حي الربيع"]


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(L, "_CITY", {"بريده": [(BURAIDAH, 4)]})          # non-empty → no DB load
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {BURAIDAH: {L.norm_district_tok(d) for d in CATALOG}})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_NORM", {L.norm_district_tok(d): d for d in CATALOG})


def resolve(text: str):
    # The REAL resolver: another test module stubs S.find_district_in_text at import time.
    saved = S.find_district_in_text
    S.find_district_in_text = L.find_district_in_text
    try:
        return S.resolve_district(text, BURAIDAH)
    finally:
        S.find_district_in_text = saved


def test_a_two_word_district_resolves_whole():
    text = "الموقع حسب الصك القصيم - بريدة - القاع البارد اعلانات مشابهة 9 1 م²"
    assert S.parse_location(text) == ("القصيم", "بريدة", "القاع")      # the regex still stops early
    assert resolve(text) == "حي القاع البارد"


@pytest.mark.parametrize("district", ["الغدير", "الرابية"])
def test_a_one_word_district_is_unchanged(district):
    text = f"الموقع حسب الصك القصيم - بريدة - {district} اعلانات مشابهة 9 1 م² 5 ريال"
    assert resolve(text) == f"حي {district}"


def test_an_unknown_district_stays_unknown():
    text = "الموقع حسب الصك القصيم - بريدة - الهدية اعلانات مشابهة"
    assert resolve(text) is None


def test_a_later_page_word_is_never_read_as_the_district():
    # Live 2026-10-09: «… بريدة - المطار» (ad URLs «بحي-المطار»; المطار is not in the بريدة catalog)
    # followed by page text naming «الربيع». A window that does not START at the district word
    # must never match, so the ad keeps no district instead of a wrong one.
    text = "الموقع حسب الصك القصيم - بريدة - المطار الربيع اعلانات"
    assert resolve(text) is None


def _words(text: str):
    saved = S.find_district_in_text
    S.find_district_in_text = L.find_district_in_text
    try:
        return S.resolve_district_words(text, BURAIDAH)
    finally:
        S.find_district_in_text = saved


def test_the_card_neighbourhood_carries_the_full_words():
    # 2026-10-10: the district resolved to «حي القاع البارد» but the card still printed «القاع, بريدة»
    # because `neighborhood` kept the one-word read. The matched words are what map_row stores.
    text = "الموقع حسب الصك القصيم - بريدة - القاع البارد اعلانات مشابهة 9 1 م²"
    assert _words(text) == ("حي القاع البارد", "القاع البارد")
    assert _words("الموقع حسب الصك القصيم - بريدة - الغدير اعلانات مشابهة") == ("حي الغدير", "الغدير")
    assert _words("الموقع حسب الصك القصيم - بريدة - الهدية اعلانات مشابهة") == (None, "الهدية")


def test_map_row_stores_the_matched_words_as_neighborhood():
    src = (ROOT / "scrapers" / "sadiqeltajer" / "run.py").read_text(encoding="utf-8")
    assert "district_raw = district_words" in src
