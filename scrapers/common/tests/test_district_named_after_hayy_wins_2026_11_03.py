"""The text's own «حي X» outranks a longer place name used as a landmark (2026-11-03).

ksaaqar 12226649 «فيلا دوبلكس للبيع في حي العارض شمال ريحانه غرب الملك عبد العزيز» stored «حي الملك عبدالعزيز»:
find_district_in_text() tried 3-word windows anywhere first, so the road outranked the district the ad names.
Executed against the REAL find_district_in_text() over an injected catalog (no database).
"""
from __future__ import annotations

import sys
import types

import pytest

_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.common.arabic_location as L  # noqa: E402

RIYADH = 1
CATALOG = ["حي العارض", "حي الملك عبدالعزيز", "حي الملك فهد", "حي الرمال", "حي اليرموك", "حي النرجس"]


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(L, "_CITY", {"الرياض": [(RIYADH, 1)]})
    monkeypatch.setattr(L, "_DISTRICT_BY_CITY", {RIYADH: {L.norm_district_tok(d) for d in CATALOG}})
    monkeypatch.setattr(L, "_DISTRICT_AR_BY_NORM", {L.norm_district_tok(d): d for d in CATALOG})


def f(t):
    return L.find_district_in_text(t, RIYADH)


def test_the_named_district_beats_a_landmark_road():
    assert f("فيلا دوبلكس للبيع في حي العارض شمال ريحانه غرب الملك عبد العزيز مساحه ٢٥٠") == "حي العارض"
    assert f("للبيع ارض بحي الرمال قريب من طريق الملك فهد") == "حي الرمال"


def test_a_multi_word_named_district_is_read_whole():
    assert f("فيلا في حي الملك فهد قريبة من النرجس") == "حي الملك فهد"


def test_two_different_named_districts_fall_back_to_the_old_scan():
    # a conflict is not a choice made here: the unchanged scan decides (longest window first)
    assert f("فيلا في حي العارض او حي الملك عبد العزيز") == "حي الملك عبدالعزيز"


def test_texts_without_a_named_district_are_unchanged():
    assert f("فيلا شمال الرياض غرب الملك عبد العزيز") == "حي الملك عبدالعزيز"
    assert f("شقة للايجار النرجس") == "حي النرجس"
    assert f("فيلا في حي غير معروف") is None
    assert f("") is None
