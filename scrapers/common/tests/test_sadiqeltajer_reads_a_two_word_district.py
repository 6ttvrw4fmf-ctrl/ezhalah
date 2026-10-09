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
CATALOG = ["حي القاع البارد", "حي الغدير", "حي الرابية"]


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(L, "_CITY", {"بريده": [(BURAIDAH, 4)]})          # non-empty → no DB load
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {BURAIDAH: {L.norm_district_tok(d) for d in CATALOG}})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_NORM", {L.norm_district_tok(d): d for d in CATALOG})


def resolve(text: str):
    return L.find_district_in_text(S.district_window(text), BURAIDAH)   # the REAL resolver (another test stubs S.find_district_in_text)


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
