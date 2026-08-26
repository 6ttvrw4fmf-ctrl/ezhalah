"""A partial-fetch row must not erase a stored value THROUGH THE BATCH, not just per-row.

`_unknown_must_not_overwrite_known` drops a None/unread key from each row so a fetch that could not
read a field cannot NULL a stored value (owner rule 2026-08-09, SOURCE IS TRUTH). That guard is
per-row — and a per-row guard is not enough for a BULK upsert.

A Supabase bulk upsert sends the UNION of every row's keys, and PostgREST writes each column for
EVERY row in the payload, using NULL for a row that happens to lack it. So a summary-only row (its
detail fetch failed → no amenity keys) sharing one batch with full rows still had its stored
elevator/kitchen/driver_room erased to NULL — defeating the guard entirely.

Proven on aqaratikom (2026-08-24): rows first scraped 2026-06-22 that captured a source-faithful
`elevator = false` («مصعد: لا») had it nulled by a detail-miss re-scrape; the daily
`af_null_to_false_conversion` P1 (barrier `mon_detect_af_tri_state_violations`) then read the NULL
as truth and the stale search FALSE as a fabrication, and "self-resolved" by propagating the loss
into `search_listings_ar`.

The fix: `_wasalt_batch` upserts each distinct key-set on its own request, so PostgREST only ever
writes the columns a row actually carries. This test pins the observable guarantee — no single
upsert payload ever mixes key-sets — because that mixing is the only thing that lets PostgREST
union a column onto a row that never had it.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common import db  # noqa: E402


class _FakeQuery:
    def __init__(self, payload):
        self.payload = payload


class _FakeTable:
    def upsert(self, payload, on_conflict=None):
        return _FakeQuery(list(payload))


class _FakeClient:
    def table(self, _name):
        return _FakeTable()


def _capture_batch(monkeypatch, table, rows):
    payloads: list[list[dict]] = []
    monkeypatch.setattr(db, "sb", lambda: _FakeClient())
    monkeypatch.setattr(db, "_execute", lambda q, what=None: payloads.append(q.payload))
    db._wasalt_batch(table, rows)
    return payloads


# A full row (detail fetched) that captured a source-faithful `elevator = False`.
_FULL = {
    "ad_number": "AQ-FULL-1",
    "title": "شقة بدون مصعد",
    "price_total": 750000,
    "bedrooms": 3,
    "bathrooms": 2,
    "elevator": False,
    "kitchen": True,
}
# A summary-only row (detail fetch failed) — carries NO amenity keys at all.
_SUMMARY = {
    "ad_number": "AQ-SUMMARY-2",
    "title": "فيلا",
    "price_total": 1200000,
}


def test_heterogeneous_rows_are_never_unioned_in_one_upsert(monkeypatch):
    payloads = _capture_batch(
        monkeypatch, "aqaratikom_residential_listings", [dict(_FULL), dict(_SUMMARY)]
    )
    assert payloads, "the batch must issue at least one upsert"
    for payload in payloads:
        keysets = {frozenset(r.keys()) for r in payload}
        assert len(keysets) == 1, (
            "a Supabase bulk upsert unions columns across the payload and writes NULL for a row "
            "that lacks one — mixed key-sets in a single upsert would erase the summary-only row's "
            "unread amenities"
        )


def test_summary_only_row_never_gains_an_amenity_key(monkeypatch):
    payloads = _capture_batch(
        monkeypatch, "aqaratikom_residential_listings", [dict(_FULL), dict(_SUMMARY)]
    )
    summary_rows = [r for p in payloads for r in p if r["ad_number"] == "AQ-SUMMARY-2"]
    assert summary_rows, "the summary-only row must still be upserted"
    for r in summary_rows:
        for col in ("elevator", "kitchen", "driver_room"):
            assert col not in r, f"{col} would be NULLed over the stored value on a detail-miss row"


def test_full_rows_captured_false_survives(monkeypatch):
    payloads = _capture_batch(
        monkeypatch, "aqaratikom_residential_listings", [dict(_FULL), dict(_SUMMARY)]
    )
    full_rows = [r for p in payloads for r in p if r["ad_number"] == "AQ-FULL-1"]
    assert full_rows and all(r.get("elevator") is False for r in full_rows), (
        "a source-published FALSE must always be written — the guard preserves unknowns, not knowns"
    )


def test_homogeneous_batch_is_still_a_single_request(monkeypatch):
    """The common case (every row the same shape) must not fan out into N requests — that would
    undo the batch speedup the whole path exists for."""
    rows = [dict(_FULL, ad_number=f"AQ-H-{i}") for i in range(5)]
    payloads = _capture_batch(monkeypatch, "aqaratikom_residential_listings", rows)
    assert len(payloads) == 1, "identical key-sets must batch into one upsert"
    assert len(payloads[0]) == 5
