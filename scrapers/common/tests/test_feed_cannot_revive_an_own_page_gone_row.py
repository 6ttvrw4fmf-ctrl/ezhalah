"""A crawl sighting may not un-hide a row whose newest own-page reading is GONE (2026-11-02, ♻️).

Every crawl writes through db._wasalt_batch, which reset missing_count = 0 / active = true for any row
the site's list still served. nowaisiry NW4538 was hidden on 10-31 after two CI 404 reads, the 11-01
crawl revived it, and the 11-02 dead-visible score found it dead on screen; muhaysini MHS42 / MHS2213
were killed 3/3 on HTTP 400 every ~3 days since 10-17 and revived by every crawl. Only the ad's own
page may undo a hide (rulebook protection 4); the feed is weaker evidence.
"""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

from scrapers.common import db  # noqa: E402

T = "nowaisiry_residential_listings"
HIDDEN = [
    {"ad_number": "NW4538", "missing_count": 2, "last_verified_alive_at": "2026-10-29T05:57:34+00:00"},
    {"ad_number": "NW1", "missing_count": 3, "last_verified_alive_at": "2026-11-01T00:00:00+00:00"},
    {"ad_number": "NW2", "missing_count": 3, "last_verified_alive_at": None},
    {"ad_number": "NW3", "missing_count": 3, "last_verified_alive_at": None},
]
PROBES = [
    {"ad_number": "NW4538", "verdict": "GONE", "probed_at": "2026-10-31T11:11:04+00:00"},
    # alive proven AFTER the gone reading -> a real comeback, not held
    {"ad_number": "NW1", "verdict": "GONE", "probed_at": "2026-10-31T00:00:00+00:00"},
    # newest reading is not GONE -> not held
    {"ad_number": "NW2", "verdict": "GONE", "probed_at": "2026-10-20T00:00:00+00:00"},
    {"ad_number": "NW2", "verdict": "ALIVE", "probed_at": "2026-10-25T00:00:00+00:00"},
    # NW3: hidden on absence alone, no reading at all -> not held (the feed sighting revives it)
]


def test_only_rows_whose_newest_own_page_reading_is_gone_are_held():
    assert db.page_gone_holds(HIDDEN, PROBES) == {"NW4538": (2, False)}


class _Q:
    def __init__(self, data, sent=None):
        self._data, self._sent = data, sent

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def upsert(self, grp, **_k):
        self._sent.extend(grp)
        return self

    def execute(self):
        return types.SimpleNamespace(data=self._data)


def _wire(monkeypatch, sent):
    tables = {T: _Q(HIDDEN, sent), "ops_stale_inactivation_probe": _Q(PROBES, sent)}
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda n: tables[n]))
    for fn in ("_sanitize_price", "_unknown_must_not_overwrite_known", "_redact_user_visible_text",
               "_sanitize_ints", "_ensure_capture", "_reject_placeholder_location",
               "_reject_unusable_listing_url"):
        monkeypatch.setattr(db, fn, lambda r, **k: None)


def test_the_crawl_keeps_an_own_page_gone_row_hidden(monkeypatch):
    sent: list = []
    _wire(monkeypatch, sent)
    db._wasalt_batch(T, [{"ad_number": a} for a in ("NW4538", "NW1", "NW3", "NW9")])
    by = {r["ad_number"]: r for r in sent}
    assert (by["NW4538"]["active"], by["NW4538"]["missing_count"]) == (False, 2)   # stays hidden
    for a in ("NW1", "NW3", "NW9"):
        assert (by[a]["active"], by[a]["missing_count"]) == (True, 0), a
    assert by["NW4538"]["last_seen_at"] == by["NW9"]["last_seen_at"]               # sighting recorded


def test_this_crawls_own_live_page_read_releases_the_hold(monkeypatch):
    sent: list = []
    _wire(monkeypatch, sent)
    row = {"ad_number": "NW4538", db._DIRECT_ALIVE_KEY: "nowaisiry.own_page"}
    monkeypatch.setattr(db, "_apply_direct_alive", lambda r, **k: r.pop(db._DIRECT_ALIVE_KEY, None))
    db._wasalt_batch(T, [row])
    assert (sent[0]["active"], sent[0]["missing_count"]) == (True, 0)


def test_a_failed_lookup_never_blocks_ingestion(monkeypatch):
    sent: list = []
    _wire(monkeypatch, sent)

    def execute(q, what="db", **_k):
        if "lookup" in what:
            raise RuntimeError("PostgREST down")
        return q.execute()
    monkeypatch.setattr(db, "_execute", execute)
    db._wasalt_batch(T, [{"ad_number": "NW4538"}])
    assert sent and sent[0]["active"] is True
