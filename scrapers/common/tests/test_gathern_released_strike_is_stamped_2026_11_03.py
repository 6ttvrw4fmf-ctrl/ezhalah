"""A struck Gathern unit the crawl releases because its own page read LIVE is stamped as a direct
live read (2026-11-03). It used to be released unstamped, so 6 units read live at the 05:08 crawl
stayed «served, no check > 26 h» until the sweep came back (spot-check 41626783236 read all 6 live).
"""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

import scrapers.gathern.run as R  # noqa: E402
from scrapers.common import db  # noqa: E402


class _Q:
    def __init__(self, data):
        self._data = data

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return types.SimpleNamespace(data=self._data)


def test_released_unit_carries_the_direct_alive_marker_and_held_one_does_not(monkeypatch):
    stored = [{"ad_number": "GTH1", "missing_count": 3, "active": False},
              {"ad_number": "GTH2", "missing_count": 2, "active": True}]
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q(stored)))
    pages = {"1": (404, "<html>not found</html>"), "2": (200, "<html>unit</html>")}
    monkeypatch.setattr(R._probe, "fetch", lambda url: (*pages[url.rsplit("/", 1)[1]], False))
    monkeypatch.setattr(R, "_oracle_signal", lambda st, body, _m: "live" if st == 200 and body else None)
    rows = [{"ad_number": a, "listing_url": f"https://gathern.co/view/1/unit/{a[3:]}"} for a in ("GTH1", "GTH2")]
    held = R.held_strikes(rows)
    assert held == {"GTH1": (3, False)}
    assert rows[1].get(db._DIRECT_ALIVE_KEY) == "gathern.held_strikes.own_page_live"
    assert db._DIRECT_ALIVE_KEY not in rows[0]
