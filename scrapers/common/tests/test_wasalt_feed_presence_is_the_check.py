"""Owner decision 2026-10-02: an ad the site's own list still serves counts as checked and alive —
for Wasalt, and for the small full-list sites admitted one by one into SOURCE_LIST_PRESENCE.

Only those declare it, only a row the crawl leaves ACTIVE is stamped, a row whose own page is under
strike is not, and every other platform's feed sighting still stamps nothing.
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


def test_feed_presence_is_proof_of_life_only_for_wasalt_and_the_source_list_tier():
    from scrapers.common import liveness_policies as LP
    declared = sorted(k for k, v in POLICIES.items() if v["policy"].presence_is_positive_evidence)
    tier = sorted(k for k, v in POLICIES.items() if v["strategy"] == LP.SOURCE_LIST_PRESENCE)
    assert tier == sorted(LP.SOURCE_LIST_DAILY) and declared == sorted(["wasalt", *tier])
    assert all(POLICIES[p]["policy"].max_verification_age_hours == 48 for p in tier)
    assert all(POLICIES[p]["policy"].grace == 3 for p in tier), "the death side is unchanged"


def test_a_source_list_site_stamps_what_its_list_serves_and_nothing_it_marked_inactive(sent):
    from scrapers.common import liveness_policies as LP
    for site in LP.SOURCE_LIST_DAILY:
        sent.clear()
        getattr(db, f"upsert_{site}_residential_batch")([{"ad_number": "A1"}, {"ad_number": "A2", "active": False}])
        by = {r["ad_number"]: r for r in sent}
        assert by["A1"]["last_verified_alive_at"] == by["A1"]["last_seen_at"], site
        assert "last_verified_alive_at" not in by["A2"], site


def test_a_site_not_admitted_stays_unstamped(sent):
    # abralosol writes a row even when the ad's own page answered 404 this run (audit 2026-10-02).
    db.upsert_abralosol_residential_batch([{"ad_number": "X1"}])
    assert "last_verified_alive_at" not in sent[0]


def test_a_feed_sighting_never_certifies_a_row_whose_own_page_is_under_strike(sent):
    db._wasalt_batch("wasalt_residential_listings", [{"ad_number": "H1"}, {"ad_number": "H2"}],
                     strikes={"H1": (2, True)})
    by = {r["ad_number"]: r for r in sent}
    assert "last_verified_alive_at" not in by["H1"] and by["H1"]["missing_count"] == 2
    assert "last_verified_alive_at" in by["H2"]


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
