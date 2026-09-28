"""Gathern: the search session must not send `source: web` (2026-09-28). With that header the API serves a
web subset — Riyadh 3,267 of 12,972 month-bookable homes, ×4.6 fewer over the top 11 cities — and the
per-city page cap must reach the full catalogue's tail (Riyadh ~1,300 pages at 10 per page)."""
import inspect
import sys
import types

# Hermetic import chain (same pattern as test_gathern_no_description_wipe.py).
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import scrapers.gathern.run as R  # noqa: E402


class _FakeSession:
    def __init__(self, **kw):
        self.headers = {}


def test_the_search_session_sends_no_source_header(monkeypatch):
    monkeypatch.setattr(R.cc, "Session", _FakeSession)   # another test may stub curl_cffi itself
    headers = {k.lower(): v for k, v in R.session().headers.items()}
    assert "source" not in headers
    assert headers.get("accept") == "application/json"


def test_the_page_cap_reaches_the_biggest_citys_tail():
    src = inspect.getsource(R.crawl)
    assert "hard_cap = max_pages or 2000" in src
