"""The republish cycle: a CORRECTLY hard-deleted unit whose source URL later comes back must be
re-ingestable as a FRESH record from current source truth — never reconstructed from the dead row.

Owner decision, 2026-08-30 (Senior Production run #71 follow-up). gathern unit 182286
(https://gathern.co/view/129713/unit/182286) was hard-deleted 2026-08-23 on a hard 404
(cleanup_deletion_log 1046: verdict=dead, http_status=404, inactive_days=37, missing_count=3 — and
all 978 gathern deletions carry http_status=404). Its URL later returned 200 again, which
verify_deletions reported as a possible false deletion. It was not one: the source republished the
page. The owner's ruling was to treat it as a republish, NOT to reconstruct the deleted row, and to
pin the capability that a republished listing can re-enter through the normal crawler.

That capability ALREADY WORKS in production and this file exists so it cannot silently stop: 43 of
978 hard-deleted gathern listings have re-entered via the ordinary path, e.g. GTH224854, deleted
2026-08-09 and re-scraped 2026-08-30T04:46Z with a current price of 106,560 and production_ready in
the search index. Nothing in the ingest path consults the deletion log, and the upsert is a plain
on_conflict=ad_number write — so re-entry works by construction. That is exactly the kind of
property that a well-meaning "don't re-add rows we already deleted" guard would quietly destroy,
with no test to notice. These tests are that notice.

The other half matters just as much: unit 182286 is STILL correctly absent today. Its page is live
but its own embedded JSON reads isUnitAvailable=false, nights=1, day_flag=ليلة — it is priced per
NIGHT and unavailable, while gathern ingestion is monthly-only. A republished page is not by itself
an eligible listing, and the crawler is right to leave it out.
"""
from __future__ import annotations

import pytest

import scrapers.gathern.run as G


@pytest.fixture(autouse=True)
def _stub_location_resolver(monkeypatch):
    """map_listing calls the centralized Arabic location resolver, which loads the live catalog from
    Supabase. Stub it so these tests stay hermetic — location resolution has its own suite, and what
    is under test here is the re-entry contract, not the resolver."""
    monkeypatch.setattr(G.AL, "resolve", lambda *a, **k: {
        "city_ar": "جدة", "city_id": 1, "region_id": 2,
        "district_ar": "الشاطئ", "confidence": "exact",
    })


# A monthly-mode search-units item shaped like the real feed, for a unit that WAS hard-deleted.
def _monthly_item(uid: int = 182286, chalet_id: int = 129713, price: float = 8880.0) -> dict:
    return {
        "id": uid,
        "chalet_id": chalet_id,
        "unit_type_id": next(iter(G.TYPE_MAP)),      # any residential type in the live map
        "nights": G.STAY_NIGHTS,                      # the long-stay signal
        "long_stay": True,
        "selected_check_in": "2026-08-31",
        "selected_check_out": "2026-09-30",
        "final_price": price,
        "price": price,
        "address": {"city": "جدة", "area": "الشاطئ"},
        "event_data": {"city_en": "Jeddah", "district_en": "Al Shati"},
        "features": [],
        "images": [],
    }


def test_republished_unit_maps_to_a_full_fresh_row_from_current_source_truth():
    """The re-entry path is the ordinary one: the CURRENT feed item alone produces a complete row.
    Nothing is carried over from the deleted record, because nothing about the deleted record is
    consulted — the mapper only ever sees today's item."""
    row = G.map_listing(_monthly_item(price=8880.0))
    assert row is not None, "a monthly-available republished unit must map to a row"
    assert row["ad_number"] == "GTH182286"
    assert row["listing_url"] == "https://gathern.co/view/129713/unit/182286"
    # Price comes from THIS item, not from whatever the dead row happened to hold.
    assert row["price_annual"] == 8880 * 12


def test_price_tracks_the_current_item_not_any_prior_value():
    """A republished unit re-priced by its host must land at the NEW price. If re-ingestion ever
    started merging against a remembered value, this is what would catch it."""
    cheap = G.map_listing(_monthly_item(price=4000.0))
    dear = G.map_listing(_monthly_item(price=19000.0))
    assert cheap["price_annual"] == 48000
    assert dear["price_annual"] == 228000
    assert cheap["ad_number"] == dear["ad_number"]      # same unit, different current truth


def test_a_republished_page_that_is_not_monthly_available_is_still_correctly_excluded():
    """The true-negative half, and the reason unit 182286 is still absent today: the page is back,
    but the host prices it per night and marks it unavailable. gathern ingestion is monthly-only,
    so a live page is NOT by itself an eligible listing. Re-entry must never widen to 'any 200'."""
    nightly = _monthly_item()
    nightly.update({"nights": 1, "long_stay": False,
                    "selected_check_in": None, "selected_check_out": None})
    assert G.map_listing(nightly) is None


def test_ingestion_never_consults_a_deletion_tombstone():
    """Re-entry works because the ingest path has no memory of deletions. A future 'skip anything
    we already hard-deleted' filter would look prudent and would permanently strand every
    republished unit — the failure would be silent, since the crawl would still report success."""
    src = open(G.__file__, encoding="utf-8").read()
    for tombstone in ("cleanup_deletion_log", "deleted_ad_numbers", "tombstone",
                      "previously_deleted", "cleanup_deletion_verification"):
        assert tombstone not in src, (
            f"scrapers/gathern/run.py now references {tombstone!r}. If a deletion tombstone is "
            "being consulted during ingestion, a correctly-deleted-then-republished unit can never "
            "re-enter. Re-entry from current source truth is an owner-ruled requirement "
            "(2026-08-30); do not gate it on deletion history.")


def test_upsert_is_a_plain_conflict_write_so_a_deleted_row_can_be_recreated():
    """The write itself must stay an upsert keyed on ad_number. An insert that assumed 'never seen
    before', or a write gated on the row already existing, would each break re-entry in a different
    direction."""
    import scrapers.common.db as D
    src = open(D.__file__, encoding="utf-8").read()
    fn = src.split("def _wasalt_batch", 1)
    assert len(fn) == 2, "_wasalt_batch is the shared batch writer for gathern — it must still exist"
    body = fn[1].split("\ndef ", 1)[0]
    assert 'on_conflict="ad_number"' in body or "on_conflict='ad_number'" in body, (
        "the shared batch writer must upsert on ad_number; a re-ingested unit reuses its original "
        "ad_number, so anything stricter than an upsert cannot recreate a hard-deleted row.")
