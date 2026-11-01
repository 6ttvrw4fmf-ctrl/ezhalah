"""A feed sighting may not un-hide, or clear the strikes of, a Gathern unit whose own page is not live.

2026-10-02: Gathern's search feed keeps serving units whose gathern.co page is 404 (30 of 30 confirmed
from a second network). The crawl's upsert reset every feed row to active / 0 strikes, so a unit the
page check had hidden was back in search at the next crawl, every day.
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


def _rows(*ads):
    return [{"ad_number": a, "listing_url": f"https://gathern.co/view/1/unit/{a[3:]}"} for a in ads]


def test_a_struck_unit_is_held_unless_its_own_page_answers_live(monkeypatch):
    stored = [{"ad_number": "GTH1", "missing_count": 3, "active": False},
              {"ad_number": "GTH2", "missing_count": 1, "active": True},
              {"ad_number": "GTH3", "missing_count": 3, "active": False}]
    monkeypatch.setattr(R.db, "sb", lambda: types.SimpleNamespace(table=lambda _n: _Q(stored)))
    pages = {"1": (404, "<html>not found</html>"), "2": (200, "<html>unit</html>"), "3": (200, "")}
    monkeypatch.setattr(R._probe, "fetch", lambda url: (*pages[url.rsplit("/", 1)[1]], False))
    held = R.held_strikes(_rows("GTH1", "GTH2", "GTH3", "GTH4"))
    # 404 → held; live page → released; an empty 200 proves nothing → held; never struck → not held
    assert held == {"GTH1": (3, False), "GTH3": (3, False)}


def test_the_upsert_keeps_a_held_units_strikes_and_hidden_state(monkeypatch):
    sent = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: types.SimpleNamespace(
        upsert=lambda grp, **k: sent.extend(grp) or "q")))
    monkeypatch.setattr(db, "_execute", lambda q, **k: None)
    for fn in ("_sanitize_price", "_unknown_must_not_overwrite_known", "_redact_user_visible_text",
               "_sanitize_ints", "_ensure_capture"):
        monkeypatch.setattr(db, fn, lambda r, **k: None)
    for fn in ("_reject_placeholder_location", "_reject_unusable_listing_url", "_apply_direct_alive"):
        monkeypatch.setattr(db, fn, lambda r, **k: None)
    db._wasalt_batch("gathern_residential_listings", _rows("GTH1", "GTH4"), strikes={"GTH1": (3, False)})
    by = {r["ad_number"]: r for r in sent}
    assert (by["GTH1"]["missing_count"], by["GTH1"]["active"]) == (3, False)   # still hidden
    assert (by["GTH4"]["missing_count"], by["GTH4"]["active"]) == (0, True)    # normal feed row
    assert by["GTH1"]["last_seen_at"] == by["GTH4"]["last_seen_at"]            # the sighting is recorded
