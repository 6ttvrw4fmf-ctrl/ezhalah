"""A SOURCE-CONFIRMED KILL THAT LEAVES NO EVIDENCE IS INDISTINGUISHABLE FROM A TIMEOUT.

These tests EXECUTE `scrapers/common/sold_pin.pin_source_confirmed_gone()` against a fake
PostgREST client and assert what it actually WRITES — not what its source text says. That
distinction is the whole point: measured 2026-09-14, ten of the eleven scrapers carrying a sold pin
wrote no evidence row at all, and the barrier standing over that code
(`test_sold_pin_coverage.py`) was green the entire time, because it read the pin payload as TEXT
and the payload was never the part that was missing.

WHAT THE MISSING ROW COST, measured the same day. `mon_detect_unknown_treated_as_dead` (P1) asks
whether a row was set `active = false` with no GONE verdict recorded against its ad_number at the
time. alert_event 2682 flagged three satel rows as evidence-free; a DIRECT fetch of each listing's
own URL returned HTTP 200 carrying satel's own «Rented out» status on all three. The kills were
earned; the P1 was caused entirely by the absent ledger row. A detector readers learn to dismiss is
a detector that is dark on the day it is right.

    python -m pytest scrapers/common/tests/test_sold_pin_records_evidence.py -q
"""
from __future__ import annotations

import sys
import types

import pytest

# ── Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network ─────────
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.common import db, sold_pin  # noqa: E402

TABLE = "satel_residential_listings"
GONE = ["STC0018", "STC0019", "STA0231"]          # the three real rows alert_event 2682 flagged
ORACLE = "satel.sold_pin.property_status"


# ── A fake PostgREST client recording every update payload and every insert ──────────────────────
class _Q:
    def __init__(self, sink, table, fail_inserts=False):
        self._sink, self._table, self._fail = sink, table, fail_inserts
        self._payload = None

    def update(self, payload):
        self._payload = payload
        return self

    def in_(self, _col, ads):
        self._sink.append(("update", self._table, dict(self._payload), list(ads)))
        return self

    def insert(self, rows):
        if self._fail:
            raise RuntimeError("ops ledger unavailable")
        self._sink.append(("insert", self._table, None, [dict(r) for r in rows]))
        return self

    def execute(self):
        return types.SimpleNamespace(data=[])


class _Client:
    def __init__(self, sink, fail_inserts=False):
        self._sink, self._fail = sink, fail_inserts

    def table(self, name):
        return _Q(self._sink, name, self._fail)


def _wire(monkeypatch, *, fail_inserts=False):
    sink: list = []
    monkeypatch.setattr(db, "sb", lambda: _Client(sink, fail_inserts))
    monkeypatch.setattr(db, "_execute", lambda q, what=None: q.execute())
    return sink


def _updates(sink):
    return [s for s in sink if s[0] == "update"]


def _evidence(sink):
    return [r for s in sink if s[0] == "insert" and s[1] == sold_pin.EVIDENCE_TABLE for r in s[3]]


def test_the_pin_writes_the_payload_that_survives_the_auto_recover_sweep(monkeypatch):
    sink = _wire(monkeypatch)
    pinned = sold_pin.pin_source_confirmed_gone(TABLE, GONE, oracle=ORACLE)

    assert pinned == GONE
    ups = _updates(sink)
    assert ups, "the pin wrote no update at all — the listing stays served"
    for _kind, table, payload, ads in ups:
        assert table == TABLE
        assert payload == {"active": False, "missing_count": 3}, (
            "missing_count=3 is what puts the row out of auto_recover_false_inactive()'s reach; "
            "active=false alone resurrects at 05:20 UTC"
        )
        assert set(ads) <= set(GONE)


def test_every_pinned_row_leaves_one_evidence_row_naming_the_oracle(monkeypatch):
    """THE DEFECT THIS FILE EXISTS FOR. Ten platforms pinned and recorded nothing."""
    sink = _wire(monkeypatch)
    sold_pin.pin_source_confirmed_gone(TABLE, GONE, oracle=ORACLE)

    rows = _evidence(sink)
    assert [r["ad_number"] for r in rows] == GONE, (
        "a source-confirmed deactivation left no row in ops_stale_inactivation_probe — in SQL it "
        "is now indistinguishable from a crawl that timed out, and mon_detect_unknown_treated_as_"
        "dead raises P1 on exactly that shape"
    )
    for r in rows:
        assert r["verdict"] == "GONE"
        assert r["source_table"] == TABLE
        assert r["oracle"] == ORACLE, (
            "the evidence row must name WHICH source field said gone — that is what makes the "
            "kill falsifiable by re-reading the same field (the 2026-08-26 aqarcity lesson)"
        )


def test_the_oracle_is_required_and_may_not_be_blank():
    for bad in ("", "   ", None):
        with pytest.raises(ValueError):
            sold_pin.plan_pin(GONE, oracle=bad)  # type: ignore[arg-type]


def test_the_raw_source_text_is_carried_into_the_note_when_supplied(monkeypatch):
    sink = _wire(monkeypatch)
    sold_pin.pin_source_confirmed_gone(
        TABLE, GONE, oracle=ORACLE, notes={"STC0018": "Rented out"})
    by_ad = {r["ad_number"]: r for r in _evidence(sink)}
    assert by_ad["STC0018"]["note"] == "Rented out"
    assert by_ad["STC0019"]["note"] == ""


def test_a_ledger_outage_can_never_keep_a_dead_listing_on_screen(monkeypatch):
    """Monitoring must not be able to block the pin. The pin runs first and the write is best-effort."""
    sink = _wire(monkeypatch, fail_inserts=True)
    pinned = sold_pin.pin_source_confirmed_gone(TABLE, GONE, oracle=ORACLE)

    assert pinned == GONE
    assert _updates(sink), (
        "the evidence write threw and took the pin down with it — a source-confirmed dead listing "
        "would stay served because a monitoring table was unavailable"
    )


def test_a_contradictory_source_holds_the_row_active_and_records_nothing(monkeypatch):
    """abeea's measured owner rule (2026-08-24), now the law for every platform that passes it.

    ABRE300/ABRE277/ABRE104 were inactive while abeea was still advertising them: one post said
    Rented, its twin said For Sale, both collapse onto one ad_number, and the pin killed it.
    """
    sink = _wire(monkeypatch)
    pinned = sold_pin.pin_source_confirmed_gone(
        TABLE, GONE, oracle=ORACLE, live_ad_numbers={"STC0019"})

    assert pinned == ["STC0018", "STA0231"]
    for _kind, _t, _p, ads in _updates(sink):
        assert "STC0019" not in ads, "a row seen LIVE this crawl was pinned anyway"
    assert "STC0019" not in [r["ad_number"] for r in _evidence(sink)], (
        "a held row must not leave a GONE verdict behind it — the ledger would then assert a "
        "death the source never confirmed"
    )


def test_nothing_at_all_is_written_for_an_empty_or_fully_conflicted_batch(monkeypatch):
    sink = _wire(monkeypatch)
    assert sold_pin.pin_source_confirmed_gone(TABLE, [], oracle=ORACLE) == []
    assert sold_pin.pin_source_confirmed_gone(
        TABLE, GONE, oracle=ORACLE, live_ad_numbers=set(GONE)) == []
    assert sink == [], "a batch with nothing to pin still issued writes"


def test_pinned_ids_and_evidence_rows_stay_one_to_one_under_duplicates(monkeypatch):
    """A duplicated id must not produce two ledger rows claiming two separate confirmations."""
    sink = _wire(monkeypatch)
    pinned = sold_pin.pin_source_confirmed_gone(
        TABLE, ["STC0018", "STC0018", "STC0019"], oracle=ORACLE)
    assert pinned == ["STC0018", "STC0019"]
    assert [r["ad_number"] for r in _evidence(sink)] == pinned


def test_the_pin_never_stamps_last_verified_alive_at(monkeypatch):
    """LISTING_LIVENESS.md §3: only scrapers/common/liveness_contract.py may write that column."""
    sink = _wire(monkeypatch)
    sold_pin.pin_source_confirmed_gone(TABLE, GONE, oracle=ORACLE)
    for _kind, _t, payload, _ads in _updates(sink):
        assert "last_verified_alive_at" not in payload
    for r in _evidence(sink):
        assert "last_verified_alive_at" not in r
