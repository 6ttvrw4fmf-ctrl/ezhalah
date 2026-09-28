"""gathern's search session must send `source: web` (reverted regression, 2026-09-28).

Dropping the header (PR #5177) made the search API also return APP-ONLY units — ~4× more, whose gathern.co
pages are 404 (Riyadh sample: web-feed 15/15 HTTP 200, full-feed-only 19/20 HTTP 404). Every Ezhalah card
opens the gathern.co page, so those units became cards that land on «not found».
"""
import sys
import types

sys.path.insert(0, ".")

# Hermetic: no network, no DB client, no dotenv (same pattern as test_gathern_no_description_wipe.py).
for name in ("supabase", "dotenv"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

import scrapers.gathern.run as R  # noqa: E402


class _FakeSession:
    def __init__(self, *a, **k):
        self.headers = {}


def test_the_search_session_asks_for_the_web_openable_catalogue(monkeypatch):
    monkeypatch.setattr(R.cc, "Session", _FakeSession)
    h = {k.lower(): v for k, v in R.session().headers.items()}
    assert h.get("source") == "web"
    assert h.get("accept") == "application/json"
