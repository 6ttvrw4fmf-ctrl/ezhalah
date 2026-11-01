"""Gathern: a unit its own page rates shows that rating — the list API's 0/0 never hides it.

THE BUG THIS PINS (2026-10-03, owner: «make sure the ratings show in gathern»). The rating came only
from the list API (total_present / total_reviews). For about 1 unit in 6 that list sends 0/0 although
the unit's page prints a score — unit 210265 (حي الملقا): list 0/0, page «8.6 (7 تقييم)». 1,536 of
4,673 live Gathern cards showed no rating. Three halves, all needed:
  1. the detail reader saves the page's own total_present / total_reviews (never the host's average);
  2. the daily crawl carries them forward when the list leaves them out (it rebuilds additional_info);
  3. the backfill visits rows missing a review count, not only rows missing a description.

Run: python -m pytest scrapers/common/tests/test_gathern_rating_from_the_units_own_page.py -q
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Hermetic: db.py must import with no credentials and no network.
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.gathern.run as G  # noqa: E402
from scrapers.common.db import _GATHERN_DETAIL_AI_KEYS, _carry_forward_ai  # noqa: E402


def _page(data: dict) -> str:
    nd = {"props": {"pageProps": {"serverData": {"data": data}}}}
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(nd)}</script></html>'


class _Session:
    def __init__(self, html: str):
        self.html = html

    def get(self, url, timeout=30):
        return types.SimpleNamespace(status_code=200, text=self.html)


def test_the_units_own_page_rating_is_read_and_carried_and_revisited(monkeypatch):
    monkeypatch.setattr(G, "_throttle", lambda: None)

    # 1. The page's own score — the shape of unit 210265 — never the host's average.
    unit = _page({"total_present": 8.6, "total_reviews": 7, "rate_text": "ممتاز",
                  "host_info": {"avg_reviews": 9.3, "total_reviews": 140}})
    d = G.fetch_detail(_Session(unit), "https://gathern.co/view/149616/unit/210265")
    assert d.get("rating") == 8.6 and d.get("reviews_count") == 7, d
    unrated = G.fetch_detail(_Session(_page({"total_present": 0, "total_reviews": 0})), "https://gathern.co/x")
    assert "rating" not in unrated and unrated.get("reviews_count") == 0, "0 reviews is the page's answer"

    # 2. The crawl rebuilds additional_info: a list 0/0 (keys left out) keeps the page's score; a
    #    list that does rate the unit stays authoritative.
    rows = [{"ad_number": "GTH210265", "additional_info": {"monthly_price": 5000}},
            {"ad_number": "GTH2", "additional_info": {"monthly_price": 4000, "rating": 9.1, "reviews_count": 12}}]
    stored = {"GTH210265": {"rating": 8.6, "reviews_count": 7},
              "GTH2": {"rating": 7.0, "reviews_count": 3}}
    _carry_forward_ai(rows, stored, _GATHERN_DETAIL_AI_KEYS)
    assert rows[0]["additional_info"]["rating"] == 8.6 and rows[0]["additional_info"]["reviews_count"] == 7
    assert rows[1]["additional_info"]["rating"] == 9.1, "the crawl's own rating wins"

    # 3. The backfill worklist reaches a described row that still has no review count.
    filters: list[tuple] = []

    class _Q:
        def __getattr__(self, name):
            def call(*a, **k):
                filters.append((name, a))
                return self
            return call

        def execute(self):
            return types.SimpleNamespace(data=[])

    monkeypatch.setattr(G.db, "sb", lambda: types.SimpleNamespace(table=lambda t: _Q()))
    G.backfill_details(_Session(""))
    assert ("or_", ("description.is.null,additional_info->reviews_count.is.null",)) in filters, filters
