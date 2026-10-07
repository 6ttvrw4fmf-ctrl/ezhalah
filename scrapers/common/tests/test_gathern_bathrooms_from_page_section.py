"""Gathern bathrooms come from the unit page's own «دورات المياة» section when the list item has no
bathtub icon (🔬 AF engineer, 2026-10-07, backlog 135).

2,722 active units stored NULL bathrooms while their own page said «دورة مياه واحدة» / «2 دورات المياة»,
so a customer answering «كم دورة مياه تفضل؟» never found one of them. The section agrees with the icon
on 2,002 of the 2,009 units that carry both. Only the exact header is read: «مرافق دورات المياة» is the
toiletries list, and an empty or unknown wording is silence → None.

    python -m pytest scrapers/common/tests/test_gathern_bathrooms_from_page_section.py -q
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import pytest  # noqa: E402

from scrapers.gathern import run as R  # noqa: E402

# Real extra_sections shapes stored from gathern unit pages (additional_info.extra_sections, 2026-10-07).
_TOILETRIES = {"header": "مرافق دورات المياة", "content": "مناديل صابون شامبو سلبر دش"}


@pytest.mark.parametrize("content,expected", [
    ("دورة مياه واحدة", 1),
    ("2 دورات المياة", 2),
    ("3 دورات المياة", 3),
    ("10 دورات المياة", 10),
    ("", None),                      # an empty block is silence
    ("0 دورات المياة", None),         # never a zero count invented from a form default
    ("دورات مياه مشتركة", None),      # an unknown wording is silence, not a guess
])
def test_section_count(content, expected):
    secs = [_TOILETRIES, {"header": "دورات المياة", "content": content}]
    assert R._bathrooms_from_sections(secs) == expected


def test_toiletries_header_alone_is_silence():
    assert R._bathrooms_from_sections([_TOILETRIES]) is None
    assert R._bathrooms_from_sections(None) is None
    assert R._bathrooms_from_sections(["junk", {"header": None}]) is None


class _Q:
    def __init__(self, rows, sink):
        self.rows, self.sink = rows, sink
    def __getattr__(self, name):
        return lambda *a, **k: self
    def range(self, *a):
        return self
    def execute(self):
        return types.SimpleNamespace(data=self.rows)
    def update(self, payload):
        self.sink.append(payload)
        return self


class _Client:
    def __init__(self, rows):
        self.rows, self.updates = rows, []
    def table(self, _):
        return _Q(self.rows, self.updates)


def _run(monkeypatch, stored_bathrooms):
    rows = [{"ad_number": "G1", "listing_url": "https://gathern.co/view/1/unit/2", "additional_info": {},
             "bathrooms": stored_bathrooms}]
    client = _Client(rows)
    monkeypatch.setattr(R.db, "sb", lambda: client)
    monkeypatch.setattr(R, "fetch_detail", lambda s, url: {
        "description": "x", "extra_sections": [_TOILETRIES, {"header": "دورات المياة", "content": "2 دورات المياة"}]})
    R.backfill_details(None)
    return client.updates


def test_backfill_fills_a_null_count_from_the_page(monkeypatch):
    ups = _run(monkeypatch, None)
    assert ups and ups[0].get("bathrooms") == 2


def test_backfill_never_rewrites_a_stored_count(monkeypatch):
    ups = _run(monkeypatch, 1)
    assert ups and "bathrooms" not in ups[0]
