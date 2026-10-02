"""Owner decision 2026-10-02: a Wasalt ad its own search list still serves counts as checked and alive.

Only Wasalt declares it, only a row the crawl leaves ACTIVE is stamped, and every other platform's
feed sighting still stamps nothing.
"""
import sys
import types

sys.path.insert(0, ".")
for _n in ("supabase", "dotenv"):
    sys.modules.setdefault(_n, types.ModuleType(_n))
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None

import pytest  # noqa: E402

from scrapers.common import db  # noqa: E402
from scrapers.common.liveness_policies import POLICIES  # noqa: E402


@pytest.fixture
def sent(monkeypatch):
    out = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda _n: types.SimpleNamespace(
        upsert=lambda grp, **k: out.extend(grp) or "q")))
    monkeypatch.setattr(db, "_execute", lambda q, **k: None)
    for fn in ("_sanitize_price", "_unknown_must_not_overwrite_known", "_redact_user_visible_text",
               "_sanitize_ints", "_ensure_capture", "_reject_placeholder_location",
               "_reject_unusable_listing_url", "_preserve_gathern_detail_ai"):
        monkeypatch.setattr(db, fn, lambda *a, **k: None)
    return out


def test_only_wasalt_declares_feed_presence_as_proof_of_life():
    assert sorted(k for k, v in POLICIES.items() if v["policy"].presence_is_positive_evidence) == ["wasalt"]


def test_a_wasalt_row_the_feed_serves_is_stamped_verified(sent):
    db.upsert_wasalt_residential_batch([{"ad_number": "WST1"}, {"ad_number": "WST2", "active": False}])
    by = {r["ad_number"]: r for r in sent}
    assert by["WST1"]["last_verified_alive_at"] == by["WST1"]["last_seen_at"]
    assert "last_verified_alive_at" not in by["WST2"]        # a row the crawl itself marked inactive


def test_wasalt_commercial_is_stamped_too(sent):
    db.upsert_wasalt_commercial_batch([{"ad_number": "WST9"}])
    assert "last_verified_alive_at" in sent[0]


def test_another_platforms_feed_sighting_still_stamps_nothing(sent):
    db.upsert_gathern_residential_batch([{"ad_number": "GTH1"}])
    assert "last_verified_alive_at" not in sent[0]
